"""'Învață din cântec' analysis on separated stems (local only; returns numbers, never audio).

Permissive stack: numpy/scipy/librosa (ISC). Optional external: Sonic Annotator + Chordino (GPL plugin, run as a
separate local process, never bundled) - used only when the executable is found, otherwise a template-matching
chord estimator (own code) is used.
"""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np
import scipy.signal as ss
import soundfile as sf

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SA_EXE = Path(r"C:\Users\Admin\tools\sonic-annotator\sonic-annotator-win64\sonic-annotator.exe")
SR = 22050
HOP = 256


def load_mono(path, sr: int = SR) -> np.ndarray:
    x, s = sf.read(str(path), dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if s != sr:
        from fractions import Fraction

        fr = Fraction(sr, s).limit_denominator(1000)
        x = ss.resample_poly(x, fr.numerator, fr.denominator).astype(np.float32)
    return x


# ------------------------------------------------------------------ rhythm (drums stem)

def _band_env(y: np.ndarray, lo: float, hi: float) -> np.ndarray:
    import librosa

    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=HOP)) ** 2
    f = librosa.fft_frequencies(sr=SR, n_fft=1024)
    band = S[(f >= lo) & (f < hi)]
    e = np.log1p(30 * band.sum(axis=0) / max(band.shape[0], 1) ** 0.5)
    d = np.maximum(np.diff(e, prepend=e[0]), 0)
    return np.minimum(d / (np.percentile(d, 99.5) + 1e-9), 1.0)


def _snap(times: np.ndarray, env: np.ndarray, radius_s: float = 0.045) -> np.ndarray:
    """Move each time to the strongest onset-envelope sample within +-radius."""
    out = times.copy()
    r = int(radius_s * SR / HOP)
    for i, t in enumerate(times):
        c = int(round(t * SR / HOP))
        lo, hi = max(c - r, 0), min(c + r + 1, len(env))
        if hi > lo and env[lo:hi].max() > 0.15:
            out[i] = (lo + int(np.argmax(env[lo:hi]))) * HOP / SR
    return out


