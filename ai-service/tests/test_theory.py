"""Pure-python unit tests (no GPU / no server):  python -m pytest tests/test_theory.py"""
import sys

sys.path.insert(0, __file__.rsplit("tests", 1)[0])
from app import theory  # noqa: E402


def pcs(sym):
    return sorted(theory.parse_chord(sym)["pcs"])


def test_chord_qualities():
    assert pcs("G") == [2, 7, 11]
    assert pcs("Em") == [4, 7, 11]
    assert pcs("G7") == [2, 5, 7, 11]
    assert pcs("Dm7") == [0, 2, 5, 9]
    assert pcs("Cmaj7") == [0, 4, 7, 11]
    assert pcs("Bdim") == [2, 5, 11]
    assert pcs("Cadd9") == [0, 2, 4, 7]
    assert theory.parse_chord("G/B")["bass"] == 11


def test_scale_and_meter():
    assert theory.scale_pcs("G", "major") == {7, 9, 11, 0, 2, 4, 6}
    assert theory.parse_meter("6/8") == (6, 8)
    assert theory.strong_beats(6, 8) == [0.0, 1.5]
    assert theory.strong_beats(4, 4) == [0.0, 2.0]


def test_chord_chart_merging():
    ch = theory.normalize_chords(["G", "G", "C"], 3, 3.0)
    assert [b for b, _ in ch] == [0.0, 6.0]  # identical consecutive chords are merged
    ch = theory.normalize_chords([{"bar": 1, "beat": 2, "symbol": "D7"}], 4, 4.0)
    assert ch[0][0] == 0.0 and ch[1][0] == 6.0
