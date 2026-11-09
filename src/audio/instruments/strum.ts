/** Guitar strum engine: staggered string onsets (8-25 ms), down/up strokes, muted ghost strokes. Pure functions. */
import { hashSeed, mulberry32, type NoteEv } from './humanize';

export type Stroke = 'D' | 'U' | 'x' | '-';

export const STRUM_GAP_MIN_MS = 8;
export const STRUM_GAP_MAX_MS = 25;

export interface StrumOptions {
  time: number;
  dur: number;
  vel: number;
  dir: 'D' | 'U' | 'x';
  /** 0 (soft, slow strum) .. 1 (hard, fast strum) */
  energy?: number;
  seed: number;
  /** override the per-string gap in ms (still clamped to 8..25) */
  gapMs?: number;
  /** articulation id for the strummed notes (e.g. 'strum') */
  art?: string;
}

/** Per-string gap in ms for the given energy: soft = slow roll (~22 ms), hard = tight (~9 ms). */
export function strumGapMs(energy: number): number {
  const e = Math.min(1, Math.max(0, energy));
  return STRUM_GAP_MAX_MS - (STRUM_GAP_MAX_MS - STRUM_GAP_MIN_MS - 1) * e - 1;
}

/** Fold chord tones onto a 6-string guitar range (E2..E5), sorted low to high, at most 6 notes. */
export function guitarVoicing(midis: readonly number[], lo = 40, hi = 76): number[] {
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))];
  if (!pcs.length) return [];
  const root = ((Math.min(...midis) % 12) + 12) % 12;
  const out: number[] = [];
  let m = lo; while (((m % 12) + 12) % 12 !== root) m++;
  out.push(m); // bass note = root
  const rest = pcs.filter((p) => p !== root);
  const ordered = [...rest, root, ...rest, root, ...rest];
  let cur = m;
  for (const pc of ordered) {
    if (out.length >= 6) break;
    let n = cur + 1; while (((n % 12) + 12) % 12 !== pc) n++;
    if (n > hi) break;
    out.push(n); cur = n;
  }
  return out;
}

/**
 * Turn one chord (low to high) into staggered note events. Down: low to high with a natural taper;
 * up: high to low on the top 4 strings only, softer. 'x' = muted ghost stroke (short, quiet, all strings).
 */
export function strumChord(strings: readonly number[], o: StrumOptions): NoteEv[] {
  const r = mulberry32(hashSeed(o.seed, o.time * 1000, strings[0] ?? 0, o.dir.charCodeAt(0)));
  const base = o.gapMs ?? strumGapMs(o.energy ?? 0.5);
  const sorted = [...strings].sort((a, b) => a - b);
  let order = o.dir === 'U' ? sorted.slice().reverse().slice(0, Math.min(4, sorted.length)) : sorted;
  if (o.dir === 'x') order = sorted;
  let t = o.time;
  const out: NoteEv[] = [];
  order.forEach((midi, i) => {
    if (i > 0) { const gap = Math.min(STRUM_GAP_MAX_MS, Math.max(STRUM_GAP_MIN_MS, base * (0.85 + r() * 0.3))); t += gap / 1000; }
    const taper = o.dir === 'D' ? 1 - 0.14 * (i / Math.max(1, order.length - 1)) : o.dir === 'U' ? 0.78 + 0.1 * (i / Math.max(1, order.length - 1)) : 0.35;
    const jitter = 1 + (r() - 0.5) * 0.08;
    out.push({
      midi, time: t, dur: o.dir === 'x' ? Math.min(0.07, o.dur) : Math.max(0.05, o.dur - (t - o.time)),
      vel: Math.min(1, Math.max(0.02, o.vel * taper * jitter)), art: o.dir === 'x' ? 'mute' : o.art,
    });
  });
  return out;
}

/** Strum patterns on an 8th-note grid: D down, U up, x ghost (muted), - rest. */
export const STRUM_PATTERNS: Record<string, { low: string; mid: string; high: string }> = {
  '4/4': { low: 'D---D-U-', mid: 'D-DUxUDU', high: 'DDUUxUDU' },
  '3/4': { low: 'D-D-D-', mid: 'D-DUDU', high: 'DUDUDU' },
  '6/8': { low: 'D--D--', mid: 'D-UD-U', high: 'DUUDUU' },
  '2/4': { low: 'D-D-', mid: 'D-UU', high: 'DUDU' },
};

export function patternFor(sig: string, energy: number): string {
  const p = STRUM_PATTERNS[sig] ?? STRUM_PATTERNS['4/4'];
  return energy < 0.35 ? p.low : energy < 0.7 ? p.mid : p.high;
}

export interface StrumBarOptions { startSec: number; bpm: number; vel: number; energy: number; seed: number; sig?: string; art?: string; pattern?: string }

/** Strum one bar: `grid` pattern chars each last half a beat (8th). Down strokes on beat 1 are accented. */
export function strumBar(strings: readonly number[], o: StrumBarOptions): NoteEv[] {
  const pat = o.pattern ?? patternFor(o.sig ?? '4/4', o.energy);
  const eighth = 30 / o.bpm; const out: NoteEv[] = [];
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i] as Stroke; if (c === '-') continue;
    const accent = i === 0 ? 1.08 : i % 2 === 0 ? 1 : 0.9;
    out.push(...strumChord(strings, { time: o.startSec + i * eighth, dur: eighth * 1.8, vel: Math.min(1, o.vel * accent), dir: c, energy: o.energy, seed: o.seed + i, art: o.art }));
  }
  return out;
}
