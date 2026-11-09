"""'Învață din cântec' pipeline + batch statistics (numbers only - no audio is written outside the stem cache)."""
import shutil
from collections import Counter
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

from . import analysis, config, separate

AUDIO_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"]


def analyze_key(key: str, meta: dict, progress: Optional[Callable[[float, str], None]] = None,
                chord_method: str = "auto") -> dict:
    """Full analysis of an already separated song (cache key with drums/bass/other/vocals[/guitar/piano])."""
    say = progress or (lambda p, s: None)
    stems = meta["stems"]
    out: Dict = {"cache_key": key, "model": meta["model"], "seconds": meta["seconds"]}
    say(0.0, "rhythm")
    rh = analysis.analyze_rhythm(separate.stem_path(key, "drums")) if "drums" in stems else {"ok": False}
    out["rhythm"] = rh
    beats = rh.get("beats") if rh.get("ok") else None
    downbeats = rh.get("downbeats") if rh.get("ok") else None
    say(0.25, "bass")
    out["bass"] = analysis.analyze_bass(separate.stem_path(key, "bass"), downbeats=downbeats, beats=beats) \
        if "bass" in stems else {"ok": False}
    say(0.55, "chords")
    harm_names = [s for s in ("other", "bass", "piano", "guitar") if s in stems]
    harm = analysis.harmonic_wav([separate.stem_path(key, s) for s in harm_names],
                                 separate.cache_dir(key) / "_harmonic.wav")
    out["chords"] = analysis.analyze_chords(harm, beats=beats, method=chord_method)
    out["key"] = analysis.estimate_key(harm)
    say(0.9, "done")
    out["vocals"] = {"cache_key": key, "stem": "vocals", "url": f"/cache/{key}/vocals.wav",
                     "hint": "feed to 'Din vocea completă'"} if "vocals" in stems else None
    out["harmonic_stems"] = harm_names
    return out


def _roman(chord: str, tonic: int) -> str:
    root = chord.rstrip("m7majdisu4").split("/")[0] or chord
    for i, n in enumerate(analysis.NOTE_NAMES):
        if chord.startswith(n) and not (len(chord) > len(n) and chord[len(n)] == "#"):
            q = "m" if chord[len(n):].startswith("m") and not chord[len(n):].startswith("maj") else ""
            return ROMAN[(i - tonic) % 12] + q
    return root


def stats_of(an: dict) -> dict:
    """Reduce an analysis to statistics only (no timestamps tied to the audio, no melodies)."""
    rh = an["rhythm"]
    st: Dict = {"seconds": an["seconds"], "key": an["key"]["key"], "mode": an["key"]["mode"]}
    if rh.get("ok"):
        st.update({"pulse_bpm": rh["pulse_bpm"], "beats_per_bar": rh["beats_per_bar"], "bar_seconds": rh["bar_seconds"],
                   "swing": rh["groove"]["swing"], "kick_pattern": rh["groove"]["pattern"]["kick"],
                   "snare_pattern": rh["groove"]["pattern"]["snare"], "hat_pattern": rh["groove"]["pattern"]["hat"]})
    notes = an["bass"].get("notes", [])
    if notes:
        st["bass_notes_per_second"] = round(len(notes) / max(an["seconds"], 1), 2)
        st["bass_median_midi"] = int(np.median([n["midi"] for n in notes]))
        st["bass_mean_note_dur"] = round(float(np.mean([n["dur"] for n in notes])), 3)
    chords = an["chords"]["chords"]
    tonic = analysis.NOTE_NAMES.index(an["key"]["key"])
    rom = [_roman(c["chord"], tonic) for c in chords]
    st["chord_changes_per_minute"] = round(len(chords) / max(an["seconds"] / 60, 1e-6), 1)
    st["roman_hist"] = dict(Counter(rom).most_common(10))
    st["roman_bigrams"] = dict(Counter(zip(rom[:-1], rom[1:])).most_common(10) and
                               {f"{a}>{b}": n for (a, b), n in Counter(zip(rom[:-1], rom[1:])).most_common(10)})
    return st


def batch(folder: str, model: str, job, shifts: int = 0) -> dict:
    """Separate + analyse every audio file in a folder; keep ONLY statistics (stems are deleted afterwards)."""
    root = Path(folder)
    if not root.is_dir():
        raise ValueError(f"not a folder: {folder}")
    files = sorted(p for p in root.iterdir() if p.suffix.lower() in AUDIO_EXT)
    if not files:
        raise ValueError("no audio files found")
    results: List[dict] = []
    for i, f in enumerate(files):
        job.check()
        lo, hi = i / len(files), (i + 1) / len(files)
        entry = {"name_hash": separate.hashlib.sha256(f.name.encode()).hexdigest()[:10], "index": i}
        try:
            meta = separate.separate(f.read_bytes(), model=model, shifts=shifts)
            key = meta["cache_key"]
            an = analyze_key(key, meta, progress=lambda p, s: job.set_progress(lo + (hi - lo) * (0.4 + 0.6 * p)))
            entry["stats"] = stats_of(an)
            entry["residual_db"] = meta["residual_db"]
            if not meta.get("cache_hit"):
                shutil.rmtree(separate.cache_dir(key), ignore_errors=True)
        except Exception as e:  # noqa: BLE001
            if type(e).__name__ == "Cancelled":
                raise
            entry["error"] = f"{type(e).__name__}: {e}"
        results.append(entry)
        job.set_progress(hi)
    ok = [r["stats"] for r in results if "stats" in r]
    agg: Dict = {"songs": len(ok)}
    if ok:
        agg["pulse_bpm_median"] = float(np.median([s["pulse_bpm"] for s in ok if "pulse_bpm" in s] or [0]))
        agg["beats_per_bar"] = dict(Counter(s.get("beats_per_bar") for s in ok))
        agg["modes"] = dict(Counter(s["mode"] for s in ok))
        agg["swing_median"] = float(np.median([s["swing"] for s in ok if "swing" in s] or [0.5]))
        agg["roman_hist"] = dict(sum((Counter(s["roman_hist"]) for s in ok), Counter()).most_common(12))
    out_dir = config.CACHE / "batch"
    out_dir.mkdir(exist_ok=True)
    import json
    p = out_dir / f"stats_{job.id}.json"
    p.write_text(json.dumps({"aggregate": agg, "songs": results}, indent=1))
    return {"aggregate": agg, "songs": results, "stats_file": str(p)}
