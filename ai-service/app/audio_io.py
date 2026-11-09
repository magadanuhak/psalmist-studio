"""WAV/MP3 decode + WAV encode helpers."""
import io

import numpy as np
import soundfile as sf
import torch
import torchaudio.functional as AF


def decode(data: bytes):
    """bytes -> (float32 array [frames, channels], sample_rate). Handles WAV/FLAC/OGG/MP3."""
    try:
        x, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Cannot decode audio: {e}") from e
    if x.shape[0] == 0:
        raise ValueError("Audio is empty")
    return x, sr


def to_wav_bytes(x: np.ndarray, sr: int, subtype: str = "PCM_16") -> bytes:
    """x: [frames, channels] float -> WAV bytes (clipped)."""
    buf = io.BytesIO()
    sf.write(buf, np.clip(x, -1.0, 1.0), sr, format="WAV", subtype=subtype)
    return buf.getvalue()


def resample(x: torch.Tensor, sr: int, new_sr: int) -> torch.Tensor:
    """x: [channels, frames]."""
    if sr == new_sr:
        return x
    return AF.resample(x, sr, new_sr)
