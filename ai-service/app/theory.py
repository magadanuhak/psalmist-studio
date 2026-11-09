"""Chord / key helpers shared by /accompany and its tests (pure python, no torch)."""
import re
from typing import Dict, List, Optional, Sequence, Set, Tuple

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]  # natural minor; harmonic 7th is added when the chord chart has a major V
_CHORD_RE = re.compile(r"^([A-Ga-g])([#b♯♭]?)(.*?)(?:/([A-Ga-g][#b♯♭]?))?$")


def pitch_class(name: str) -> int:
    m = re.match(r"^([A-Ga-g])([#b♯♭]?)$", name.strip())
    if not m:
        raise ValueError(f"Bad note name: {name!r}")
    pc = NOTE_PC[m.group(1).upper()]
    if m.group(2) in ("#", "♯"):
        pc += 1
    elif m.group(2) in ("b", "♭"):
        pc -= 1
    return pc % 12


def parse_chord(symbol: str) -> Dict:
    """'G7' -> {root:7, pcs:{7,11,2,5}, bass:7, symbol:'G7'}. Unknown qualities fall back to a major/minor triad."""
    s = symbol.strip()
    m = _CHORD_RE.match(s)
    if not m:
        raise ValueError(f"Bad chord symbol: {symbol!r}")
    root = pitch_class(m.group(1) + m.group(2))
    q = m.group(3).replace("°", "dim").replace("ø", "m7b5").replace("Δ", "maj")
    ql = q.lower()
    third, fifth = 4, 7
    extra: List[int] = []
    major7 = ql.startswith("maj") or ql.startswith("ma7") or ql.startswith("m7+")
    minor = (not major7) and bool(re.match(r"^(m|min|-)", ql))
    if minor:
        third = 3
    if "m7b5" in ql or "min7b5" in ql:
        third, fifth = 3, 6
        extra.append(10)
    elif "dim" in ql:
        third, fifth = 3, 6
        if "7" in ql:
            extra.append(9)
    if "aug" in ql or "+" in ql:
        fifth = 8
    if "sus4" in ql or ql in ("sus", "7sus"):
        third = 5
    elif "sus2" in ql:
        third = 2
    if major7:
        extra.append(11)
    elif re.search(r"(7|9|11|13)", re.sub(r"add\d+", "", ql)) and "dim" not in ql and "m7b5" not in ql:
        extra.append(10)
    if "9" in ql or "add2" in ql:
        extra.append(2)
    if "6" in ql:
        extra.append(9)
    if "11" in ql or "add4" in ql:
        extra.append(5)
    if "b5" in ql and "m7b5" not in ql:
        fifth = 6
    pcs = {root, (root + third) % 12, (root + fifth) % 12} | {(root + e) % 12 for e in extra}
    bass = pitch_class(m.group(4)) if m.group(4) else root
    pcs.add(bass)
    return {"root": root, "pcs": pcs, "bass": bass, "symbol": s, "fifth": (root + fifth) % 12}


def scale_pcs(key: str, mode: str = "major", chord_pcs: Optional[Set[int]] = None) -> Set[int]:
    tonic = pitch_class(key)
    steps = MAJOR if mode.lower().startswith("maj") or mode.lower() == "ionian" else MINOR
    s = {(tonic + x) % 12 for x in steps}
    if steps is MINOR:
        s.add((tonic + 11) % 12)  # raised leading tone is acceptable (V / V7)
    return s


def normalize_chords(chords: Sequence, bars: int, beats_per_bar: float) -> List[Tuple[float, Dict]]:
    """Accepts ['G','C',...] (one per bar) or [{bar,beat?,symbol}] -> sorted [(start_beat_from_bar0, chord)]."""
    out: List[Tuple[float, Dict]] = []
    for i, c in enumerate(chords):
        if isinstance(c, str):
            out.append((i * beats_per_bar, parse_chord(c)))
        elif isinstance(c, dict):
            sym = c.get("symbol") or c.get("chord")
            out.append((float(c.get("bar", i)) * beats_per_bar + float(c.get("beat", 0)), parse_chord(sym)))
        else:
            raise ValueError("chords entries must be strings or {bar, beat, symbol}")
    out.sort(key=lambda x: x[0])
    # merge identical consecutive chords (so sustained notes are not cut at the barline)
    merged: List[Tuple[float, Dict]] = []
    for b, ch in out:
        if merged and merged[-1][1]["symbol"] == ch["symbol"]:
            continue
        merged.append((b, ch))
    if not merged:
        raise ValueError("chords must not be empty")
    if merged[0][0] > 0:
        merged.insert(0, (0.0, merged[0][1]))
    return merged


def parse_meter(meter) -> Tuple[int, int]:
    if isinstance(meter, (list, tuple)):
        return int(meter[0]), int(meter[1])
    m = re.match(r"^(\d+)\s*/\s*(\d+)$", str(meter))
    if not m:
        raise ValueError(f"Bad meter: {meter!r}")
    return int(m.group(1)), int(m.group(2))


def strong_beats(num: int, den: int) -> List[float]:
    """Strong positions inside a bar, in quarter-note beats."""
    bpb = num * 4.0 / den
    compound = den == 8 and num % 3 == 0 and num >= 6
    if compound:
        return [i * 1.5 for i in range(num // 3)]
    if num == 4 and den == 4:
        return [0.0, 2.0]
    if den == 8:  # 5/8, 7/8 (grouping unknown): bar start + each 2-eighth group would be too dense
        return [0.0]
    return [0.0]
