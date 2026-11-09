"""DeepFilterNet3 voice denoiser (MIT/Apache-2.0 code + weights)."""
import threading
from typing import Callable, Optional

import numpy as np
import torch

from . import audio_io, config

_state = None
_lock = threading.Lock()
CHUNK_S = 30.0
OVERLAP_S = 1.0


def load():
    global _state
    with _lock:
        if _state is not None:
            return _state
        import importlib

        dfe = importlib.import_module("df.enhance")  # `df.enhance` attr is shadowed by a function
        dfu = importlib.import_module("df.utils")

        # keep the model download outside the project / user profile
        cache = str(config.DF_CACHE)
        dfe.get_cache_dir = lambda: cache
        dfu.get_cache_dir = lambda: cache
        config.DF_CACHE.mkdir(parents=True, exist_ok=True)
        model, df_state, _ = dfe.init_df(log_file=None, log_level="WARNING")
        _state = (model, df_state, dfe)
        return _state


def _enhance_48k(audio: torch.Tensor, atten_lim_db: Optional[float], progress: Optional[Callable[[float], None]]):
    """audio [1, T] at 48 kHz -> same shape. Long files are chunked with a linear crossfade."""
    model, df_state, dfe = load()
    sr = df_state.sr()
    T = audio.shape[-1]
    chunk, ov = int(CHUNK_S * sr), int(OVERLAP_S * sr)
    if T <= chunk + ov:
        out = dfe.enhance(model, df_state, audio, atten_lim_db=atten_lim_db)
        if progress:
            progress(1.0)
        return out
    out = torch.zeros_like(audio)
    wsum = torch.zeros_like(audio)
    pos = 0
    while pos < T:
        end = min(pos + chunk + ov, T)
        seg = dfe.enhance(model, df_state, audio[:, pos:end], atten_lim_db=atten_lim_db)
        w = torch.ones_like(seg)
        n = seg.shape[-1]
        r = min(ov, n // 2)
        if pos > 0:
            w[:, :r] = torch.linspace(0, 1, r)
        if end < T:
            w[:, n - r:] = torch.linspace(1, 0, r)
        out[:, pos:end] += seg * w
        wsum[:, pos:end] += w
        pos += chunk
        if progress:
            progress(min(1.0, pos / T))
    return out / wsum.clamp_min(1e-6)


def denoise(data: bytes, atten_lim_db: Optional[float] = None, progress=None) -> tuple[bytes, dict]:
    """WAV/MP3 bytes -> (WAV bytes at input sample rate, info). Mono in -> mono out."""
    x, sr = audio_io.decode(data)
    ch = x.shape[1]
    mono = torch.from_numpy(x.mean(axis=1, keepdims=False)).unsqueeze(0)  # [1, T]
    peak_in = float(np.abs(x).max())
    a48 = audio_io.resample(mono, sr, 48000)
    out = _enhance_48k(a48, atten_lim_db, progress)
    out = audio_io.resample(out, 48000, sr)[:, : x.shape[0]]
    y = out.squeeze(0).numpy()
    if y.shape[0] < x.shape[0]:
        y = np.pad(y, (0, x.shape[0] - y.shape[0]))
    y = np.repeat(y[:, None], ch, axis=1) if ch > 1 else y[:, None]
    return audio_io.to_wav_bytes(y, sr), {"sample_rate": sr, "channels": ch, "seconds": round(x.shape[0] / sr, 2),
                                          "peak_in": round(peak_in, 4), "model": "DeepFilterNet3"}


def is_loaded() -> bool:
    return _state is not None
