"""Demucs separation engine: htdemucs / htdemucs_ft / htdemucs_6s, two-stems mode, shifts/overlap/segment,
WAV output only (PCM_16 / PCM_24 / FLOAT), result cache keyed by file hash + parameters.

Code and weights of all three models: MIT (facebookresearch/demucs). No MP3 export (lameenc is never used)."""
import hashlib
import json
import shutil
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

from . import audio_io, config, jobs, vram

MODELS = {
    "htdemucs": {"stems": ["drums", "bass", "other", "vocals"], "note": "default, fast"},
    "htdemucs_ft": {"stems": ["drums", "bass", "other", "vocals"], "note": "fine-tuned bag of 4, best quality, ~4x slower"},
    "htdemucs_6s": {"stems": ["drums", "bass", "other", "vocals", "guitar", "piano"], "note": "6 stems; guitar/piano weaker"},
}
SUBTYPES = {"pcm16": "PCM_16", "pcm24": "PCM_24", "float": "FLOAT"}
_models: Dict[str, object] = {}
_lock = threading.Lock()
STEM_DIR = config.CACHE / "stems"
STEM_DIR.mkdir(parents=True, exist_ok=True)
MAX_CACHED = 24


def load(name: str = config.DEMUCS_MODEL):
    if name not in MODELS:
        raise ValueError(f"unknown model {name!r}; known: {sorted(MODELS)}")
    with _lock:
        if name not in _models:
            from demucs.pretrained import get_model

            m = get_model(name)
            m.eval()
            if torch.cuda.is_available():
                m.cuda()
            _models[name] = m
        return _models[name]


def is_loaded() -> bool:
    return config.DEMUCS_MODEL in _models


class _TqdmShim:
    """Replaces demucs.apply.tqdm: progress per processed segment (all shifts / bag members) + cancellation."""

    def __init__(self, job, passes: int):
        self.job, self.passes, self.calls = job, max(passes, 1), 0

    def tqdm(self, iterable, **_kw):
        items = list(iterable)
        n = max(len(items), 1)
        base = self.calls
        self.calls += 1
        for i, it in enumerate(items):
            if self.job:
                self.job.set_progress(0.05 + 0.9 * (base + i / n) / self.passes)
            yield it
        if self.job:
            self.job.set_progress(0.05 + 0.9 * (base + 1) / self.passes)


def params_key(file_hash: str, model: str, two_stems: Optional[str], shifts: int, overlap: float,
               segment: Optional[float], fmt: str) -> str:
    p = f"{model}|{two_stems or 'all'}|s{shifts}|o{overlap:.3f}|g{segment or 'auto'}|{fmt}"
    return f"{file_hash[:20]}_{hashlib.sha1(p.encode()).hexdigest()[:10]}"


def cache_dir(key: str) -> Path:
    if not key.replace("_", "").isalnum():
        raise ValueError("bad cache key")
    return STEM_DIR / key


def cached(key: str) -> Optional[dict]:
    meta = cache_dir(key) / "meta.json"
    if meta.exists():
        return json.loads(meta.read_text())
    return None


def _evict():
    dirs = sorted([d for d in STEM_DIR.iterdir() if d.is_dir()], key=lambda d: d.stat().st_mtime)
    for d in dirs[: max(0, len(dirs) - MAX_CACHED)]:
        shutil.rmtree(d, ignore_errors=True)