def analyze_rhythm(path, beats_per_bar: Optional[int] = None) -> dict:
    import librosa

    y = load_mono(path)
    dur = len(y) / SR
    env_all = _band_env(y, 40, 9000)
    env_kick = _band_env(y, 35, 140)
    env_snare = _band_env(y, 180, 2500)
    env_hat = _band_env(y, 6000, 10500)
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP, tightness=120)
    beats = librosa.frames_to_time(beat_frames, sr=SR, hop_length=HOP)
    if len(beats) < 8:
        return {"ok": False, "error": "not enough beats found in the drums stem", "duration": dur}
    # constant-pulse grid: refine the tracker's period by maximising the sharpness of the folded onset envelope
    env_fit = 0.6 * env_all + 0.4 * env_kick
    ac = np.fft.irfft(np.abs(np.fft.rfft(env_fit - env_fit.mean(), 2 * len(env_fit))) ** 2)[: len(env_fit)]
    lags = np.arange(len(ac)) * HOP / SR
    sel = (lags >= 0.3) & (lags <= 1.3)
    prior = np.exp(-0.5 * (np.log2(np.maximum(lags, 1e-3) / 0.667) / 0.55) ** 2)
    p0 = float(lags[sel][np.argmax((ac * prior)[sel])])
    tt = np.arange(len(env_fit)) * HOP / SR
    best_fit = None
    for P in np.linspace(p0 * 0.94, p0 * 1.06, 241):
        ph = (tt % P) / P
        hist = np.bincount((ph * 64).astype(int) % 64, weights=env_fit, minlength=64)
        hist = np.convolve(np.r_[hist[-1:], hist, hist[:1]], [0.25, 0.5, 0.25], "valid")
        sc = hist.max() / (hist.mean() + 1e-9)
        if best_fit is None or sc > best_fit[0]:
            best_fit = (sc, P, int(np.argmax(hist)))
    _, P, pk = best_fit
    t_start = (pk + 0.5) / 64 * P
    grid = np.arange(t_start, dur, P)
    beats_s = _snap(grid, env_fit, 0.035)
    off = np.median(beats_s - grid)  # systematic offset between grid and onset peaks
    beats_s = grid + off
    # downbeats: choose beats-per-bar by bar-pattern distinctiveness x repeatability of the kick/low accent
    feat = np.array([env_kick[max(int(t * SR / HOP) - 2, 0): int(t * SR / HOP) + 3].max() + 0.3 * env_all[
        max(int(t * SR / HOP) - 2, 0): int(t * SR / HOP) + 3].max() for t in beats_s])
    cands = [beats_per_bar] if beats_per_bar else [2, 3, 4, 6, 8]
    best = None
    for bpb in cands:
        nb = len(feat) // bpb
        if nb < 4:
            continue
        M = feat[: nb * bpb].reshape(nb, bpb)
        mean = M.mean(axis=0)
        dist = (mean.std() / (mean.mean() + 1e-9))
        rep = np.mean([np.corrcoef(M[i], mean)[0, 1] for i in range(nb) if M[i].std() > 0]) if bpb > 1 else 0
        score = dist * max(rep, 0.0) * {4: 1.0, 3: 0.92, 6: 0.88, 2: 0.7, 8: 0.8}.get(bpb, 0.8)  # 4/4 is the common prior
        if best is None or score > best[0]:
            best = (score, bpb, int(np.argmax(mean)))
    if best is None:
        best = (0, 4, 0)
    _, bpb, phase = best
    downbeats = beats_s[phase::bpb]
    # tempo map: local pulse tempo from the tracker's (unconstrained) beats, median-smoothed
    inst = 60.0 / np.maximum(np.diff(beats), 1e-3)
    sm = ss.medfilt(inst, 9 if len(inst) > 9 else 1)
    tempo_map = [{"t": round(float(t), 3), "bpm": round(float(b), 2)} for t, b in zip(beats[:-1][::4], sm[::4])]
    bpm = float(60.0 / P)
    groove = _groove(downbeats, bpb, env_kick, env_snare, env_hat, env_all)
    return {"ok": True, "duration": round(dur, 2), "bpm": round(bpm, 2), "beats_per_bar": bpb, "pulse_bpm": round(bpm, 2),
            "bar_seconds": round(float(np.median(np.diff(downbeats))), 4) if len(downbeats) > 1 else None,
            "beats": [round(float(t), 3) for t in beats_s], "downbeats": [round(float(t), 3) for t in downbeats],
            "tempo_map": tempo_map, "groove": groove, "method": "librosa+snap (permissive)"}


def _groove(downbeats: np.ndarray, bpb: int, ek, es, eh, ea, sub: int = 4) -> dict:
    """Mean per-grid-slot strength (kick/snare/hat) and micro-timing (ms) over all bars; swing ratio."""
    slots = bpb * sub
    acc = {k: np.zeros(slots) for k in ("kick", "snare", "hat")}
    micro = [[] for _ in range(slots)]
    nb = 0
    for i in range(len(downbeats) - 1):
        t0, t1 = downbeats[i], downbeats[i + 1]
        if not 0.3 < (t1 - t0) < 8:
            continue
        nb += 1
        for g in range(slots):
            tg = t0 + (t1 - t0) * g / slots
            c = int(round(tg * SR / HOP))
            r = max(int(0.35 * (t1 - t0) / slots * SR / HOP), 1)
            lo, hi = max(c - r, 0), min(c + r + 1, len(ea))
            if hi <= lo:
                continue
            for name, e in (("kick", ek), ("snare", es), ("hat", eh)):
                acc[name][g] += e[lo:hi].max()
            if ea[lo:hi].max() > 0.25:
                micro[g].append((lo + int(np.argmax(ea[lo:hi])) - c) * HOP / SR * 1000)
    nb = max(nb, 1)
    pat = {k: [round(float(v / nb), 3) for v in a] for k, a in acc.items()}
    mm = [round(float(np.median(m)), 1) if len(m) > 3 else 0.0 for m in micro]
    # swing: where the off-beat 8th lands inside the beat (0.5 straight, 0.667 triplet)
    swing = 0.5
    if sub == 4 and downbeats.size > 3:
        offs = []
        for g in range(slots):
            pass
        beat_off = [mm[b * sub + 2] for b in range(bpb)]  # ms offset of the off-beat 8th from the straight grid
        beat_len = float(np.median(np.diff(downbeats))) / bpb * 1000
        swing = round(0.5 + float(np.mean(beat_off)) / beat_len, 3)
    return {"slots_per_bar": slots, "pattern": pat, "micro_timing_ms": mm, "swing": swing,
            "bars_used": nb}


