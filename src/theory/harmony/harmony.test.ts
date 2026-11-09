import { describe, expect, it } from 'vitest';
import type { Emotion, Genre, KeySig, Note, SectionType, TimeSig } from '../../model/types';
import { mulberry32 } from '../../dsp/synth';
import { TIME_SIGS, beatSec } from '../../music/timesig';
import { MAJOR_SCALE, MINOR_SCALE, HARMONIC_MINOR } from '../../music/theory';
import {
  BASS_HI, BASS_LO, cadenceValid, chordPcs, chordRoles, harmonize, isStrong, parallelPerfect, renderHarmony, variantDiff, voiceSection, buildSectionHarmony,
  type Chord, type HarmonizeInput, type VariantId, VARIANTS, GENRE_BIAS,
} from './index';

const sigOf = (id: string): TimeSig => TIME_SIGS.find((t) => t.id === id)!.sig;

interface Case { name: string; key: KeySig; sig: TimeSig; bpm: number; genre: Genre; emotion: Emotion; harmonic?: boolean }
const CASES: Case[] = [
  { name: 'Do major 4/4 worship', key: { tonic: 0, mode: 'major' }, sig: sigOf('4/4'), bpm: 90, genre: 'worship', emotion: 'inchinare' },
  { name: 'Sol major 4/4 pop', key: { tonic: 7, mode: 'major' }, sig: sigOf('4/4'), bpm: 120, genre: 'pop', emotion: 'vesel' },
  { name: 'Re major 4/4 imn (slow, SATB)', key: { tonic: 2, mode: 'major' }, sig: sigOf('4/4'), bpm: 70, genre: 'imn', emotion: 'rugaciune' },
  { name: 'Fa major 4/4 rock', key: { tonic: 5, mode: 'major' }, sig: sigOf('4/4'), bpm: 100, genre: 'rock', emotion: 'energic' },
  { name: 'La minor 4/4 cantare', key: { tonic: 9, mode: 'minor' }, sig: sigOf('4/4'), bpm: 85, genre: 'cantare', emotion: 'trist', harmonic: true },
  { name: 'Mi minor 4/4 popular', key: { tonic: 4, mode: 'minor' }, sig: sigOf('4/4'), bpm: 110, genre: 'popular', emotion: 'nostalgic', harmonic: true },
  { name: 'Re minor 3/4 imn (SATB)', key: { tonic: 2, mode: 'minor' }, sig: sigOf('3/4'), bpm: 90, genre: 'imn', emotion: 'dramatic', harmonic: true },
  { name: 'Do major 6/8 worship', key: { tonic: 0, mode: 'major' }, sig: sigOf('6/8'), bpm: 80, genre: 'worship', emotion: 'lauda' },
  { name: 'La minor 7/8 (3+2+2) popular', key: { tonic: 9, mode: 'minor' }, sig: sigOf('7/8a'), bpm: 130, genre: 'popular', emotion: 'energic', harmonic: true },
  { name: 'Mi minor 7/8 (2+2+3) cantare', key: { tonic: 4, mode: 'minor' }, sig: sigOf('7/8b'), bpm: 120, genre: 'cantare', emotion: 'biruinta', harmonic: true },
  { name: 'Sib major 3/4 pop', key: { tonic: 10, mode: 'major' }, sig: sigOf('3/4'), bpm: 100, genre: 'pop', emotion: 'romantic' },
  { name: 'Sol major 4/4 imn (SATB)', key: { tonic: 7, mode: 'major' }, sig: sigOf('4/4'), bpm: 66, genre: 'imn', emotion: 'biruinta' },
  { name: 'La minor 5/8 popular', key: { tonic: 9, mode: 'minor' }, sig: sigOf('5/8'), bpm: 140, genre: 'popular', emotion: 'vesel', harmonic: true },
  { name: 'Do major 9/8 worship', key: { tonic: 0, mode: 'major' }, sig: sigOf('9/8'), bpm: 120, genre: 'worship', emotion: 'inchinare' },
];

