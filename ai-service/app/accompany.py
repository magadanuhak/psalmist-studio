"""Anticipatory Music Transformer (Stanford CRFM; Apache-2.0 code + Apache-2.0 weights) accompaniment.

Uses the anticipation infilling approach: the melody is injected as *controls* (anticipated events) and the model
infills the accompaniment events around it. Sampling is our own KV-cached loop (same token format/logic as
`anticipation.sample.generate`, which re-runs the whole context for every token and is far too slow for 16 bars) with
hard constraints applied on the logits: instruments, register per instrument, key, chord tones on strong beats,
chord-boundary-clamped durations and a minimum duration.
"""
import io
import threading
import time
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import mido
import numpy as np
import torch

from . import config, theory, vram

_model = None
_lock = threading.Lock()

# General MIDI programs -> (role, low, high). Role decides which pitch classes are allowed.
INSTRUMENTS: Dict[int, Tuple[str, int, int]] = {
    0: ("harmony", 40, 84),    # acoustic grand piano
    4: ("harmony", 40, 84),    # electric piano
    19: ("harmony", 36, 79),   # church organ
    24: ("harmony", 40, 76),   # nylon guitar
    25: ("harmony", 40, 76),   # steel guitar
    27: ("harmony", 40, 79),   # clean electric guitar
    32: ("bass", 28, 52),      # acoustic bass
    33: ("bass", 28, 52),      # finger bass
    46: ("harmony", 48, 88),   # harp
    48: ("pad", 48, 81),       # string ensemble
    52: ("pad", 48, 84),       # choir aahs
    89: ("pad", 48, 81),       # warm pad
}
# style -> (skeleton program or None, model-generated programs).
# The skeleton is a rule-based sustained chord bed that is fed to the model as extra *controls* (together with the
# melody) so the infilled parts (arpeggios, bass, counter-lines) are anchored to the chord chart.
STYLES: Dict[str, Tuple[Optional[int], List[int]]] = {
    "worship": (48, [0, 33]),
    "hymn": (19, [0]),
    "pop": (48, [0, 25, 33]),
    "ballad": (48, [0]),
    "rock": (27, [33, 0]),
    "folk": (25, [32, 0]),
    "popular": (25, [33, 0]),
    "piano": (None, [0]),
    "strings": (None, [48]),
    "guitar": (None, [25]),
    "bass": (None, [33]),
    "full": (48, [0, 33, 25]),
}
DEFAULT_STYLE = "worship"
MELODY_PROGRAM = 73  # flute: a lead instrument that is never part of the accompaniment set

SEQ_MAX = 1020     # model context is 1024 positions incl. the flag token
KEEP_TOKENS = 600  # tokens kept when the context window slides


def load():
    global _model
    with _lock:
        if _model is None:
            from transformers import AutoModelForCausalLM

            vram.ensure_free(1800)

            m = AutoModelForCausalLM.from_pretrained(config.AMT_MODEL, torch_dtype=torch.float16)
            m.eval()
            if torch.cuda.is_available():
                m.cuda()
            _model = m
        return _model


def is_loaded() -> bool:
    return _model is not None


# ------------------------------------------------------------------ input conversion

def read_melody(midi_bytes: bytes, bpm: float) -> List[Tuple[float, float, int]]:
    """MIDI -> [(start_s, dur_s, pitch)] using the *request* tempo (ticks -> beats -> seconds)."""
    mid = mido.MidiFile(file=io.BytesIO(midi_bytes))
    tpb = mid.ticks_per_beat
    notes = []
    for tr in mid.tracks:
        t = 0
        on: Dict[Tuple[int, int], int] = {}
        for msg in tr:
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0:
                if getattr(msg, "channel", 0) == 9:
                    continue
                on.setdefault((msg.channel, msg.note), t)
            elif msg.type in ("note_off", "note_on"):
                k = (getattr(msg, "channel", 0), msg.note)
                if k in on:
                    st = on.pop(k)
                    notes.append((st / tpb * 60.0 / bpm, max(t - st, 1) / tpb * 60.0 / bpm, msg.note))
    notes.sort()
    return notes


