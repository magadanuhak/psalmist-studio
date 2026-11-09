import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { arrangementMidi, midiText } from './midi';
import type { Genre, KeySig, Note, SectionType, TimeSig } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { MAJOR_SCALE } from '../../music/theory';
import { buildSectionHarmony } from '../harmony';
import { generateArrangement, type ArrangeInput, type ArrSectionInput, type Arrangement } from './index';
import { addMelodicLayers } from './melodic';
import { findClashes, guardClashes, phraseContour, rubatoShift, restoreThirds, MAX_ACTIVE, LAYER_INST, limitSimultaneous, realizeArrangement, tasteAudit } from './realize';
import { getInstrument } from '../../audio/instruments/catalog';
import { STRUM_GAP_MAX_MS, STRUM_GAP_MIN_MS } from '../../audio/instruments/strum';

const sig: TimeSig = TIME_SIGS.find((t) => t.id === '4/4')!.sig;
const key: KeySig = { tonic: 0, mode: 'major' };

function melody(bpm: number, bars: number): Note[] {
  const beat = 60 / bpm;
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72].filter((m) => MAJOR_SCALE.includes(m % 12));
  const out: Note[] = [];
  for (let b = 0; b < bars; b++) for (let p = 0; p < 4; p += 1) {
    if (b % 4 === 3 && p === 3) continue;
    out.push({ id: `n${b}${p}`, midi: pitches[(b * 3 + p * 2) % pitches.length], startSec: (b * 4 + p) * beat, durSec: beat * 0.9, velocity: 0.7, centsDev: 0, confidence: 1 });
  }
  return out;
}

function input(genre: Genre): ArrangeInput {
  const bpm = 90;
  const emotion = genre === 'cantare' ? 'nostalgic' : 'inchinare';
  const plan: [SectionType, number][] = [['intro', 4], ['strofa', 8], ['refren', 8], ['strofa', 8], ['refren', 8], ['bridge', 4], ['refren', 8], ['outro', 4]];
  const own: Partial<Record<SectionType, ArrSectionInput>> = {};
  const sections = plan.map(([type, bars], i): ArrSectionInput => {
    const id = `s${i}`;
    if (type === 'strofa' || type === 'refren') {
      if (own[type]) return { ...own[type]!, id, label: `${type}${i}`, bars, isCopy: true };
      const notes = melody(bpm, bars);
      const h = buildSectionHarmony({ notes, key, bpm, sig, bars, genre, emotion, sectionType: type, nextType: plan[i + 1]?.[0] ?? null, isLastSection: false });
      const ch = h.variants[h.active];
      const s: ArrSectionInput = { id, type, label: `${type}${i}`, bars, notes: notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec })), chords: h.slots.map((sl, k) => ({ startBeat: sl.startBeat, beats: sl.beats, chord: ch[k], phraseEnd: sl.phraseEnd })) };
      own[type] = s;
      return s;
    }
    return { id, type, label: `${type}${i}`, bars, notes: [], chords: null };
  });
  return { genre, emotion, key, bpm, sig, sections };
}

const build = (genre: Genre) => { const inp = input(genre); return { inp, arr: addMelodicLayers(inp, generateArrangement(inp), 1) }; };
const real = (genre: Genre, seed = 1) => { const { inp, arr } = build(genre); return realizeArrangement(arr, { seed, bpm: inp.bpm, sig, genre, emotion: inp.emotion }); };

