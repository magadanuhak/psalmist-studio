/** Seeded, deterministic humanization (timing + velocity jitter by family) and groove templates. Pure functions. */
import type { Family } from './types';

export interface NoteEv {
  midi: number;
  /** seconds from the start of the rendered timeline */
  time: number;
  dur: number;
  /** 0..1 */
  vel: number;
  /** optional articulation id (sampler) */
  art?: string;
  /** optional attack override in seconds */
  attack?: number;
  /** extra linear gain */
  gain?: number;
}

/** mulberry32 PRNG: tiny, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of numbers (order matters). */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    h ^= (Math.round(p) | 0) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export interface HumanProfile {
  /** max timing offset (ms) at amount = 1; spec: 8-15 ms */
  timingMs: number;
  /** max relative velocity change (+-) */
  velJitter: number;
  /** relative duration jitter (+-) */
  durJitter: number;
  /** constant lay-back (ms) added to every note (negative = pushing) */
  layback: number;
}

export const HUMAN_PROFILES: Record<Family, HumanProfile> = {
  keys: { timingMs: 9, velJitter: 0.07, durJitter: 0.04, layback: 0 },
  organ: { timingMs: 8, velJitter: 0.03, durJitter: 0.02, layback: 0 },
  strings: { timingMs: 15, velJitter: 0.05, durJitter: 0.03, layback: 6 },
  woodwinds: { timingMs: 12, velJitter: 0.06, durJitter: 0.05, layback: 4 },
  brass: { timingMs: 11, velJitter: 0.06, durJitter: 0.04, layback: 3 },
  guitars: { timingMs: 10, velJitter: 0.08, durJitter: 0.05, layback: 2 },
  basses: { timingMs: 8, velJitter: 0.05, durJitter: 0.03, layback: 4 },
  folk: { timingMs: 12, velJitter: 0.07, durJitter: 0.05, layback: 0 },
  choir: { timingMs: 15, velJitter: 0.04, durJitter: 0.03, layback: 8 },
  synth: { timingMs: 8, velJitter: 0.03, durJitter: 0.01, layback: 0 },
  mallets: { timingMs: 9, velJitter: 0.07, durJitter: 0.04, layback: 0 },
  percussion: { timingMs: 8, velJitter: 0.09, durJitter: 0.03, layback: 0 },
  drums: { timingMs: 6, velJitter: 0.1, durJitter: 0.02, layback: -2 },
};

export interface HumanizeOptions {
  seed: number;
  family: Family;
  /** 0 = off, 1 = full profile (default 1) */
  amount?: number;
  /** notes on exact bar downbeats keep only half the jitter; needs bpm + beatsPerBar */
  bpm?: number;
  beatsPerBar?: number;
}

function tri(r: () => number): number { return (r() + r()) - 1; } // triangular -1..1, peaks at 0

/**
 * Returns a new array with timing and velocity jitter. The RNG for each note depends only on
 * (seed, time rounded to ms, midi), so the result is identical regardless of order or surrounding notes.
 */
export function humanize(notes: readonly NoteEv[], o: HumanizeOptions): NoteEv[] {
  const prof = HUMAN_PROFILES[o.family];
  const amt = o.amount ?? 1;
  if (amt <= 0) return notes.map((n) => ({ ...n }));
  const barSec = o.bpm && o.beatsPerBar ? (60 / o.bpm) * o.beatsPerBar : 0;
  return notes.map((n) => {
    const r = mulberry32(hashSeed(o.seed, n.time * 1000, n.midi));
    let tScale = 1;
    if (barSec > 0) {
      const ph = n.time / barSec; if (Math.abs(ph - Math.round(ph)) * barSec < 0.005) tScale = 0.5;
    }
    const dt = ((tri(r) * prof.timingMs * tScale + prof.layback) * amt) / 1000;
    const dv = 1 + tri(r) * prof.velJitter * amt;
    const dd = 1 + tri(r) * prof.durJitter * amt;
    return { ...n, time: Math.max(0, n.time + dt), vel: Math.min(1, Math.max(0.02, n.vel * dv)), dur: Math.max(0.02, n.dur * dd) };
  });
}

// ---- groove templates ------------------------------------------------------------------------------

export interface GrooveTemplate { id: string; name: string; /** off-beat 8th position inside the beat, 0.5 = straight, 0.667 = triplet swing */ swing: number; /** seconds-per-beat fraction offsets for beats 1..4 (push < 0, drag > 0) */ beatOffset: number[]; accent: number[] }

export const GROOVES: Record<string, GrooveTemplate> = {
  straight: { id: 'straight', name: 'Drept', swing: 0.5, beatOffset: [0, 0, 0, 0], accent: [1, 0.9, 0.95, 0.9] },
  laidback: { id: 'laidback', name: 'Relaxat', swing: 0.54, beatOffset: [0, 0.012, 0, 0.012], accent: [1, 0.88, 0.95, 0.88] },
  push: { id: 'push', name: 'Împins', swing: 0.5, beatOffset: [0, -0.01, 0, -0.01], accent: [1, 0.92, 0.97, 0.92] },
  shuffle: { id: 'shuffle', name: 'Shuffle', swing: 0.64, beatOffset: [0, 0, 0, 0], accent: [1, 0.85, 0.95, 0.85] },
  waltz: { id: 'waltz', name: 'Vals', swing: 0.5, beatOffset: [0, 0.008, 0.012], accent: [1, 0.82, 0.86] },
};

/** Apply swing / beat offsets / metric accents. Notes keep their sorting. */
export function applyGroove(notes: readonly NoteEv[], bpm: number, g: GrooveTemplate, beatsPerBar = 4): NoteEv[] {
  const beat = 60 / bpm;
  return notes.map((n) => {
    const b = n.time / beat; const bi = Math.floor(b + 1e-6); const frac = b - bi;
    let t = n.time;
    if (Math.abs(frac - 0.5) < 0.06) t = (bi + g.swing) * beat; // off-beat 8th
    const pos = ((bi % beatsPerBar) + beatsPerBar) % beatsPerBar;
    t += (g.beatOffset[pos] ?? 0) * beat;
    const acc = Math.abs(frac) < 0.06 ? (g.accent[pos] ?? 1) : 1;
    return { ...n, time: Math.max(0, t), vel: Math.min(1, n.vel * acc) };
  });
}