class Grid:
    """Beat / bar / chord lookup for times in ticks (10 ms)."""

    def __init__(self, bpm, meter, bars, pickup_beats, chords, key, mode):
        self.num, self.den = theory.parse_meter(meter)
        self.bpb = self.num * 4.0 / self.den
        self.bpm = float(bpm)
        self.pickup = float(pickup_beats)
        self.bars = int(bars)
        self.total_beats = self.pickup + self.bars * self.bpb
        self.total_s = self.total_beats * 60.0 / self.bpm
        self.strong = theory.strong_beats(self.num, self.den)
        self.chords = theory.normalize_chords(chords, self.bars, self.bpb)
        self.chord_starts = [self.pickup + b for b, _ in self.chords]
        self.key, self.mode = key, mode
        self.scale = theory.scale_pcs(key, mode)
        self.bar_ticks = int(round(self.bpb * 60.0 / self.bpm * 100))

    def beat_of(self, tick: int) -> float:
        return tick / 100.0 * self.bpm / 60.0

    def chord_index(self, tick: int) -> int:
        b = self.beat_of(tick) + 0.03  # tolerance: 10 ms tick rounding at chord boundaries
        idx = 0
        for i, s in enumerate(self.chord_starts):
            if b >= s:
                idx = i
        return idx

    def next_boundary_tick(self, tick: int) -> Optional[int]:
        i = self.chord_index(tick)
        if i + 1 < len(self.chord_starts):
            return int(round(self.chord_starts[i + 1] * 60.0 / self.bpm * 100))
        return None

    def is_strong(self, tick: int) -> bool:
        b = self.beat_of(tick) - self.pickup
        if b < -0.12:
            return False
        pos = b % self.bpb
        return any(abs(pos - s) < 0.13 or abs(pos - s - self.bpb) < 0.13 for s in self.strong)


def pitch_allowed(grid: Grid, prog: int, pitch: int, ch: dict, strong: bool) -> bool:
    role, lo, hi = INSTRUMENTS[prog]
    if not lo <= pitch <= hi:
        return False
    pc = pitch % 12
    if role == "bass":
        return pc in (ch["bass"], ch["root"]) if strong else (pc in (ch["bass"], ch["root"], ch["fifth"]))
    return pc in ch["pcs"] if strong else (pc in ch["pcs"] or pc in grid.scale)


class Constraints:
    """Boolean allowed-note masks over the NOTE vocabulary, cached per (chord, strong-beat)."""

    def __init__(self, grid: Grid, programs: Sequence[int], device):
        from anticipation.vocab import MAX_NOTE

        self.grid, self.programs, self.device = grid, list(programs), device
        self.MAX_NOTE = MAX_NOTE
        self.cache: Dict[Tuple[int, bool], torch.Tensor] = {}

    def note_mask(self, tick: int) -> torch.Tensor:
        ci, strong = self.grid.chord_index(tick), self.grid.is_strong(tick)
        key = (ci, strong)
        if key not in self.cache:
            ch = self.grid.chords[ci][1]
            m = np.zeros(self.MAX_NOTE, dtype=bool)
            for prog in self.programs:
                for p in range(128):
                    if pitch_allowed(self.grid, prog, p, ch, strong):
                        m[prog * 128 + p] = True
            self.cache[key] = torch.from_numpy(m).to(self.device)
        return self.cache[key]