const PROGS_MAJOR = [[0, 7, 9, 5], [0, 5, 7, 0], [9, 5, 0, 7], [0, 9, 5, 7], [0, 2, 7, 0], [5, 7, 4, 9]];
const PROGS_MINOR = [[0, 5, 7, 0], [0, 8, 3, 10], [0, 5, 10, 3], [0, 8, 5, 7]];
const RHYTHMS: Record<string, number[][]> = {
  '4/4': [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 2], [2, 2], [1, 0.5, 0.5, 2]],
  '3/4': [[1, 1, 1], [2, 1], [1, 2], [1.5, 0.5, 1]],
  '6/8': [[3, 3], [2, 1, 3], [3, 2, 1], [1, 1, 1, 3]],
  '7/8a': [[3, 2, 2], [2, 1, 2, 2], [3, 1, 1, 2]],
  '7/8b': [[2, 2, 3], [2, 1, 1, 3], [1, 1, 2, 3]],
  '5/8': [[3, 2], [2, 1, 2], [3, 1, 1]],
  '9/8': [[2, 2, 2, 3], [2, 2, 1, 1, 3], [4, 2, 3]],
};
const sigId = (s: TimeSig) => TIME_SIGS.find((t) => t.sig.num === s.num && t.sig.den === s.den && t.sig.grouping.join() === s.grouping.join())!.id;

/** A sung-like melody: strong beats = tones of an underlying progression, weak beats = passing/neighbour tones. */
function makeMelody(seed: number, c: Case, bars: number): Note[] {
  const rng = mulberry32(seed);
  const beat = beatSec(c.bpm);
  const scale = c.key.mode === 'major' ? MAJOR_SCALE : c.harmonic ? HARMONIC_MINOR : MINOR_SCALE;
  const prog = (c.key.mode === 'major' ? PROGS_MAJOR : PROGS_MINOR)[Math.floor(rng() * (c.key.mode === 'major' ? PROGS_MAJOR : PROGS_MINOR).length)];
  const scalePitches: number[] = [];
  for (let o = 4; o <= 6; o++) for (const s of scale) { const m = 12 * o + c.key.tonic + s; if (m >= 58 && m <= 77) scalePitches.push(m); }
  const triadOf = (rel: number) => {
    const third = c.key.mode === 'major' ? ([0, 5, 7].includes(rel) ? 4 : 3) : ([3, 8, 10].includes(rel) ? 4 : rel === 7 ? 4 : 3);
    return [rel, (rel + third) % 12, (rel + 7) % 12];
  };
  const notes: Note[] = [];
  const rhythms = RHYTHMS[sigId(c.sig)];
  let prev = scalePitches.find((m) => (m - c.key.tonic) % 12 === 0 && m >= 60) ?? 62;
  for (let b = 0; b < bars; b++) {
    let rel = prog[b % prog.length];
    const phraseEnd = (b + 1) % 4 === 0, preEnd = (b + 2) % 4 === 0;
    if (phraseEnd) rel = 0;
    else if (preEnd) rel = 7;
    const tones = triadOf(rel).map((r) => (c.key.tonic + r) % 12);
    const pat = rhythms[Math.floor(rng() * rhythms.length)];
    let pos = 0;
    pat.forEach((d, k) => {
      const start = b * c.sig.num + pos;
      const strong = isStrong(pos, c.sig);
      const isLast = k === pat.length - 1;
      let pitch: number;
      if (strong || (phraseEnd && isLast)) {
        const pool = scalePitches.filter((m) => tones.includes(m % 12));
        pool.sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev));
        pitch = pool[Math.floor(rng() * Math.min(2, pool.length))];
      } else {
        const i = scalePitches.indexOf(prev);
        const step = rng() < 0.5 ? 1 : -1;
        pitch = scalePitches[Math.max(0, Math.min(scalePitches.length - 1, (i < 0 ? 0 : i) + step))];
      }
      const rest = phraseEnd && isLast ? 0.2 : 0;
      notes.push({
        id: `m${seed}-${b}-${k}`, midi: pitch, startSec: start * beat, durSec: Math.max(0.1, (d - rest - 0.08) * beat), velocity: 0.8, centsDev: 0, confidence: 1,
      });
      prev = pitch;
      pos += d;
    });
  }
  return notes;
}