# ------------------------------------------------------------------ bass stem

def analyze_bass(path, downbeats: Optional[Sequence[float]] = None, beats: Optional[Sequence[float]] = None) -> dict:
    import librosa

    y = load_mono(path)
    sr = SR
    f0, voiced, prob = librosa.pyin(y, fmin=30, fmax=330, sr=sr, frame_length=2048, hop_length=512,
                                    fill_na=np.nan, resolution=0.2)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0][: len(f0)]
    hop_s = 512 / sr
    midi = np.where(voiced, np.round(librosa.hz_to_midi(np.where(voiced, f0, 100.0))), np.nan)
    midi = _median_nan(midi, 5)
    notes: List[dict] = []
    i = 0
    n = len(midi)
    while i < n:
        if np.isnan(midi[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and not np.isnan(midi[j + 1]) and abs(midi[j + 1] - midi[i]) < 0.5:
            j += 1
        if (j - i + 1) * hop_s >= 0.07:
            notes.append({"t": round(i * hop_s, 3), "dur": round((j - i + 1) * hop_s, 3), "midi": int(midi[i]),
                          "level": round(float(rms[i:j + 1].mean()), 4)})
        i = j + 1
    dur = len(y) / sr
    segs = []
    if downbeats is not None and len(downbeats) > 1:
        segs = [(float(a), float(b)) for a, b in zip(downbeats[:-1], downbeats[1:])]
        step = (float(np.median(np.diff(downbeats))))
        segs = [(0.0, float(downbeats[0]))] + segs + [(float(downbeats[-1]), min(dur, float(downbeats[-1]) + step))]
    elif beats is not None and len(beats) > 1:
        segs = [(float(a), float(b)) for a, b in zip(beats[:-1], beats[1:])]
    roots_seg = [{"t": round(a, 3), "end": round(b, 3), "root": root_in(notes, a, b)} for a, b in segs]
    roots_seg = [r for r in roots_seg if r["root"] is not None]
    return {"ok": True, "notes": notes, "roots_per_segment": roots_seg,
            "pitch_class_hist": _pc_hist(notes, 0, dur)}


def _median_nan(x: np.ndarray, k: int) -> np.ndarray:
    out = x.copy()
    h = k // 2
    for i in range(len(x)):
        w = x[max(i - h, 0): i + h + 1]
        w = w[~np.isnan(w)]
        out[i] = np.median(w) if (len(w) >= h + 1 and not np.isnan(x[i])) else np.nan
    return out


def _pc_hist(notes: Sequence[dict], a: float, b: float) -> List[float]:
    h = np.zeros(12)
    for nt in notes:
        o = min(nt["t"] + nt["dur"], b) - max(nt["t"], a)
        if o > 0:
            h[nt["midi"] % 12] += o * (nt.get("level", 1.0) ** 0.5)
    s = h.sum()
    return [round(float(v / s), 3) for v in h] if s > 0 else [0.0] * 12


def root_in(notes: Sequence[dict], a: float, b: float) -> Optional[str]:
    h = _pc_hist(notes, a, b)
    if max(h) <= 0:
        return None
    return NOTE_NAMES[int(np.argmax(h))]


# ------------------------------------------------------------------ chords

_QUAL = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
         "sus4": [0, 5, 7], "dim": [0, 3, 6]}
_PRIOR = {"": 1.0, "m": 1.0, "7": 0.6, "maj7": 0.5, "m7": 0.55, "sus4": 0.3, "dim": 0.2}


def _templates():
    names, T = [], []
    for r in range(12):
        for q, iv in _QUAL.items():
            v = np.zeros(12)
            for k, i in enumerate(iv):
                v[(r + i) % 12] = 1.0 if k < 3 else 0.6
            names.append(NOTE_NAMES[r] + q)
            T.append(v / np.linalg.norm(v) * _PRIOR[q])
    return names, np.array(T)


def sonic_available() -> bool:
    return SA_EXE.exists()


def chordino(wav_path: Path, timeout: int = 600) -> List[dict]:
    """Chordino via Sonic Annotator (external GPL tool, optional). Returns [{t,end,chord}]."""
    r = subprocess.run([str(SA_EXE), "-d", "vamp:nnls-chroma:chordino:simplechord", "-w", "csv", "--csv-stdout",
                        str(wav_path)], capture_output=True, text=True, timeout=timeout)
    pts = []
    for line in r.stdout.splitlines():
        m = re.match(r'^.*?,([0-9.]+),"?([^",]+)"?\s*$', line)
        if m:
            pts.append((float(m.group(1)), m.group(2)))
    return _points_to_segments(pts)


def _points_to_segments(pts, end: Optional[float] = None) -> List[dict]:
    out = []
    for i, (t, c) in enumerate(pts):
        e = pts[i + 1][0] if i + 1 < len(pts) else (end if end else t + 2.0)
        if c != "N":
            out.append({"t": round(t, 3), "end": round(e, 3), "chord": c})
    return out


def chords_templates(path, beats: Optional[Sequence[float]] = None) -> List[dict]:
    """Beat-synchronous chroma template matching + Viterbi smoothing (own code, permissive)."""
    import librosa

    y = load_mono(path)
    hop = 2048
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop, n_chroma=12, bins_per_octave=36, fmin=librosa.note_to_hz("C2"))
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=SR, hop_length=hop)
    if beats is not None and len(beats) > 4:
        b = np.asarray(beats, dtype=float)
        edges = np.searchsorted(times, b)
        edges = np.unique(np.clip(edges, 0, chroma.shape[1]))
        segs = [(a, c) for a, c in zip(edges[:-1], edges[1:]) if c > a]
        feats = np.array([chroma[:, a:c].mean(axis=1) for a, c in segs])
        t_seg = [(times[a], times[c] if c < len(times) else times[-1] + hop / SR) for a, c in segs]
    else:
        feats = chroma.T
        t_seg = [(t, t + hop / SR) for t in times]
    names, T = _templates()
    feats = feats / (np.linalg.norm(feats, axis=1, keepdims=True) + 1e-9)
    sim = feats @ T.T
    prob = np.exp(6 * sim)
    prob /= prob.sum(axis=1, keepdims=True)
    trans = np.full((len(names), len(names)), 0.04 / len(names))
    np.fill_diagonal(trans, 0.96)
    path_idx = librosa.sequence.viterbi_discrete(prob.T, trans / trans.sum(axis=1, keepdims=True))
    out: List[dict] = []
    for (a, c), k in zip(t_seg, path_idx):
        if out and out[-1]["chord"] == names[k]:
            out[-1]["end"] = round(float(c), 3)
        else:
            out.append({"t": round(float(a), 3), "end": round(float(c), 3), "chord": names[k]})
    return out