def build_skeleton(grid: Grid, program: int, lo: int = 52, hi: int = 70):
    """Sustained closed-position chord per bar (smooth voice leading) -> [(start_tick, dur_tick, program, pitch)]."""
    out = []
    target = 60.0
    n_bars = grid.bars
    for bar in range(n_bars):
        t0 = int(round((grid.pickup + bar * grid.bpb) * 60.0 / grid.bpm * 100))
        t1 = int(round((grid.pickup + (bar + 1) * grid.bpb) * 60.0 / grid.bpm * 100))
        # split the bar at chord changes
        cuts = [t0] + [c for c in (int(round(b * 60.0 / grid.bpm * 100)) for b in grid.chord_starts) if t0 < c < t1]
        cuts.append(t1)
        for a, b in zip(cuts[:-1], cuts[1:]):
            ch = grid.chords[grid.chord_index(a)][1]
            order = [ch["root"]] + [pc for pc in sorted(ch["pcs"]) if pc != ch["root"] and pc != ch["bass"]]
            pitches = []
            for pc in order[:4]:
                cands = [p for p in range(lo, hi + 1) if p % 12 == pc and p not in pitches]
                if cands:
                    pitches.append(min(cands, key=lambda p: abs(p - target)))
            if pitches:
                target = sum(pitches) / len(pitches)
            for pch in pitches:
                out.append((a, max(b - a - 4, 8), program, pch))
    return out


# ------------------------------------------------------------------ sampling

class _Ctx:
    """KV-cached feeding of the (time-relativised) token stream."""

    def __init__(self, model, z):
        self.model, self.z = model, z
        self.reset(0, 0)

    def reset(self, win_start: int, offset: int):
        self.past = None
        self.win_start, self.offset, self.fed, self.flag_fed = win_start, offset, win_start, False

    def pending(self, tokens: List[int]) -> List[int]:
        out = [tok - self.offset if j % 3 == 0 else tok for j, tok in enumerate(tokens) if j >= self.fed]
        # enumerate keeps absolute index j so the "time slot" parity is right
        self.fed = len(tokens)
        return out

    def feed(self, rel_tokens: List[int]) -> torch.Tensor:
        seq = ([] if self.flag_fed else [self.z]) + rel_tokens
        self.flag_fed = True
        ids = torch.tensor([seq], device=self.model.device)
        with torch.no_grad():
            out = self.model(ids, past_key_values=self.past, use_cache=True)
        self.past = out.past_key_values
        return out.logits[0, -1].float()

    def seq_len(self, tokens: List[int]) -> int:
        return 1 + len(tokens) - self.win_start


def _time_of(tok: int, control_offset: int) -> int:
    return tok - control_offset if tok >= control_offset else tok


