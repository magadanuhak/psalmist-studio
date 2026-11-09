"""/beats: Beat This! (CPJKU; MIT code + MIT weights). /structure: Beat This! grid + own permissive segmentation.

All-In-One (mir-aidj) was NOT used: it needs madmom (whose bundled models are CC BY-NC-SA), NATTEN (no Windows wheels)
and its own weights carry no stated licence. The replacement below (bar-synchronous self-similarity novelty +
clustering + position/energy labelling) is our own code on numpy/scipy/librosa.
"""
import threading
from typing import Optional

import numpy as np
import scipy.signal as ss

from . import analysis, audio_io, vram

_model = None
_lock = threading.Lock()


def _unload():
    global _model
    _model = None


def load():
    global _model
    with _lock:
        if _model is None:
            import torch
            from beat_this.inference import Audio2Beats

            vram.ensure_free(700)
            _model = Audio2Beats(checkpoint_path="final0", device="cuda" if torch.cuda.is_available() else "cpu",
                                 dbn=False)
            vram.register("beats", _unload)
        vram.touch("beats")
        return _model


def is_loaded() -> bool:
    return _model is not None


def track(mono: np.ndarray, sr: int) -> dict:
    """mono float32 -> beats, downbeats, tempo map. Beat This! wants 22.05 kHz mono internally (it resamples)."""
    m = load()
    beats, downbeats = m(mono.astype(np.float32), sr)
    beats, downbeats = np.asarray(beats, float), np.asarray(downbeats, float)
    if len(beats) < 4:
        return {"ok": False, "error": "no beats found", "beats": [], "downbeats": []}
    bpb = 4
    if len(downbeats) > 1:
        per = [int(((beats >= a - 1e-3) & (beats < b - 1e-3)).sum()) for a, b in zip(downbeats[:-1], downbeats[1:])]
        bpb = int(np.bincount(per).argmax()) if per else 4
    inst = 60.0 / np.maximum(np.diff(beats), 1e-3)
    sm = ss.medfilt(inst, 9 if len(inst) > 9 else 1)
    return {"ok": True, "bpm": round(float(np.median(inst)), 2), "beats_per_bar": bpb,
            "bar_seconds": round(float(np.median(np.diff(downbeats))), 4) if len(downbeats) > 1 else None,
            "beats": [round(float(t), 3) for t in beats], "downbeats": [round(float(t), 3) for t in downbeats],
            "tempo_map": [{"t": round(float(t), 3), "bpm": round(float(b), 2)} for t, b in zip(beats[:-1][::4], sm[::4])],
            "method": "Beat This! final0 (MIT)"}


def beats_from_bytes(data: bytes) -> dict:
    x, sr = audio_io.decode(data)
    return track(x.mean(axis=1), sr)


# ------------------------------------------------------------------ structure

_SECTION_RO = {"intro": "intro", "verse": "strofa", "chorus": "refren", "bridge": "bridge", "outro": "outro",
               "interlude": "interlude"}


def structure_from_bytes(data: bytes, min_bars: int = 8) -> dict:
    import librosa
    from scipy.cluster.hierarchy import fcluster, linkage

    x, sr = audio_io.decode(data)
    mono = x.mean(axis=1)
    tr = track(mono, sr)
    if not tr["ok"] or len(tr["downbeats"]) < 8:
        return {"ok": False, "error": "not enough bars to segment", "beats": tr}
    y = librosa.resample(mono, orig_sr=sr, target_sr=22050, res_type="polyphase")  # scipy, not libsoxr
    S = 22050
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=S, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=y, sr=S, n_mfcc=16, hop_length=hop)[1:]
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    ft = np.vstack([chroma / (np.linalg.norm(chroma, axis=0) + 1e-9), mfcc / 30.0])
    db = np.array(tr["downbeats"])
    end = len(y) / S
    edges = np.r_[db, max(end, db[-1] + tr["bar_seconds"])]
    fr = lambda t: min(int(t * S / hop), ft.shape[1] - 1)
    bars = np.array([ft[:, fr(a):max(fr(b), fr(a) + 1)].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])])
    en = np.array([rms[fr(a):max(fr(b), fr(a) + 1)].mean() for a, b in zip(edges[:-1], edges[1:])])
    Z = (bars - bars.mean(axis=0)) / (bars.std(axis=0) + 1e-6)
    Zn = Z / (np.linalg.norm(Z, axis=1, keepdims=True) + 1e-9)
    SSM = Zn @ Zn.T
    L = min(4, max(len(bars) // 6, 2))
    k = np.outer(np.r_[-np.ones(L), np.ones(L)], np.r_[-np.ones(L), np.ones(L)]) * -1  # checkerboard
    k[:L, :L] = 1
    k[L:, L:] = 1
    k[:L, L:] = -1
    k[L:, :L] = -1
    nov = np.zeros(len(bars))
    P = np.pad(SSM, L, mode="edge")
    for i in range(len(bars)):
        nov[i] = (P[i:i + 2 * L, i:i + 2 * L] * k).sum()
    nov = np.maximum(nov, 0)
    nov /= nov.max() + 1e-9
    pk, _ = ss.find_peaks(nov, height=0.28, distance=min_bars)
    bounds = [0] + [int(p) for p in pk if p >= min_bars // 2] + [len(bars)]
    # merge tiny tail
    if len(bounds) > 2 and bounds[-1] - bounds[-2] < min_bars:
        bounds.pop(-2)
    segs = [(a, b) for a, b in zip(bounds[:-1], bounds[1:]) if b > a]
    feats = np.array([Z[a:b].mean(axis=0) for a, b in segs])
    energy = np.array([en[a:b].mean() for a, b in segs])
    if len(segs) > 1:
        link = linkage(feats, "average", metric="cosine")
        cl = fcluster(link, t=0.7, criterion="distance")
    else:
        cl = np.array([1])
    counts = {c: int((cl == c).sum()) for c in set(cl)}
    labels = ["verse"] * len(segs)
    rep = [c for c in counts if counts[c] >= 2]
    chorus_c = max(rep, key=lambda c: energy[cl == c].mean()) if rep else None
    for i, c in enumerate(cl):
        if chorus_c is not None and c == chorus_c:
            labels[i] = "chorus"
        elif counts[c] == 1 and 0 < i < len(segs) - 1:
            labels[i] = "bridge" if i > len(segs) // 2 else "verse"
    if segs[0][1] - segs[0][0] <= 10 and counts[cl[0]] == 1 and labels[0] != "chorus":
        labels[0] = "intro"
    if len(segs) > 1 and segs[-1][1] - segs[-1][0] <= 10 and counts[cl[-1]] == 1 and labels[-1] != "chorus":
        labels[-1] = "outro"
    out = [{"start": round(float(edges[a]), 3), "end": round(float(edges[min(b, len(edges) - 1)]), 3),
            "bars": int(b - a), "label": labels[i], "section_type": _SECTION_RO[labels[i]], "cluster": int(cl[i])}
           for i, (a, b) in enumerate(segs)]
    return {"ok": True, "segments": out, "beats": tr["beats"], "downbeats": tr["downbeats"], "bpm": tr["bpm"],
            "beats_per_bar": tr["beats_per_bar"], "bar_seconds": tr["bar_seconds"],
            "method": "Beat This! + own self-similarity segmentation (All-In-One not used: licence/NATTEN)"}
