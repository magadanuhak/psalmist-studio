/** Vocal trainer: exercises (target notes on a timeline) and deterministic scoring. No audio, no React. */
import type { KeySig } from '../model/types';
import { scalePcs } from './theory';

export interface Target { midi: number; startSec: number; durSec: number }
export interface PitchSample { t: number; /** fractional midi, null = unvoiced */ midi: number | null }
export type ExerciseKind = 'hold' | 'scale' | 'interval' | 'song';

export interface Exercise { kind: ExerciseKind; title: string; targets: Target[]; totalSec: number }

export const INTERVALS: { semis: number; name: string }[] = [
  { semis: 2, name: 'secundă mare' }, { semis: 3, name: 'terță mică' }, { semis: 4, name: 'terță mare' }, { semis: 5, name: 'cvartă' },
  { semis: 7, name: 'cvintă' }, { semis: 9, name: 'sextă mare' }, { semis: 12, name: 'octavă' },
];

/** a held note: `holdSec` seconds on one pitch */
export function holdExercise(midi: number, holdSec = 5): Exercise {
  return { kind: 'hold', title: 'hold', targets: [{ midi, startSec: 0, durSec: holdSec }], totalSec: holdSec };
}

/** a scale up and back down, `noteSec` per note, starting on the tonic nearest to `anchor` */
export function scaleExercise(key: KeySig, anchor: number, noteSec = 0.9, octaves = 1): Exercise {
  const pcs = [...scalePcs(key)].sort((a, b) => ((a - key.tonic + 12) % 12) - ((b - key.tonic + 12) % 12));
  let root = anchor - ((((anchor - key.tonic) % 12) + 12) % 12);
  if (anchor - root > 6) root += 12;
  const up: number[] = [];
  for (let o = 0; o < octaves; o++) for (const pc of pcs) up.push(root + o * 12 + ((pc - key.tonic + 12) % 12));
  up.push(root + octaves * 12);
  const seq = [...up, ...up.slice(0, -1).reverse()];
  const targets = seq.map((m, i) => ({ midi: m, startSec: i * noteSec, durSec: noteSec * 0.92 }));
  return { kind: 'scale', title: 'scale', targets, totalSec: seq.length * noteSec };
}

/** root then the interval above (or below), `reps` times; the root wobbles 0, +2, +4 semitones to keep the range tight */
export function intervalExercise(rootMidi: number, semis: number, dir: 1 | -1 = 1, reps = 6, noteSec = 1.2): Exercise {
  const targets: Target[] = [];
  for (let r = 0; r < reps; r++) {
    const root = rootMidi + (r % 3) * 2;
    targets.push({ midi: root, startSec: r * 2 * noteSec, durSec: noteSec * 0.92 }, { midi: root + dir * semis, startSec: (r * 2 + 1) * noteSec, durSec: noteSec * 0.92 });
  }
  return { kind: 'interval', title: 'interval', targets, totalSec: reps * 2 * noteSec };
}

export interface NoteScore { target: Target; /** 0..100 */ score: number; hitSec: number; voicedSec: number; medianCents: number | null }
export interface TrainerScore { total: number; stars: 0 | 1 | 2 | 3; notes: NoteScore[]; /** average of |cents| on hit frames */ meanAbsCents: number | null }

export interface ScoreOptions {
  /** a frame counts as a hit within this many cents of the target */
  toleranceCents?: number;
  /** seconds ignored at the start of each note (reaction + glide) */
  graceSec?: number;
  /** compare pitch classes: a voice an octave away still scores (men singing a woman's line) */
  octaveFree?: boolean;
  /** latency of the microphone path, seconds (samples are shifted back by this) */
  latencySec?: number;
}

const centsBetween = (midi: number, target: number, octaveFree: boolean) => {
  let d = (midi - target) * 100;
  if (octaveFree) d = ((((d + 600) % 1200) + 1200) % 1200) - 600;
  return d;
};

/** Deterministic: the same samples and targets always give the same score. */
export function scoreAttempt(targets: Target[], samples: PitchSample[], o: ScoreOptions = {}): TrainerScore {
  const tol = o.toleranceCents ?? 50, grace = o.graceSec ?? 0.25, free = o.octaveFree ?? true, lat = o.latencySec ?? 0;
  const s = samples.map((x) => ({ ...x, t: x.t - lat })).sort((a, b) => a.t - b.t);
  const notes: NoteScore[] = [];
  const hitCents: number[] = [];
  for (const tg of targets) {
    const from = tg.startSec + Math.min(grace, tg.durSec * 0.4), to = tg.startSec + tg.durSec;
    let hit = 0, voiced = 0;
    const errs: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const t = s[i].t;
      if (t < from || t >= to) continue;
      const dt = Math.min(0.04, (s[i + 1]?.t ?? t + 0.02) - t);
      const m = s[i].midi;
      if (m == null) continue;
      voiced += dt;
      const c = centsBetween(m, tg.midi, free);
      if (Math.abs(c) <= tol) { hit += dt; errs.push(Math.abs(c)); }
    }
    const win = Math.max(0.05, to - from);
    const sorted = [...errs].sort((a, b) => a - b);
    notes.push({ target: tg, score: Math.round(100 * Math.min(1, hit / win)), hitSec: hit, voicedSec: voiced, medianCents: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null });
    hitCents.push(...errs);
  }
  const wsum = targets.reduce((a, t) => a + t.durSec, 0) || 1;
  const total = Math.round(notes.reduce((a, n) => a + n.score * n.target.durSec, 0) / wsum);
  return { total, stars: total >= 90 ? 3 : total >= 70 ? 2 : total >= 50 ? 1 : 0, notes, meanAbsCents: hitCents.length ? hitCents.reduce((a, b) => a + b, 0) / hitCents.length : null };
}

/** median-of-N smoothing of the live pitch, so a single wrong frame does not jerk the line */
export class PitchSmoother {
  private buf: (number | null)[] = [];
  constructor(private n = 3) {}
  push(m: number | null): number | null {
    this.buf.push(m);
    if (this.buf.length > this.n) this.buf.shift();
    const v = this.buf.filter((x): x is number => x != null).sort((a, b) => a - b);
    if (v.length * 2 < this.buf.length) return null;
    return v[Math.floor(v.length / 2)];
  }
}
