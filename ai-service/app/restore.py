"""/restore: VoiceFixer (haoheliu; MIT code, CC-BY-4.0 weights from Zenodo record 5600188).

voicefixer insists on caching its checkpoints under ~/.cache; we point USERPROFILE at our cache while it loads so
nothing lands in the user profile."""
import os
import tempfile
import threading
from pathlib import Path

import numpy as np

from . import audio_io, config, vram

_vf = None
_lock = threading.Lock()
HOME = config.CACHE / "vf_home"


def _unload():
    global _vf
    _vf = None


def load():
    global _vf
    with _lock:
        if _vf is None:
            vram.ensure_free(1500)
            HOME.mkdir(parents=True, exist_ok=True)
            old = {k: os.environ.get(k) for k in ("USERPROFILE", "HOME")}
            os.environ["USERPROFILE"] = os.environ["HOME"] = str(HOME)
            try:
                from voicefixer import VoiceFixer

                _vf = VoiceFixer()
            finally:
                for k, v in old.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
            vram.register("restore", _unload)
        vram.touch("restore")
        return _vf


def restore(data: bytes, mode: int = 0) -> tuple[bytes, dict]:
    """mode 0 = original, 1 = + preprocessing (removes high-frequency noise), 2 = train mode (for very degraded audio)."""
    if mode not in (0, 1, 2):
        raise ValueError("mode must be 0, 1 or 2")
    x, sr = audio_io.decode(data)
    vf = load()
    with tempfile.TemporaryDirectory() as td:
        a, b = Path(td) / "in.wav", Path(td) / "out.wav"
        a.write_bytes(audio_io.to_wav_bytes(x.mean(axis=1, keepdims=True), sr, "PCM_16"))
        import torch

        vf.restore(input=str(a), output=str(b), cuda=torch.cuda.is_available(), mode=mode)
        import soundfile as sf

        y, osr = sf.read(str(b), dtype="float32", always_2d=True)
    import torch
    from fractions import Fraction
    import scipy.signal as ss

    y = y.mean(axis=1)
    if osr != sr:
        fr = Fraction(sr, osr).limit_denominator(1000)
        y = ss.resample_poly(y, fr.numerator, fr.denominator).astype(np.float32)
    n = x.shape[0]
    y = np.pad(y, (0, max(0, n - len(y))))[:n]
    peak = float(np.abs(y).max())
    if peak > 0.99:
        y = y * (0.99 / peak)
    return audio_io.to_wav_bytes(y[:, None], sr), {"sample_rate": sr, "mode": mode, "seconds": round(n / sr, 2)}
