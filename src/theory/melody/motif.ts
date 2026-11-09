import type { Hook, KeyIn, VocalNoteIn } from './types';
import type { Rng } from './data';

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
export const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];

export function scalePcs(key: KeyIn, harmonic: boolean): number[] {
  const base = key.mode === 'major' ? MAJOR : key.mode === 'harmonicMinor' || harmonic ? HARM_MINOR : NAT_MINOR;
  return base.map((x) => (x + key.tonic) % 12);
}
/** all midi 0..127 belonging to the scale */
export function scaleMidis(pcs: number[]): number[] {
  const s = new Set(pcs);
  const out: number[] = [];
  for (let m = 0; m < 128; m++) if (s.has(m % 12)) out.push(m);
  return out;
}
const lowerIdx = (arr: number[], v: number) => {
  // index of largest element <= v (or 0)
  let lo = 0, hi = arr.length - 1, r = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= v) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
};
/** shift a pitch by `steps` scale degrees, keeping any chromatic alteration */
export function shiftDiatonic(p: number, steps: number, scale: number[]): number {
  const i = lowerIdx(scale, p);
  const alt = p - scale[i];
  const j = Math.max(0, Math.min(scale.length - 1, i + steps));
  return scale[j] + alt;
}

export interface Motif { pitches: number[]; onsets: number[]; durs: number[] }

export const hookToMotif = (h: Hook): Motif => ({ pitches: h.pitches.slice(), onsets: h.onsetsBeats.slice(), durs: h.durBeats.slice() });

/** Diatonic sequence: whole motif moved by `steps` scale degrees. */
export function sequenceMotif(m: Motif, steps: number, scale: number[]): Motif {
  return { ...m, pitches: m.pitches.map((p) => shiftDiatonic(p, steps, scale)) };
}
/** Diatonic inversion around the first note. */
export function invertMotif(m: Motif, scale: number[]): Motif {
  const i0 = lowerIdx(scale, m.pitches[0]);
  const p0 = m.pitches[0];
  return {
    ...m,
    pitches: m.pitches.map((p, k) => {
      if (k === 0) return p;
      const d = lowerIdx(scale, p) - i0;
      return shiftDiatonic(p0, -d, scale);
    }),
  };
}
/** Fragmentation: `count` notes from index `from` (onsets re-based to 0). */
export function fragmentMotif(m: Motif, from: number, count: number): Motif {
  const a = Math.max(0, Math.min(from, m.pitches.length - 1));
  const b = Math.min(m.pitches.length, a + Math.max(1, count));
  const o0 = m.onsets[a];
  return { pitches: m.pitches.slice(a, b), onsets: m.onsets.slice(a, b).map((o) => o - o0), durs: m.durs.slice(a, b) };
}
export function augmentMotif(m: Motif, factor = 2): Motif {
  return { pitches: m.pitches.slice(), onsets: m.onsets.map((o) => o * factor), durs: m.durs.map((d) => d * factor) };
}
export const diminishMotif = (m: Motif, factor = 2): Motif => augmentMotif(m, 1 / factor);
/** Light ornamentation: long notes (>= 1 beat) may get a lower-neighbour turn (main, neighbour, main). */
export function ornamentMotif(m: Motif, scale: number[], rng: Rng, amount = 0.5): Motif {
  const pitches: number[] = [], onsets: number[] = [], durs: number[] = [];
  for (let i = 0; i < m.pitches.length; i++) {
    const p = m.pitches[i], o = m.onsets[i], d = m.durs[i];
    if (d >= 1 && rng.chance(amount)) {
      const q = d / 4;
      pitches.push(p, shiftDiatonic(p, -1, scale), p);
      onsets.push(o, o + q, o + 2 * q);
      durs.push(q, q, d - 2 * q);
    } else { pitches.push(p); onsets.push(o); durs.push(d); }
  }
  return { pitches, onsets, durs };
}

const mid = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 60; };