def analyze_chords(path, beats=None, method: str = "auto") -> dict:
    use_sa = method == "chordino" or (method == "auto" and sonic_available())
    if use_sa:
        try:
            return {"ok": True, "method": "chordino (Sonic Annotator)", "chords": chordino(Path(path))}
        except Exception as e:  # noqa: BLE001
            if method == "chordino":
                raise
            err = f"{type(e).__name__}: {e}"
    else:
        err = None
    r = {"ok": True, "method": "chroma templates + Viterbi (permissive)", "chords": chords_templates(path, beats)}
    if err:
        r["fallback_reason"] = err
    return r


def estimate_key(path) -> dict:
    import librosa

    y = load_mono(path)
    c = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=2048).mean(axis=1)
    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    mnr = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    best = max(((np.corrcoef(np.roll(p, k), c)[0, 1], k, m) for k in range(12) for p, m in ((maj, "major"), (mnr, "minor"))))
    return {"key": NOTE_NAMES[best[1]], "mode": best[2], "confidence": round(float(best[0]), 3)}


def harmonic_wav(paths: Sequence[Path], out: Path) -> Path:
    acc = None
    sr = 44100
    for p in paths:
        x, sr = sf.read(str(p), dtype="float32", always_2d=True)
        acc = x if acc is None else acc[: min(len(acc), len(x))] + x[: min(len(acc), len(x))]
    sf.write(str(out), np.clip(acc, -1, 1), sr, subtype="PCM_16")
    return out
