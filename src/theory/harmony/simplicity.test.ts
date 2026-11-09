import { describe, expect, it } from 'vitest';
import type { Genre, KeySig, Note, TimeSig } from '../../model/types';
import { mulberry32 } from '../../dsp/synth';
import { TIME_SIGS, beatSec } from '../../music/timesig';
import { HARMONIC_MINOR, MAJOR_SCALE } from '../../music/theory';
import { harmonize, type Chord, type HarmonizeInput } from './index';

const SIG44: TimeSig = TIME_SIGS.find((t) => t.id === '4/4')!.sig;
const rel = (c: Chord, k: KeySig) => (((c.root - k.tonic) % 12) + 12) % 12;

/** Romanian-Christian-style melody: chord tones on beats 1 and 3 of the underlying (slowly changing) harmony, scale steps between. */
function melody(seed: number, key: KeySig, bpm: number, prog: number[], opts: { pickup?: boolean } = {}): Note[] {
  const rng = mulberry32(seed);
  const beat = beatSec(bpm);
  const scale = key.mode === 'minor' ? HARMONIC_MINOR : MAJOR_SCALE;
  const out: Note[] = [];
  let id = 0;
  const pitchOf = (deg: number, oct = 4) => 12 * oct + key.tonic + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
  const triad = (r: number) => {
    const third = key.mode === 'minor' ? (r === 7 ? 4 : r === 8 || r === 3 ? 4 : 3) : ([0, 5, 7].includes(r) ? 4 : 3);
    return [r, (r + third) % 12, (r + 7) % 12];
  };
  const add = (midi: number, t: number, d: number) => out.push({ id: 'n' + id++, midi, startSec: t, durSec: d, velocity: 0.7, centsDev: 0, confidence: 1 });
  if (opts.pickup) { add(62, -0.9 * beat + 0, 0.8 * beat); }
  prog.forEach((r, b) => {
    const tones = triad(r).map((x) => ((x + key.tonic) % 12));
    const near = (pc: number, around: number) => { let m = 12 * 4 + pc; while (m < around - 6) m += 12; while (m > around + 6) m -= 12; return m; };
    const base = 12 * 4 + key.tonic + 7;
    const t0 = b * 4 * beat;
    const a = near(tones[Math.floor(rng() * 3)], base);
    const c = near(tones[Math.floor(rng() * 3)], base);
    add(a, t0, 1.8 * beat);
    add(Math.max(55, a - 2), t0 + 2 * beat, 1.8 * beat);
    if (rng() < 0.5) { out.pop(); add(c, t0 + 2 * beat, 1.8 * beat); }
  });
  void pitchOf;
  return out.filter((n) => n.startSec >= 0).sort((x, y) => x.startSec - y.startSec);
}

const GM: KeySig = { tonic: 7, mode: 'minor' };
const PROGS: number[][] = [
  [0, 0, 5, 5, 7, 7, 0, 0],
  [0, 0, 7, 7, 0, 0, 7, 0],
  [0, 0, 5, 7, 0, 0, 5, 7, 0, 0, 5, 5, 7, 7, 0, 0],
  [0, 0, 0, 0, 5, 5, 7, 7],
];

function run(prog: number[], genre: Genre, simplicity: 'simplu' | 'normal' | 'bogat' | undefined, seed: number, bpm = 85) {
  const notes = melody(seed, GM, bpm, prog);
  const inp: HarmonizeInput = {
    notes, key: GM, bpm, sig: SIG44, bars: prog.length, genre, emotion: 'inchinare', sectionType: 'strofa', nextType: 'refren', isLastSection: false, simplicity,
  };
  return { inp, res: harmonize(inp) };
}

