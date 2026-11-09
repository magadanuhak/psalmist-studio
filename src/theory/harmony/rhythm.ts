import type { Genre, Note, TimeSig } from '../../model/types';
import type { HarmonicRate, HarmonySlot } from './types';
import type { BeatMap } from './beatmap';

/** Harmonic rhythm by genre / meter / tempo (chords per bar; 0.5 = one chord per two bars). */
export function autoRate(genre: Genre, sig: TimeSig, bpm: number): 0.5 | 1 | 2 {
  const folk = sig.den === 8 && sig.num !== 6 && sig.num !== 9; // 7/8, 5/8
  if (folk || sig.num === 9) return 1;
  if (sig.num === 3 || (sig.num === 6 && sig.den === 8)) return 1;
  void genre; void bpm;
  return 1;
}

/** Beat offsets (within a bar) where chords may change for a given rate. */
export function slotStarts(sig: TimeSig, rate: 0.5 | 1 | 2): number[] {
  if (rate !== 2) return [0];
  const starts: number[] = [];
  let p = 0;
  for (const g of sig.grouping) { starts.push(p); p += g; }
  const half = sig.num / 2;
  const inner = starts.filter((s) => s > 0);
  let cut: number;
  if (inner.length) cut = inner.reduce((b, s) => (Math.abs(s - half) < Math.abs(b - half) ? s : b));
  else cut = Math.floor(half);
  return cut > 0 && cut < sig.num ? [0, cut] : [0];
}

/** Metric strength of a beat position within the bar (beats, may be fractional). */
export function metricWeight(posInBar: number, sig: TimeSig): number {
  const frac = posInBar - Math.floor(posInBar);
  if (frac > 1e-6) return 0.3;
  const b = Math.floor(posInBar + 1e-6);
  if (b === 0) return 1.0;
  let p = 0;
  for (const g of sig.grouping) { if (b === p) return 0.8; p += g; }
  if (sig.num === 4 && b === 2) return 0.7;
  // compound meters (12/8): the eighths inside a beat group are the subdivision, not beats
  if (sig.den === 8 && sig.grouping.every((g) => g === 3)) return 0.3;
  return 0.6;
}
export const isStrong = (posInBar: number, sig: TimeSig) => metricWeight(posInBar, sig) >= 0.7;

export function detectBarsWithPause(notes: Note[], bpm: number, sig: TimeSig, bars: number, bm?: BeatMap): Set<number> {
  const unit = sig.den === 8 && sig.grouping.every((g) => g === 3) && sig.num >= 12 ? 3 : 1; // a pause of one felt beat = 3 eighths in 12/8
  const beat = (60 / bpm) * unit;
  const bar = beat * sig.num;
  if (bm) {
    const sortedB = [...notes].sort((a, b) => a.startSec - b.startSec);
    const outB = new Set<number>();
    for (let i = 0; i < sortedB.length; i++) {
      const eb = bm.beatOfTime(sortedB[i].startSec + sortedB[i].durSec);
      const nb = i + 1 < sortedB.length ? bm.beatOfTime(sortedB[i + 1].startSec) : bars * sig.num;
      if (nb - eb >= 0.95 * unit) {
        const k = Math.round(eb / sig.num);
        if (Math.abs(eb - k * sig.num) <= 1.6 * unit && k >= 1) outB.add(k);
      }
    }
    return outB;
  }
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);
  const out = new Set<number>();
  for (let i = 0; i + 1 <= sorted.length; i++) {
    const end = sorted[i].startSec + sorted[i].durSec;
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].startSec : bars * bar;
    if (nextStart - end >= beat * 0.95) {
      const k = Math.round(end / bar); // bar boundary count where the phrase ends
      if (Math.abs(end - k * bar) <= beat * 1.6 && k >= 1) out.add(k);
    }
  }
  return out;
}

/** Bars (counts) after which a phrase ends: pauses >= 1 beat + 2/4/8-bar grouping. */
export function phraseEndBars(notes: Note[], bpm: number, sig: TimeSig, bars: number, bm?: BeatMap): number[] {
  const pauses = detectBarsWithPause(notes, bpm, sig, bars, bm);
  const cuts: number[] = [];
  for (let k = 2; k < bars; k += 2) {
    if (k % 4 === 0) cuts.push(k);
    else if (pauses.has(k)) cuts.push(k);
  }
  // drop cuts that would leave a one-bar phrase
  const out: number[] = [];
  let last = 0;
  for (const k of cuts) { if (k - last >= 2) { out.push(k); last = k; } }
  if (bars - last < 2 && out.length) out.pop();
  out.push(bars);
  return out;
}

export function buildSlots(o: {
  bars: number; bpm: number; sig: TimeSig; rate: 0.5 | 1 | 2; notes: Note[]; bm?: BeatMap;
}): HarmonySlot[] {
  const { bars, bpm, sig, rate } = o;
  const beat = 60 / bpm;
  const ends = new Set(phraseEndBars(o.notes, bpm, sig, bars, o.bm));
  const timeOf = (b: number) => (o.bm ? o.bm.timeOfBeat(b) : b * beat);
  const slots: HarmonySlot[] = [];
  const add = (bar: number, startBeatInBar: number, beats: number, endBar: number) => {
    const startBeat = bar * sig.num + startBeatInBar;
    slots.push({
      idx: slots.length, bar, startBeat, beats, startSec: timeOf(startBeat), durSec: timeOf(startBeat + beats) - timeOf(startBeat),
      phraseEnd: ends.has(endBar),
    });
  };
  if (rate === 0.5) {
    for (let b = 0; b < bars; b += 2) {
      const span = Math.min(2, bars - b);
      add(b, 0, span * sig.num, b + span);
    }
  } else {
    const starts = slotStarts(sig, rate);
    for (let b = 0; b < bars; b++) {
      starts.forEach((s, i) => {
        const next = i + 1 < starts.length ? starts[i + 1] : sig.num;
        add(b, s, next - s, i === starts.length - 1 ? b + 1 : -1);
      });
    }
  }
  return slots;
}

export const resolveRate = (r: HarmonicRate | undefined, genre: Genre, sig: TimeSig, bpm: number): 0.5 | 1 | 2 =>
  !r || r === 'auto' ? autoRate(genre, sig, bpm) : r;