def generate(model, grid: Grid, melody, programs: Sequence[int], top_p: float = 0.95, seed: Optional[int] = None,
             progress: Optional[Callable[[float], None]] = None, melody_program: int = MELODY_PROGRAM,
             max_events: int = 2500, min_dur: int = 8, temperature: float = 1.0, max_gap_s: Optional[float] = None,
             skeleton: Optional[Sequence[Tuple[int, int, int, int]]] = None):
    """Returns sorted [(start_tick, dur_tick, program, pitch)] accompaniment events (10 ms ticks)."""
    from anticipation import ops
    from anticipation.config import DELTA, MAX_DUR, MAX_TIME, TIME_RESOLUTION
    from anticipation.sample import nucleus, safe_logits
    from anticipation.vocab import (ANTICIPATE, ATIME_OFFSET, AUTOREGRESS, CONTROL_OFFSET, DUR_OFFSET, NOTE_OFFSET,
                                    TIME_OFFSET)

    if seed is not None:
        torch.manual_seed(seed)
    end_tick = int(round(grid.total_s * TIME_RESOLUTION))
    delta = DELTA * TIME_RESOLUTION
    max_gap = int(max_gap_s * TIME_RESOLUTION) if max_gap_s else grid.bar_ticks // 2

    ctl: List[int] = []  # melody as anticipated controls
    for st, du, pitch in melody:
        t = int(round(st * TIME_RESOLUTION))
        if t >= end_tick:
            continue
        d = max(1, min(int(round(du * TIME_RESOLUTION)), MAX_DUR - 1))
        ctl.extend([CONTROL_OFFSET + TIME_OFFSET + t, CONTROL_OFFSET + DUR_OFFSET + d,
                    CONTROL_OFFSET + NOTE_OFFSET + melody_program * 128 + pitch])
    for t, d, prog, pitch in skeleton or ():
        ctl.extend([CONTROL_OFFSET + TIME_OFFSET + t, CONTROL_OFFSET + DUR_OFFSET + min(d, MAX_DUR - 1),
                    CONTROL_OFFSET + NOTE_OFFSET + prog * 128 + pitch])
    ctl = ops.sort(ctl)
    ctx = _Ctx(model, ANTICIPATE if ctl else AUTOREGRESS)
    cons = Constraints(grid, programs, model.device)
    tokens: List[int] = []  # absolute events + injected controls (z excluded)
    nxt, cur, n_events = 0, 0, 0

    while True:
        while nxt < len(ctl) and cur >= (ctl[nxt] - ATIME_OFFSET) - delta:
            tokens.extend(ctl[nxt:nxt + 3])
            nxt += 3
        if ctx.seq_len(tokens) + 3 > SEQ_MAX:  # slide the window
            ws = max(0, (len(tokens) - KEEP_TOKENS) // 3 * 3)
            ctx.reset(ws, min(_time_of(t, CONTROL_OFFSET) for t in tokens[ws::3]))
        off = ctx.offset
        new: List[int] = []
        for i in range(3):
            lg = ctx.feed(ctx.pending(tokens) if i == 0 else [new[-1]])
            lg = safe_logits(lg, i)  # position parity == slot (history is always whole triples)
            if i == 0:
                if cur - off > 0:
                    lg[TIME_OFFSET:TIME_OFFSET + cur - off] = -float("inf")
                # the model happily "ends the piece" when it only has a lone melody: cap the silence between events
                lg[TIME_OFFSET + cur - off + max_gap + 1:TIME_OFFSET + MAX_TIME] = -float("inf")
            elif i == 1:
                t_abs = new[0] - TIME_OFFSET + off
                hi = min(grid.bar_ticks * 3 // 2, MAX_DUR - 1)
                nb = grid.next_boundary_tick(t_abs)
                if nb is not None and nb - t_abs >= min_dur:
                    hi = min(hi, nb - t_abs)
                hi = max(hi, min_dur)
                lg[DUR_OFFSET:DUR_OFFSET + min_dur] = -float("inf")
                lg[DUR_OFFSET + hi + 1:DUR_OFFSET + MAX_DUR] = -float("inf")
            else:
                t_abs = new[0] - TIME_OFFSET + off
                seg = lg[NOTE_OFFSET:NOTE_OFFSET + cons.MAX_NOTE]
                seg[~cons.note_mask(t_abs)] = -float("inf")
            if temperature != 1.0:
                lg = lg / temperature
            probs = torch.softmax(nucleus(lg, top_p), dim=-1)
            new.append(int(torch.multinomial(probs, 1)))
        new_time = new[0] - TIME_OFFSET + off
        if new_time >= end_tick or n_events >= max_events:
            break
        tokens.extend([new[0] + off, new[1], new[2]])
        ctx.fed = len(tokens) - 1  # note token (last) is not in the KV cache yet
        n_events += 1
        cur = new_time
        if progress:
            progress(min(0.99, cur / max(end_tick, 1)))

    out = []
    for t, d, n in zip(tokens[0::3], tokens[1::3], tokens[2::3]):
        if n >= CONTROL_OFFSET:
            continue
        note = n - NOTE_OFFSET
        out.append((t - TIME_OFFSET, d - DUR_OFFSET, note // 128, note % 128))
    out.sort()
    return out


# ------------------------------------------------------------------ output

def events_to_midi(events, grid: Grid, melody=None, quantize: bool = True, include_melody: bool = False,
                   melody_program: int = MELODY_PROGRAM) -> Tuple[bytes, dict]:
    """Accompaniment events (+ optional melody) -> Standard MIDI file bytes (480 tpb, request tempo/meter)."""
    tpb = 480
    sec_to_beat = grid.bpm / 60.0
    compound = grid.den == 8 and grid.num % 3 == 0 and grid.num >= 6
    step = 1.0 / 6.0 if compound else 0.25  # grid in quarter-note beats
    per_prog: Dict[int, List[Tuple[int, int, int]]] = {}
    for st, du, prog, pitch in events:
        b0 = st / 100.0 * sec_to_beat
        b1 = (st + du) / 100.0 * sec_to_beat
        if quantize:
            b0q = round(b0 / step) * step
            b1q = max(round(b1 / step) * step, b0q + step)
            nb = grid.next_boundary_tick(int(round(b0q / sec_to_beat * 100)))
            if nb is not None:  # never let quantisation push a note over the chord boundary
                b1q = min(b1q, nb / 100.0 * sec_to_beat)
                b1q = max(b1q, b0q + step / 2)
            b0, b1 = b0q, b1q
        if quantize and prog in INSTRUMENTS:  # quantisation may move a note onto another chord / a strong beat
            tick = int(round(b0 / sec_to_beat * 100))
            ch = grid.chords[grid.chord_index(tick)][1]
            strong = grid.is_strong(tick)
            if not pitch_allowed(grid, prog, pitch, ch, strong):
                alts = [p for d in range(1, 7) for p in (pitch - d, pitch + d) if pitch_allowed(grid, prog, p, ch, strong)]
                if not alts:
                    continue
                pitch = alts[0]
        per_prog.setdefault(prog, []).append((int(round(b0 * tpb)), int(round(b1 * tpb)), pitch))
    # drop duplicates created by quantisation and trim overlaps of the same pitch within a program
    stats_notes = 0
    mid = mido.MidiFile(type=1, ticks_per_beat=tpb)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(grid.bpm), time=0))
    meta.append(mido.MetaMessage("time_signature", numerator=grid.num, denominator=grid.den, time=0))
    meta.append(mido.MetaMessage("key_signature", key=_mido_key(grid.key, grid.mode), time=0))
    mid.tracks.append(meta)
    chan = 0
    tracks = list(per_prog.items())
    if include_melody and melody:
        tracks.append((melody_program, [(int(round(s * sec_to_beat * tpb)), int(round((s + d) * sec_to_beat * tpb)), p)
                                        for s, d, p in melody]))
    for prog, notes in tracks:
        if chan == 9:
            chan += 1
        notes = sorted(set(notes))
        last: Dict[int, int] = {}
        cleaned = []
        for a, b, p in notes:
            if p in last and a < last[p]:
                continue
            last[p] = b
            cleaned.append((a, b, p))
        stats_notes += len(cleaned) if prog != melody_program or not include_melody else 0
        tr = mido.MidiTrack()
        tr.append(mido.MetaMessage("track_name", name=f"AI {INSTRUMENTS.get(prog, ('melody',))[0]} gm{prog}", time=0))
        tr.append(mido.Message("program_change", program=prog, channel=chan, time=0))
        msgs = []
        for a, b, p in cleaned:
            msgs.append((a, 1, mido.Message("note_on", note=p, velocity=_vel(prog, p), channel=chan)))
            msgs.append((b, 0, mido.Message("note_off", note=p, velocity=0, channel=chan)))
        msgs.sort(key=lambda x: (x[0], x[1]))
        t = 0
        for at, _, m in msgs:
            tr.append(m.copy(time=at - t))
            t = at
        mid.tracks.append(tr)
        chan += 1
    buf = io.BytesIO()
    mid.save(file=buf)
    return buf.getvalue(), {"notes": stats_notes, "programs": sorted(per_prog)}


def _vel(prog: int, pitch: int) -> int:
    role = INSTRUMENTS.get(prog, ("harmony",))[0]
    return {"bass": 88, "pad": 62, "harmony": 72}[role]


_FLAT_KEYS = {"F": 5, "Bb": 10, "Eb": 3, "Ab": 8, "Db": 1, "Gb": 6}


def _mido_key(key: str, mode: str) -> str:
    # mido wants names like 'C', 'Am', 'F#', 'Bb'; fall back to C if it cannot represent the key
    k = key.strip()
    k = k[0].upper() + k[1:].replace("♯", "#").replace("♭", "b")
    name = k + ("m" if mode.lower().startswith("min") else "")
    try:
        mido.MetaMessage("key_signature", key=name)
        return name
    except Exception:  # noqa: BLE001
        return "C"
