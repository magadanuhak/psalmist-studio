"""/pitch: frame-wise f0 + voicing with torchcrepe (CREPE; MIT code, MIT weights bundled in the package)."""
import threading

import numpy as np
import scipy.signal as ss
import torch

from . import audio_io, vram

SR = 16000
HOP = 160  # 10 ms
_lock = threading.Lock()
_loaded = False


def _unload():
    global _loaded
    _loaded = False


def _ensure():
    global _loaded
    with _lock:
        if not _loaded:
            vram.ensure_free(500)
            _loaded = True
            vram.register("pitch", _unload)
        vram.touch("pitch")


def predict(mono: np.ndarray, sr: int, fmin: float = 60.0, fmax: float = 1100.0, model: str = "full",
            voicing_threshold: float = 0.3) -> dict:
    import torchcrepe

    _ensure()
    from fractions import Fraction

    if sr != SR:
        fr = Fraction(SR, sr).limit_denominator(1000)
        mono = ss.resample_poly(mono, fr.numerator, fr.denominator)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    audio = torch.from_numpy(mono.astype(np.float32))[None]
    f0, per = torchcrepe.predict(audio, SR, HOP, fmin, fmax, model, batch_size=1024, device=dev,
                                 return_periodicity=True, pad=True)
    per = torchcrepe.filter.median(per, 3)
    f0 = torchcrepe.filter.mean(f0, 3)
    f0, per = f0[0].cpu().numpy(), per[0].cpu().numpy()
    # drop silence: frames far below the loudness of the take are unvoiced
    n = len(f0)
    rms = np.sqrt(np.convolve(mono.astype(np.float64) ** 2, np.ones(400) / 400, "same"))[:: HOP][:n]
    rms = np.pad(rms, (0, n - len(rms)))
    voiced = (per >= voicing_threshold) & (rms > 0.01 * (rms.max() + 1e-9))
    f0 = np.where(voiced, f0, 0.0)
    return {"hop_ms": HOP * 1000 // SR, "frames": int(n), "model": f"torchcrepe-{model}", "fmin": fmin, "fmax": fmax,
            "f0_hz": [round(float(v), 2) for v in f0], "voicing": [round(float(v), 3) for v in per],
            "voiced": [bool(v) for v in voiced]}


def predict_bytes(data: bytes, **kw) -> dict:
    x, sr = audio_io.decode(data)
    return predict(x.mean(axis=1), sr, **kw)