def separate(data: bytes, model: str = "htdemucs", two_stems: Optional[str] = None, shifts: int = 0,
             overlap: float = 0.25, segment: Optional[float] = None, fmt: str = "pcm16",
             job: Optional["jobs.Job"] = None) -> dict:
    """Writes one WAV per stem into the cache dir (44.1 kHz stereo). Returns meta (also stored as meta.json)."""
    import demucs.apply as dapply

    if fmt not in SUBTYPES:
        raise ValueError(f"fmt must be one of {sorted(SUBTYPES)}")
    if not 0 <= shifts <= 10:
        raise ValueError("shifts must be 0..10")
    if not 0.0 <= overlap < 1.0:
        raise ValueError("overlap must be in [0, 1)")
    vram.ensure_free(3800 if model == "htdemucs_ft" else 2500)  # stops the LLM / unloads idle models if needed
    m = load(model)
    names = list(m.sources)
    if two_stems and two_stems not in names:
        raise ValueError(f"two_stems must be one of {names}")
    fh = hashlib.sha256(data).hexdigest()
    key = params_key(fh, model, two_stems, shifts, overlap, segment, fmt)
    hit = cached(key)
    if hit:
        (cache_dir(key)).touch()
        return {**hit, "cache_hit": True}

    x, sr = audio_io.decode(data)
    x = np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x[:, :2]
    wav = audio_io.resample(torch.from_numpy(x.T.copy()), sr, m.samplerate)
    ref = wav.mean(0)
    wav_n = (wav - ref.mean()) / (ref.std() + 1e-8)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    n_models = len(getattr(m, "models", [m]))
    kw = {}
    if segment:
        kw["segment"] = min(float(segment), float(getattr(m, "max_allowed_segment", 1e9)))
    orig = dapply.tqdm
    dapply.tqdm = _TqdmShim(job, max(shifts, 1) * n_models)
    try:
        t0 = time.perf_counter()
        with torch.no_grad():
            srcs = dapply.apply_model(m, wav_n[None], device=dev, split=True, overlap=overlap, shifts=shifts,
                                      progress=True, **kw)[0]
        model_ms = int((time.perf_counter() - t0) * 1000)
    finally:
        dapply.tqdm = orig
    srcs = srcs * (ref.std() + 1e-8) + ref.mean()
    resid = float(10 * torch.log10(((wav - srcs.sum(0)) ** 2).sum() / (wav**2).sum().clamp_min(1e-12)))
    out: Dict[str, torch.Tensor] = {}
    if two_stems:
        out[two_stems] = srcs[names.index(two_stems)]
        out["no_" + two_stems] = sum(srcs[i] for i, n in enumerate(names) if n != two_stems)
    else:
        out = {n: srcs[i] for i, n in enumerate(names)}
    peak = max(float(t.abs().max()) for t in out.values())
    scale = 0.99 / peak if peak > 1.0 and fmt != "float" else 1.0
    d = cache_dir(key)
    d.mkdir(parents=True, exist_ok=True)
    for n, t in out.items():
        (d / f"{n}.wav").write_bytes(audio_io.to_wav_bytes((t * scale).cpu().numpy().T, m.samplerate, SUBTYPES[fmt]))
    meta = {"cache_key": key, "file_hash": fh, "model": model, "stems": list(out), "two_stems": two_stems,
            "shifts": shifts, "overlap": overlap, "segment": segment, "format": fmt, "sample_rate": m.samplerate,
            "seconds": round(wav.shape[1] / m.samplerate, 2), "model_ms": model_ms,
            "residual_db": round(resid, 1), "cache_hit": False}
    (d / "meta.json").write_text(json.dumps(meta))
    _evict()
    return meta


def stem_path(key: str, name: str) -> Path:
    if not name.replace("_", "").isalnum():
        raise ValueError("bad stem name")
    p = cache_dir(key) / f"{name}.wav"
    if not p.exists():
        raise FileNotFoundError(f"{key}/{name}")
    return p


def mix_stems(key: str, names: List[str]) -> tuple[np.ndarray, int]:
    """Sum of cached stems -> ([frames, 2] float32, sr)."""
    import soundfile as sf

    acc = None
    sr = 44100
    for n in names:
        x, sr = sf.read(stem_path(key, n), dtype="float32", always_2d=True)
        acc = x if acc is None else acc[: min(len(acc), len(x))] + x[: min(len(acc), len(x))]
    return acc, sr