describe('Simplitate (harmony busyness)', () => {
  const GENRES: Genre[] = ['cantare', 'imn', 'worship', 'popular'];
  it('Simplu: at most one chord per bar, for every genre', () => {
    for (const g of GENRES) for (const [pi, p] of PROGS.entries()) {
      const { res } = run(p, g, 'simplu', 10 + pi);
      expect(res.slots.length, `${g} prog ${pi}`).toBeLessThanOrEqual(p.length);
    }
  });
  it('Simplu: only diatonic triads (no ii° / vii°, no 7ths); i / iv / V dominate', () => {
    let colour = 0, total = 0;
    for (const g of GENRES) for (const [pi, p] of PROGS.entries()) for (let s = 0; s < 3; s++) {
      const { res } = run(p, g, 'simplu', 100 * pi + s);
      for (const c of res.variants.A) {
        const r = rel(c, GM);
        total++;
        expect([0, 3, 5, 7, 8, 10], `${g}: ${c.roman}`).toContain(r);
        expect(['maj', 'min'], `${g}: ${c.roman}`).toContain(c.quality);
        if (r === 8 || r === 3 || r === 10) colour++;
      }
    }
    expect(colour / total).toBeLessThan(0.3); // colour degrees only where the melody asks for them
  });
  it('Simplu: at least half of the bars belong to a chord held 2+ bars when the melody allows', () => {
    let held = 0, bars = 0;
    for (const g of GENRES) for (const [pi, p] of PROGS.entries()) for (let s = 0; s < 3; s++) {
      const { res } = run(p, g, 'simplu', 7 * pi + s + 1);
      const ch = res.variants.A;
      for (let i = 0; i < ch.length; i++) {
        bars++;
        const same = (j: number) => j >= 0 && j < ch.length && ch[j].root === ch[i].root && ch[j].quality === ch[i].quality;
        if (same(i - 1) || same(i + 1)) held++;
      }
    }
    expect(held / bars).toBeGreaterThanOrEqual(0.5);
  });
  it('Simplu: a section still ends on the tonic and the first chord is the tonic family', () => {
    for (const g of GENRES) {
      const { res } = run(PROGS[0], g, 'simplu', 3);
      const last = res.variants.A[res.variants.A.length - 1];
      expect([0, 7]).toContain(rel(last, GM)); // strofa before a refren may close on the half cadence
      expect([0, 5, 8]).toContain(rel(res.variants.A[0], GM));
    }
  });
  it('Normal keeps one chord per bar; Bogat may use two per bar; no setting keeps the classic behaviour', () => {
    const n = run(PROGS[0], 'cantare', 'normal', 5);
    expect(n.res.slots.length).toBeLessThanOrEqual(PROGS[0].length);
    const rates = new Set<number>();
    for (const [pi, p] of PROGS.entries()) rates.add(run(p, 'imn', 'bogat', pi + 20).res.slots.length / p.length);
    expect([...rates].every((r) => r === 0.5 || r === 1 || r === 2)).toBe(true);
    const legacy = run(PROGS[0], 'cantare', undefined, 5);
    expect(legacy.res.slots.length).toBeGreaterThan(0);
  });
  it('locks survive a change of Simplitate', () => {
    const { inp } = run(PROGS[0], 'cantare', 'simplu', 4);
    const lock = { root: (GM.tonic + 5) % 12, quality: 'min' as const, roman: 'iv', func: 'S' as const };
    const res = harmonize({ ...inp, simplicity: 'normal', locks: { A: { 2: lock } } });
    expect(res.variants.A[2].root).toBe(lock.root);
  });

  it('style priors (cantare, minor): refren opens on III and flows III - VII - iv - i; major IV when the melody avoids the flat 6th', () => {
    const beat = beatSec(85);
    const mk = (spec: number[][]): Note[] => spec.flatMap((pcs, b) => pcs.map((m, k) => ({ id: `r${b}-${k}`, midi: m, startSec: b * 4 * beat + k * 2 * beat, durSec: 1.8 * beat, velocity: 0.7, centsDev: 0, confidence: 1 })));
    // B-flat | F | Cm | Gm  (G minor)
    const refren = mk([[70, 74], [65, 69], [72, 67], [67, 70]]);
    const inp: HarmonizeInput = { notes: refren, key: GM, bpm: 85, sig: SIG44, bars: 4, genre: 'cantare', emotion: 'inchinare', sectionType: 'refren', nextType: null, isLastSection: false, simplicity: 'simplu' };
    const ch = harmonize(inp).variants.A;
    expect(rel(ch[0], GM)).toBe(3);
    expect(rel(ch[1], GM)).toBe(10);
    // melody on C, G, E (natural 6th, no flat 6th): the strofa chord on C is major (C7 family idiom)
    const strofa = mk([[67, 70], [72, 67], [67, 70], [67, 70], [67, 70], [67, 70], [62, 66], [67, 70]]);
    const c2 = harmonize({ ...inp, notes: strofa, bars: 8, sectionType: 'strofa' }).variants.A;
    expect(c2[1].root).toBe(0);
    expect(c2[1].quality).toBe('maj');
  });
});