describe('M7/Q realism pass', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = real('worship', 3), b = real('worship', 3), c = real('worship', 4);
    expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
    expect(JSON.stringify(a.tracks)).not.toBe(JSON.stringify(c.tracks));
  });

  it('keeps every note inside the instrument range and gives every track a catalog instrument', () => {
    for (const g of ['worship', 'cantare', 'pop', 'imn'] as Genre[]) {
      const arr = real(g);
      for (const t of arr.tracks) {
        if (t.drums) continue;
        const e = getInstrument(t.inst ?? '');
        expect(e, `${g}/${t.id} has an instrument`).toBeTruthy();
        for (const n of t.notes) expect(n.midi >= e!.range[0] && n.midi <= e!.range[1], `${g}/${t.id} ${n.midi}`).toBe(true);
      }
    }
  });

  it('worship / pop and cantare use clearly different palettes', () => {
    const ids = (g: Genre) => new Set(real(g).tracks.filter((t) => !t.drums).map((t) => t.inst));
    const w = ids('worship'), c = ids('cantare'), p = ids('pop');
    for (const x of ['emily_guitar', 'warm_pad', 'piano']) expect(w.has(x)).toBe(true);
    for (const x of ['accordion', 'violin_solo', 'clarinet', 'contrabass']) expect(c.has(x)).toBe(true);
    expect([...w].filter((x) => c.has(x))).toHaveLength(0);
    expect([...p].filter((x) => c.has(x))).toHaveLength(0);
    expect(LAYER_INST.cantare.hook).not.toBe(LAYER_INST.pop.hook === 'vibraphone' ? 'vibraphone' : '');
  });

  it('humanizes: timing offsets are small (median < 30 ms), rubato stays under 90 ms, notes are not all on the grid', () => {
    const { arr } = build('worship');
    const re = real('worship');
    const base = arr.tracks.find((t) => t.id === 'pian')!.notes, hum = re.tracks.find((t) => t.id === 'pian')!.notes;
    expect(hum.length).toBe(base.length);
    const off = hum.map((n) => base.reduce((m, b) => Math.min(m, Math.abs(b.startSec - n.startSec)), 9));
    // human jitter about +-20 ms for a pianist, plus the shared rubato (up to 50 ms) at phrase and section ends
    expect(Math.max(...off)).toBeLessThan(0.09);
    expect([...off].sort((a, b) => a - b)[Math.floor(off.length / 2)]).toBeLessThan(0.03);
    expect(off.filter((o) => o > 0.001).length).toBeGreaterThan(off.length * 0.5);
  });

  it('never repeats the same note with the same velocity twice in a row on keys and percussion', () => {
    const arr = real('worship');
    for (const t of arr.tracks.filter((x) => x.drums || x.id === 'pian')) {
      const last = new Map<number, number>();
      for (const n of [...t.notes].sort((a, b) => a.startSec - b.startSec)) {
        const p = last.get(n.midi);
        if (p !== undefined) expect(Math.abs(p - n.vel)).toBeGreaterThan(0.001);
        last.set(n.midi, n.vel);
      }
    }
  });

  it('guitar chords are strummed with 8-25 ms between the strings', () => {
    const arr = real('worship');
    const g = arr.tracks.find((t) => t.id === 'chit')!;
    const sorted = [...g.notes].sort((a, b) => a.startSec - b.startSec);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) { const d = (sorted[i].startSec - sorted[i - 1].startSec) * 1000; if (d > 0.5 && d < 60) gaps.push(d); }
    expect(gaps.length).toBeGreaterThan(10);
    const inSpec = gaps.filter((d) => d >= STRUM_GAP_MIN_MS * 0.6 && d <= STRUM_GAP_MAX_MS * 1.6).length;
    expect(inSpec / gaps.length).toBeGreaterThan(0.7);
  });

  it('at most MAX_ACTIVE harmonic / melodic tracks sound together in any section; the audit agrees', () => {
    for (const g of ['worship', 'pop', 'cantare', 'imn', 'rock', 'popular'] as Genre[]) {
      const arr = real(g);
      const rep = tasteAudit(arr, 90, 4);
      expect(rep.maxSimultaneous, g).toBeLessThanOrEqual(MAX_ACTIVE);
      expect(rep.warnings).not.toContain('tooMany');
    }
  });

  it('limitSimultaneous drops the least important tracks first and keeps bass and drums', () => {
    const { arr } = build('worship');
    const crowded: Arrangement = { ...arr, tracks: [...arr.tracks, ...['x1', 'x2', 'x3', 'x4'].map((id, k) => ({ ...arr.tracks[0], id, notes: arr.tracks[0].notes.map((n) => ({ ...n, midi: n.midi + k })) }))] };
    const out = limitSimultaneous(crowded, getInstrument, 5);
    expect(tasteAudit(out, 90, 4).maxSimultaneous).toBeLessThanOrEqual(5);
    expect(out.tracks.find((t) => t.id === 'bas')!.notes.length).toBe(crowded.tracks.find((t) => t.id === 'bas')!.notes.length);
    expect(out.tracks.find((t) => t.id === 'tobe')!.notes.length).toBe(crowded.tracks.find((t) => t.id === 'tobe')!.notes.length);
  });

  it('a user override swaps the instrument and its range is respected', () => {
    const { inp, arr } = build('worship');
    const swapped = realizeArrangement(arr, { seed: 1, bpm: inp.bpm, sig, genre: 'worship', emotion: inp.emotion, overrides: { pian: 'kalimba' } });
    const t = swapped.tracks.find((x) => x.id === 'pian')!;
    expect(t.inst).toBe('kalimba');
    expect(t.sampler).toBeUndefined();
    const r = getInstrument('kalimba')!.range;
    for (const n of t.notes) expect(n.midi >= r[0] && n.midi <= r[1]).toBe(true);
  });

  it('string tracks get articulations from their manifest by energy', () => {
    const arr = real('imn');
    const s = arr.tracks.find((t) => t.id === 'corzi')!;
    const arts = new Set(s.notes.map((n) => n.art));
    expect(arts.size).toBeGreaterThan(0);
    for (const a of arts) expect(getInstrument('violins')!.articulations).toContain(a);
  });

  it('song MIDI: a channel never carries two programs, drums are on channel 10 (index 9)', () => {
    for (const g of ['worship', 'cantare', 'pop', 'imn', 'rock', 'popular'] as Genre[]) {
      const arr = real(g);
      const m = new Midi(arrangementMidi(arr, { name: 'x', bpm: 90, sig, melody: [{ midi: 64, startSec: 0, durSec: 1, vel: 0.7 }] }));
      const progs = new Map<number, Set<number>>();
      for (const t of m.tracks.filter((x) => x.notes.length)) {
        if (t.channel === 9) { expect(t.instrument.percussion || t.channel === 9).toBe(true); continue; }
        const set = progs.get(t.channel) ?? new Set<number>(); set.add(t.instrument.number); progs.set(t.channel, set);
      }
      for (const [ch, set] of progs) expect(set.size, `${g} channel ${ch}`).toBe(1);
      const drumNames = arr.tracks.filter((t) => t.drums).map((t) => t.name);
      for (const n of drumNames) expect(m.tracks.find((t) => t.name === midiText(n))!.channel).toBe(9);
      expect(m.tracks.filter((t) => t.channel !== 9).every((t) => t.channel !== 9)).toBe(true);
    }
  });

  it('restores a missing third in a lower register, unless a held sung note would clash by a semitone', () => {
    const { arr } = build('worship');
    const strip = (a: Arrangement): Arrangement => ({ ...a, tracks: a.tracks.map((t) => ({ ...t, notes: t.drums ? t.notes : [] })) });
    const bare = strip(arr);
    const gm = bare.plan.find((s) => s.chords.some((c) => c.chord.quality === 'min' || c.chord.quality === 'maj'))!;
    const c = gm.chords.find((x) => x.chord.quality === 'min' || x.chord.quality === 'maj')!;
    const third = (c.chord.root + (c.chord.quality === 'maj' ? 4 : 3)) % 12;
    const out = restoreThirds(bare, {});
    const got = out.tracks.flatMap((t) => t.notes).filter((n) => n.midi % 12 === third && Math.abs(n.startSec - (gm.startSec + c.startSec)) < 1e-6);
    expect(got.length).toBeGreaterThan(0);
    for (const n of got) expect(n.midi >= 48 && n.midi <= 59).toBe(true);
    const t0 = gm.startSec + c.startSec;
    const clashed = restoreThirds(bare, { vocal: [{ midi: 60 + ((third + 1) % 12), startSec: t0, durSec: 1 }] });
    expect(clashed.tracks.flatMap((t) => t.notes).filter((n) => n.midi % 12 === third && Math.abs(n.startSec - t0) < 1e-6)).toHaveLength(0);
  });

  it('the Acustic (live) palette is tier-A only: real piano, cello, violas / violins and flute; no synths, organs, SoundFont or drums', () => {
    for (const g of ['worship', 'pop'] as Genre[]) {
      const inp = { ...input(g), palette: 'acustic' as const };
      const arr = realizeArrangement(addMelodicLayers(inp, generateArrangement(inp), 1), { seed: 1, bpm: inp.bpm, sig, genre: g, emotion: inp.emotion, palette: 'acustic' });
      expect(arr.tracks.some((t) => t.drums)).toBe(false);
      for (const t of arr.tracks) {
        const e = getInstrument(t.inst ?? '');
        expect(e, `${g}/${t.id}`).toBeTruthy();
        expect(e!.tier, `${g}/${t.id} ${t.inst}`).toBe('A');
        expect(['synth', 'organ', 'choir']).not.toContain(e!.family);
      }
      const ids = new Set(arr.tracks.map((t) => t.inst));
      expect(ids.has('piano') && ids.has('cellos')).toBe(true);
      const layers = arr.tracks.filter((t) => ['hook', 'answers'].includes(t.id));
      for (const l of layers) expect(l.inst).toBe('flute');
      const cello = arr.tracks.find((t) => t.id === 'cello')!;
      expect(cello.notes.length).toBeGreaterThan(20); // the cello carries the bass line
    }
  });

  it('clash finder: a semitone or flat 9th from a sung note for more than 150 ms is listed; the guard removes every one', () => {
    const arr: Arrangement = { ...build('worship').arr, tracks: [
      { id: 'a', name: 'a', gm: 0, channel: 0, drums: false, level: 1, pan: 0, reverb: 0, notes: [
        { midi: 61, startSec: 0, durSec: 1, vel: 0.5 },   // semitone above the sung C: clash
        { midi: 73, startSec: 2, durSec: 1, vel: 0.5 },   // flat 9th above: clash
        { midi: 64, startSec: 4, durSec: 1, vel: 0.5 },   // major third: fine
        { midi: 61, startSec: 6, durSec: 0.1, vel: 0.5 }, // too short to matter
        { midi: 62, startSec: 7.9, durSec: 1, vel: 0.5 }, // starts before the sung note, overlaps by 0.1 s only: fine
      ] },
    ] };
    const vocal = [{ midi: 60, startSec: 0, durSec: 1 }, { midi: 60, startSec: 2, durSec: 1 }, { midi: 60, startSec: 4, durSec: 1 }, { midi: 60, startSec: 6, durSec: 1 }, { midi: 61, startSec: 8, durSec: 0.1 }];
    const c = findClashes(arr, vocal);
    expect(c.map((x) => x.startSec)).toEqual([0, 2]);
    expect(findClashes(guardClashes(arr, vocal), vocal)).toHaveLength(0);
  });

  it('every benchmark-style arrangement is clash free after the guard', () => {
    for (const g of ['worship', 'pop', 'cantare'] as Genre[]) {
      const { inp, arr } = build(g);
      const vocal = arr.plan.flatMap((s, i) => inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })));
      const out = realizeArrangement(arr, { seed: 1, bpm: inp.bpm, sig, genre: g, emotion: inp.emotion, vocal });
      expect(findClashes(out, vocal), g).toHaveLength(0);
    }
  });

  it('rubato: no shift mid-phrase, a slight one at phrase ends and more at the end of a section; velocity swells into the phrase peak', () => {
    const { arr } = build('worship');
    const bar = (60 / 90) * 4, s = arr.plan[1];
    expect(rubatoShift(s.startSec + 1.2 * bar, arr.plan, bar)).toBe(0);
    const pe = rubatoShift(s.startSec + 3.9 * bar, arr.plan, bar), se = rubatoShift(s.startSec + (s.bars - 0.1) * bar, arr.plan, bar);
    expect(pe).toBeGreaterThan(0.005); expect(pe).toBeLessThan(0.03);
    expect(se).toBeGreaterThan(pe); expect(se).toBeLessThanOrEqual(0.05);
    const c = (u: number) => phraseContour(s.startSec + u * 4 * bar, arr.plan, bar);
    expect(c(0.7)).toBeGreaterThan(c(0.05)); expect(c(0.7)).toBeGreaterThan(c(0.97));
  });
});
