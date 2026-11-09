/** Bar grid from the user's taps (or from bar times of any detector): the grid the user gives overrides the estimate from the vocal. */
import type { TapIn } from './meter';

export interface TapGrid { barSec: number; beatSec: number; t0: number; bpm: number; bars: number }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

/** Least-squares line through (index, time) where each time is assigned its bar index from a rough period. */
function fitLine(times: number[], period: number): { period: number; t: number } | null {
  if (times.length < 2) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const idx: number[] = [0];
  for (let i = 1; i < sorted.length; i++) idx.push(idx[i - 1] + Math.max(1, Math.round((sorted[i] - sorted[i - 1]) / period)));
  const n = sorted.length;
  const mi = idx.reduce((a, b) => a + b, 0) / n, mt = sorted.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (idx[i] - mi) * (sorted[i] - mt); den += (idx[i] - mi) ** 2; }
  if (den === 0) return null;
  const p = num / den;
  return { period: p, t: mt - p * mi };
}

/** @param bars times (s) of bar lines (every bar, or just the first ones) */
export function gridFromBars(bars: number[], beatsPerBar = 4, minGap = 0.4): TapGrid | null {
  const b = [...bars].filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (b.length < 2) return null;
  const diffs = b.slice(1).map((x, i) => x - b[i]).filter((d) => d > minGap);
  if (!diffs.length) return null;
  const rough = median(diffs);
  const line = fitLine(b, rough);
  if (!line || line.period <= 0) return null;
  const barSec = line.period;
  const t0 = ((line.t % barSec) + barSec) % barSec;
  return { barSec, beatSec: barSec / beatsPerBar, t0, bpm: Math.round((60 * beatsPerBar) / barSec * 10) / 10, bars: b.length };
}

/**
 * Taps -> grid. Needs the taps marked "1" (downbeats; at least 3) or, otherwise, plain beat taps (at least 5) with the first "1" (or the first tap) as the bar line.
 * Wild taps (a stumble) are ignored: only intervals within 25% of the median are used.
 */
export function gridFromTaps(taps: TapIn[], beatsPerBar = 4): TapGrid | null {
  const downs = taps.filter((t) => t.down).map((t) => t.t);
  if (downs.length >= 3) return gridFromBars(downs, beatsPerBar);
  const all = taps.map((t) => t.t).sort((a, b) => a - b);
  if (all.length < 5) return null;
  const d = all.slice(1).map((x, i) => x - all[i]);
  const m = median(d);
  const good = all.filter((t, i) => i === 0 || Math.abs(t - all[i - 1] - m) < 0.25 * m || Math.abs(t - all[i - 1] - 2 * m) < 0.25 * m);
  const line = fitLine(good, m);
  if (!line) return null;
  const beat = line.period;
  const barSec = beat * beatsPerBar;
  const first = downs[0] ?? good[0];
  const t0 = ((first % barSec) + barSec) % barSec;
  return { barSec, beatSec: beat, t0, bpm: Math.round(60 / beat * 10) / 10, bars: Math.floor(good.length / beatsPerBar) };
}