const inputFor = (c: Case, notes: Note[], sectionType: SectionType, nextType: SectionType | null, last: boolean): HarmonizeInput => ({
  notes, key: c.key, bpm: c.bpm, sig: c.sig, bars: 8, genre: c.genre, emotion: c.emotion, sectionType, nextType, isLastSection: last,
});

interface Song { c: Case; sections: { inp: HarmonizeInput; res: ReturnType<typeof harmonize>; notes: Note[] }[] }
const songs: Song[] = CASES.map((c, i) => {
  const strofa = makeMelody(1000 + i, c, 8), refren = makeMelody(2000 + i, c, 8);
  const inpS = inputFor(c, strofa, 'strofa', 'refren', false);
  const inpR = inputFor(c, refren, 'refren', 'strofa', true);
  return { c, sections: [{ inp: inpS, res: harmonize(inpS), notes: strofa }, { inp: inpR, res: harmonize(inpR), notes: refren }] };
});

const relOf = (c: Chord, key: KeySig) => (((c.root - key.tonic) % 12) + 12) % 12;

describe('M3 harmony engine on synthetic melodies', () => {
  it('strong-beat melody notes are chord tones (>= 80%)', () => {
    let ok = 0, total = 0;
    const per: string[] = [];
    for (const s of songs) {
      let o = 0, t = 0;
      for (const sec of s.sections) for (const v of VARIANTS) {
        const beat = beatSec(sec.inp.bpm);
        for (const n of sec.notes) {
          const absBeat = n.startSec / beat;
          const bar = Math.floor(absBeat / sec.inp.sig.num + 1e-6);
          const pos = absBeat - bar * sec.inp.sig.num;
          if (Math.abs(pos - Math.round(pos)) > 0.05 || !isStrong(Math.round(pos), sec.inp.sig)) continue;
          const slot = sec.res.slots.find((sl) => absBeat >= sl.startBeat - 1e-6 && absBeat < sl.startBeat + sl.beats - 1e-6);
          if (!slot) continue;
          t++;
          if (chordPcs(sec.res.variants[v][slot.idx]).includes(n.midi % 12)) o++;
        }
      }
      ok += o; total += t;
      per.push(`${s.c.name}: ${(100 * o / t).toFixed(0)}%`);
    }
    console.log('strong-beat chord tones:', (100 * ok / total).toFixed(1) + '%', '|', per.join(' | '));
    expect(ok / total).toBeGreaterThanOrEqual(0.8);
  });

  it('every phrase end has a valid cadence; strofă -> refren ends on a half cadence', () => {
    let checked = 0;
    for (const s of songs) for (const sec of s.sections) for (const v of VARIANTS) {
      const chords = sec.res.variants[v];
      const slots = sec.res.slots;
      slots.forEach((sl, i) => {
        if (!(sl.phraseEnd || i === slots.length - 1)) return;
        const final = i === slots.length - 1;
        const half = final && sec.inp.sectionType === 'strofa' && sec.inp.nextType === 'refren';
        const prev = i > 0 && !slots[i - 1].phraseEnd ? chords[i - 1] : null;
        const ok = cadenceValid(prev, chords[i], s.c.key, half ? 'half' : 'authentic', GENRE_BIAS[s.c.genre].plagalAmen, s.c.key.mode === 'minor' && !GENRE_BIAS[s.c.genre].harmonicMinor);
        if (!ok) console.log('BAD cadence', s.c.name, sec.inp.sectionType, v, i, prev?.roman, chords[i].roman);
        expect(ok).toBe(true);
        if (half) expect(relOf(chords[i], s.c.key)).toBe(7);
        checked++;
      });
    }
    console.log('cadences checked:', checked);
    expect(checked).toBeGreaterThan(100);
  });

  it('three variants differ in >= 25% of slots (pairwise)', () => {
    let min = 1;
    for (const s of songs) for (const sec of s.sections) {
      const { A, B, C } = sec.res.variants;
      for (const [x, y] of [[A, B], [A, C], [B, C]]) min = Math.min(min, variantDiff(x, y));
    }
    console.log('min pairwise variant difference:', (100 * min).toFixed(0) + '%');
    expect(min).toBeGreaterThanOrEqual(0.25);
  });

  it('Imn SATB: soprano doubles the melody, no parallel 5ths/8ves between outer voices', () => {
    let pairs = 0;
    for (const s of songs.filter((x) => x.c.genre === 'imn')) for (const sec of s.sections) for (const v of VARIANTS) {
      const voiced = voiceSection({ chords: sec.res.variants[v], slots: sec.res.slots, notes: sec.notes, key: s.c.key, genre: 'imn' });
      for (let i = 1; i < voiced.length; i++) {
        const a = voiced[i - 1], b = voiced[i];
        const par = parallelPerfect(a.voicing[a.voicing.length - 1], a.bass, b.voicing[b.voicing.length - 1], b.bass);
        if (par) console.log('PARALLEL', s.c.name, v, i, a.voicing, a.bass, b.voicing, b.bass);
        expect(par).toBe(false);
        pairs++;
      }
      expect(voiced.every((x) => x.voicing.length === 3 && x.voicing[0] < x.voicing[1] && x.voicing[1] <= x.voicing[2])).toBe(true);
    }
    console.log('SATB outer-voice pairs checked:', pairs);
    expect(pairs).toBeGreaterThan(50);
  });

  it('pad voicing never above the concurrent vocal note; bass stays in E1-C3', () => {
    let n = 0, high = 0;
    for (const s of songs) for (const sec of s.sections) for (const v of VARIANTS) {
      const voiced = voiceSection({ chords: sec.res.variants[v], slots: sec.res.slots, notes: sec.notes, key: s.c.key, genre: s.c.genre });
      voiced.forEach((vs, i) => {
        expect(vs.bass).toBeGreaterThanOrEqual(BASS_LO);
        expect(vs.bass).toBeLessThanOrEqual(BASS_HI);
        if (s.c.genre === 'imn') return;
        const sl = sec.res.slots[i];
        for (const note of sec.notes) {
          if (note.startSec < sl.startSec + sl.durSec - 1e-6 && note.startSec + note.durSec > sl.startSec + 1e-6) {
            n++;
            if (vs.voicing[vs.voicing.length - 1] > note.midi) high++;
          }
        }
      });
    }
    console.log(`voicing-above-vocal violations: ${high} / ${n}`);
    expect(high).toBe(0);
  });

  it('rendered bass events stay in E1-C3', () => {
    for (const s of songs) for (const sec of s.sections) {
      const harmony = buildSectionHarmony(sec.inp);
      const r = renderHarmony({ harmony, variant: 'B', notes: sec.notes, key: s.c.key, genre: s.c.genre, sig: s.c.sig });
      expect(r.bassEvents.length).toBeGreaterThan(0);
      for (const e of r.bassEvents) { expect(e.midi).toBeGreaterThanOrEqual(BASS_LO); expect(e.midi).toBeLessThanOrEqual(BASS_HI); }
      expect(r.chordEvents.length).toBeGreaterThan(0);
    }
  });

  it('locked chords are respected after re-harmonizing', () => {
    for (const s of songs) {
      const sec = s.sections[0];
      const locks: Record<VariantId, Record<number, Chord>> = { A: {}, B: {}, C: {} };
      const pick: Chord = { root: (s.c.key.tonic + 5) % 12, quality: s.c.key.mode === 'major' ? 'maj' : 'min', roman: 'IV', func: 'S' };
      for (const v of VARIANTS) { locks[v][1] = pick; locks[v][3] = sec.res.variants[v][3]; }
      const again = harmonize({ ...sec.inp, locks });
      for (const v of VARIANTS) {
        expect(again.variants[v][1].root).toBe(pick.root);
        expect(again.variants[v][1].quality).toBe(pick.quality);
        expect(again.variants[v][3].root).toBe(sec.res.variants[v][3].root);
      }
    }
  });

  it('harmonizes a whole song in < 200 ms', () => {
    const times: number[] = [];
    for (let rep = 0; rep < 3; rep++) for (const s of songs) {
      const t0 = performance.now();
      for (const sec of s.sections) harmonize(sec.inp);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`harmonize per song: median ${times[times.length >> 1].toFixed(0)} ms, max ${times[times.length - 1].toFixed(0)} ms`);
    expect(times[times.length - 1]).toBeLessThan(200);
  });

  it('light, clear defaults: variant A, 3-note spread voicings, no sevenths in A/B, <= 25% sus, soft velocity, legato', () => {
    let slotsN = 0, three = 0, lowBad = 0, topBad = 0, withMel = 0;
    for (const s of songs.filter((x) => x.c.genre !== 'imn')) for (const sec of s.sections) {
      const h = buildSectionHarmony(sec.inp);
      expect(h.active).toBe('A');
      for (const v of ['A', 'B'] as const) {
        expect(h.variants[v].every((c) => !['dom7', 'maj7', 'min7', 'hdim7', 'dim7'].includes(c.quality))).toBe(true);
      }
      for (const v of VARIANTS) {
        expect(h.variants[v].filter((c) => c.quality === 'sus2' || c.quality === 'sus4').length).toBeLessThanOrEqual(Math.floor(0.25 * h.variants[v].length));
      }
      const voiced = voiceSection({ chords: h.variants.A, slots: h.slots, notes: sec.notes, key: s.c.key, genre: s.c.genre });
      voiced.forEach((vs, i) => {
        slotsN++;
        const sl0 = h.slots[i];
        const heldPcs = sec.notes.filter((n) => n.durSec >= 0.25 && n.startSec < sl0.startSec + sl0.durSec - 1e-6 && n.startSec + n.durSec > sl0.startSec + 1e-6).map((n) => n.midi % 12);
        const dropped = chordPcs(h.variants.A[i]).some((pc) => heldPcs.some((hp) => [1, 11].includes(((pc - hp) % 12 + 12) % 12)));
        if (vs.voicing.length === 3 || dropped) three++; // a tone dropped for a held-note semitone clash leaves a 2-note open fifth
        const roles = chordRoles(h.variants.A[i]);
        for (const m of vs.voicing) if (m < 48 && m % 12 !== roles.root && m % 12 !== roles.fifth) lowBad++;
        const sl = h.slots[i];
        const mel = sec.notes.filter((n) => n.startSec < sl.startSec + sl.durSec - 1e-6 && n.startSec + n.durSec > sl.startSec + 1e-6);
        if (mel.length) { withMel++; if (vs.voicing[vs.voicing.length - 1] > Math.min(...mel.map((n) => n.midi)) - 3) topBad++; }
      });
      const r = renderHarmony({ harmony: h, variant: 'A', notes: sec.notes, key: s.c.key, genre: s.c.genre, sig: s.c.sig, style: 'simple' });
      expect(r.chordEvents.every((e) => Math.abs(e.vel - 0.45) < 1e-9)).toBe(true);
      for (const e of r.chordEvents) {
        const sl = h.slots.find((x) => e.startSec >= x.startSec - 1e-6 && e.startSec < x.startSec + x.durSec - 1e-6)!;
        expect(e.startSec + e.durSec).toBeLessThanOrEqual(sl.startSec + sl.durSec + 1e-6);
      }
    }
    console.log(`voicings with 3 notes: ${three}/${slotsN}; low notes that are not root/5th: ${lowBad}; top within a 3rd of the sung note: ${topBad}/${withMel}`);
    expect(three / slotsN).toBeGreaterThanOrEqual(0.98);
    expect(lowBad / slotsN).toBeLessThanOrEqual(0.1);
    expect(topBad / withMel).toBeLessThanOrEqual(0.1);
  });

  it('low voices (lo < G3): chords sit above the voice with a gap, bass an octave or more below it', () => {
    for (const s of songs.filter((x) => x.c.genre !== 'imn').slice(0, 6)) {
      const low = s.sections[0].notes.map((n) => ({ ...n, midi: n.midi - 14 }));
      const lo = Math.min(...low.map((n) => n.midi)), hi = Math.max(...low.map((n) => n.midi));
      const inp = { ...s.sections[0].inp, notes: low };
      const h = buildSectionHarmony(inp);
      const voiced = voiceSection({ chords: h.variants.A, slots: h.slots, notes: low, key: s.c.key, genre: s.c.genre });
      for (const vs of voiced) {
        expect(Math.min(...vs.voicing)).toBeGreaterThanOrEqual(hi + 3);
        expect(vs.bass).toBeLessThanOrEqual(lo - 7);
        expect(vs.bass).toBeGreaterThanOrEqual(BASS_LO);
      }
    }
  });
});