/**
 * Hook = most characteristic 3..6-note pattern: repeated interval+rhythm n-grams, distinct contour, preference for the
 * first phrase of the refren.
 */
export function extractHook(
  vocal: VocalNoteIn[],
  refrenSpans: { start: number; end: number }[],
  beatSec: number,
  key: KeyIn,
  center: number,
): Hook {
  const v = vocal;
  if (v.length < 3) return defaultHook(key, center);
  const phrases: number[][] = [];
  let cur: number[] = [0];
  for (let i = 1; i < v.length; i++) {
    if (v[i].startSec - (v[i - 1].startSec + v[i - 1].durSec) >= beatSec * 0.99) { phrases.push(cur); cur = []; }
    cur.push(i);
  }
  phrases.push(cur);
  const inRefren = (t: number) => refrenSpans.some((r) => t >= r.start - 1e-6 && t < r.end - 1e-6);
  const firstOfRefren = new Set<number>();
  for (const r of refrenSpans) {
    const idx = v.findIndex((n) => n.startSec >= r.start - 1e-6 && n.startSec < r.end);
    if (idx >= 0) firstOfRefren.add(idx);
  }
  const q = beatSec / 2;
  interface Win { i: number; L: number; key: string }
  const wins: Win[] = [];
  const counts = new Map<string, number>();
  for (const ph of phrases) {
    for (let L = 3; L <= 6; L++) {
      for (let s = 0; s + L <= ph.length; s++) {
        const i = ph[s];
        const ints: number[] = [], rh: number[] = [];
        for (let k = 0; k < L - 1; k++) {
          ints.push(v[i + k + 1].midi - v[i + k].midi);
          rh.push(Math.round((v[i + k + 1].startSec - v[i + k].startSec) / q));
        }
        const key2 = `${ints.join(',')}|${rh.join(',')}`;
        wins.push({ i, L, key: key2 });
        counts.set(key2, (counts.get(key2) ?? 0) + 1);
      }
    }
  }
  let best: Win | null = null, bestScore = -Infinity;
  for (const w of wins) {
    const ps = v.slice(w.i, w.i + w.L).map((n) => n.midi);
    const ints = ps.slice(1).map((p, k) => p - ps[k]);
    const distinct = new Set(ps).size;
    if (distinct < 2) continue;
    const zeros = ints.filter((x) => x === 0).length;
    const leap = Math.max(...ints.map(Math.abs)) >= 3 ? 1 : 0;
    let sc = ((counts.get(w.key) ?? 1) - 1) * 3 + w.L * 0.5 - Math.abs(w.L - 4.5) * 0.6
      + new Set(ints).size * 0.5 + leap - zeros;
    if (inRefren(v[w.i].startSec)) sc += 2;
    if (firstOfRefren.has(w.i) && w.L >= 4) sc += 5;
    if (sc > bestScore + 1e-9) { bestScore = sc; best = w; }
  }
  if (!best) return defaultHook(key, center);
  const ns = v.slice(best.i, best.i + best.L);
  const t0 = ns[0].startSec;
  const pitches = ns.map((n) => n.midi);
  return {
    pitches,
    onsetsBeats: ns.map((n) => (n.startSec - t0) / beatSec),
    durBeats: ns.map((n) => n.durSec / beatSec),
    intervals: pitches.slice(1).map((p, k) => p - pitches[k]),
    source: inRefren(t0) ? 'refren' : 'song',
  };
}

export function defaultHook(key: KeyIn, center: number): Hook {
  const third = key.mode === 'major' ? 4 : 3;
  const offs = [0, 2, third, 7, third];
  let base = key.tonic + 12 * Math.round((center - key.tonic) / 12);
  if (base > center + 6) base -= 12;
  const pitches = offs.map((o) => base + o);
  return {
    pitches,
    onsetsBeats: [0, 1, 2, 3, 4],
    durBeats: [1, 1, 1, 1, 2],
    intervals: pitches.slice(1).map((p, k) => p - pitches[k]),
    source: 'default',
  };
}

export const medianPitch = mid;
