import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { addMelodicLayers } from './melodic';
import type { Emotion, Genre, KeySig, Note, SectionType, TimeSig } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { MAJOR_SCALE, HARMONIC_MINOR } from '../../music/theory';
import { buildSectionHarmony, cadenceValid, candidatePool, type Chord } from '../harmony';
import {
  DRUM_HI, DRUM_LO, GENRE_PRESETS, STRONG_DRUMS, accentMap, arrangementMidi, defaultEnergies, drumBar, generateArrangement, groupStarts, midiText,
  isEighthMeter, type ArrSectionInput, type ArrangeInput, type Arrangement, type DrumStyle,
} from './index';

const sigOf = (id: string): TimeSig => TIME_SIGS.find((t) => t.id === id)!.sig;
const GENRES: Genre[] = ['worship', 'imn', 'cantare', 'pop', 'rock', 'popular'];

interface Cfg { genre: Genre; emotion: Emotion; key: KeySig; sig: TimeSig; bpm: number }
const CFG: Record<Genre, Cfg> = {
  worship: { genre: 'worship', emotion: 'inchinare', key: { tonic: 0, mode: 'major' }, sig: sigOf('4/4'), bpm: 84 },
  imn: { genre: 'imn', emotion: 'lauda', key: { tonic: 7, mode: 'major' }, sig: sigOf('4/4'), bpm: 72 },
  cantare: { genre: 'cantare', emotion: 'nostalgic', key: { tonic: 9, mode: 'minor' }, sig: sigOf('3/4'), bpm: 96 },
  pop: { genre: 'pop', emotion: 'romantic', key: { tonic: 2, mode: 'major' }, sig: sigOf('4/4'), bpm: 100 },
  rock: { genre: 'rock', emotion: 'energic', key: { tonic: 4, mode: 'major' }, sig: sigOf('4/4'), bpm: 120 },
  popular: { genre: 'popular', emotion: 'vesel', key: { tonic: 9, mode: 'minor' }, sig: sigOf('2/4'), bpm: 128 },
};

/** A sung-like melody in the register starting at `lo`. */
function melody(c: Cfg, bars: number, lo: number, dense: boolean): Note[] {
  const beat = 60 / c.bpm;
  const scale = c.key.mode === 'major' ? MAJOR_SCALE : HARMONIC_MINOR;
  const pitches: number[] = [];
  for (let m = lo; m <= lo + 12; m++) if (scale.includes(((m - c.key.tonic) % 12 + 12) % 12)) pitches.push(m);
  const notes: Note[] = [];
  const unit = c.sig.den === 8 ? 1 : dense ? 1 : 2;
  let k = 0;
  for (let b = 0; b < bars; b++) {
    const pos: number[] = [];
    for (let p = 0; p < c.sig.num - 1e-6; p += unit) pos.push(p);
    pos.forEach((p, i) => {
      if (b % 4 === 3 && i === pos.length - 1) return; // breath at the end of a phrase
      const start = (b * c.sig.num + p) * beat;
      const end = (b * c.sig.num + Math.min(c.sig.num, p + unit)) * beat;
      k = (k + (i % 2 === 0 ? 1 : 2) + b) % pitches.length;
      notes.push({ id: `n${b}-${p}`, midi: pitches[k], startSec: start, durSec: (end - start) * 0.92, velocity: 0.7, centsDev: 0, confidence: 1 });
    });
  }
  return notes;
}

const STRUCT: [SectionType, number][] = [
  ['intro', 4], ['strofa', 8], ['refren', 8], ['strofa', 8], ['refren', 8], ['bridge', 4], ['refren', 8], ['outro', 4],
];

function chordsOf(c: Cfg, notes: Note[], bars: number, type: SectionType, next: SectionType | null, last: boolean): ArrSectionInput['chords'] {
  const h = buildSectionHarmony({
    notes, key: c.key, bpm: c.bpm, sig: c.sig, bars, genre: c.genre, emotion: c.emotion, sectionType: type, nextType: next, isLastSection: last,
  });
  const ch = h.variants[h.active];
  return h.slots.map((s, i) => ({ startBeat: s.startBeat, beats: s.beats, chord: ch[i], phraseEnd: s.phraseEnd }));
}

function song(g: Genre | Cfg, opts: { lo?: number; structure?: [SectionType, number][]; energy?: Record<string, number>; drop?: boolean; emotion?: Emotion } = {}): ArrangeInput {
  const c = typeof g === 'string' ? CFG[g] : g;
  const lo = opts.lo ?? 62;
  const structure = opts.structure ?? STRUCT;
  const strofa = melody(c, 8, lo, false);
  const refren = melody(c, 8, lo + 2, true);
  const own: Partial<Record<SectionType, ArrSectionInput>> = {};
  const sections: ArrSectionInput[] = structure.map(([type, bars], i) => {
    const id = `s${i}`;
    if (type === 'strofa' || type === 'refren') {
      const src = own[type];
      if (src) return { ...src, id, label: `${type} ${i}`, bars, isCopy: true };
      const notes = type === 'strofa' ? strofa : refren;
      const sec: ArrSectionInput = {
        id, type, label: `${type} ${i}`, bars,
        notes: notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec })),
        chords: chordsOf(c, notes, bars, type, structure[i + 1]?.[0] ?? null, i === structure.length - 1),
      };
      own[type] = sec;
      return sec;
    }
    return { id, type, label: `${type} ${i}`, bars, notes: [], chords: null };
  });
  return { genre: c.genre, emotion: opts.emotion ?? c.emotion, key: c.key, bpm: c.bpm, sig: c.sig, sections, energy: opts.energy, drop: opts.drop };
}

const nonDrum = (a: Arrangement) => a.tracks.filter((t) => !t.drums);
function inSection(a: Arrangement, i: number) {
  const s = a.plan[i];
  const end = i === a.plan.length - 1 ? a.songSec : s.startSec + s.durSec;
  return a.tracks.flatMap((t) => t.notes.filter((n) => n.startSec >= s.startSec - 1e-6 && n.startSec < end - 1e-6));
}
const density = (a: Arrangement, i: number) => inSection(a, i).length / a.plan[i].durSec;

function vocalSong(inp: ArrangeInput, a: Arrangement) {
  return inp.sections.flatMap((s, i) => s.notes.map((n) => ({ midi: n.midi, start: a.plan[i].startSec + n.startSec, end: a.plan[i].startSec + n.startSec + n.durSec })));
}

describe('M4 arrangement: genres and instruments', () => {
  const results = GENRES.map((g) => ({ g, inp: song(g), arr: generateArrangement(song(g)) }));

  it('each of the 6 genres yields its own distinct instrument set', () => {
    const sets = results.map((r) => r.arr.tracks.map((t) => t.id).sort().join(','));
    expect(new Set(sets).size).toBe(6);
    const has = (g: Genre) => new Set(results.find((r) => r.g === g)!.arr.tracks.map((t) => t.id));
    expect(has('worship')).toContain('pad');
    expect(has('worship')).toContain('chit');
    expect(has('worship')).toContain('tobe');
    expect(has('imn').has('tobe')).toBe(false);
    expect(has('imn')).toContain('orga');
    expect(has('cantare')).toContain('acor');
    expect(has('cantare')).toContain('vioara');
    expect(has('pop')).toContain('corzi');
    expect(has('rock')).toContain('chit1');
    expect(has('popular')).toContain('taml');
    expect(has('popular')).toContain('nai');
  });

  it('refren has >= 1.5x the note density of the strofa and more active tracks', () => {
    for (const r of results) {
      const s = density(r.arr, 1), f = density(r.arr, 2);
      expect(f / s, `${r.g} density ratio`).toBeGreaterThanOrEqual(1.5);
      expect(r.arr.plan[2].active.length, `${r.g} active tracks`).toBeGreaterThan(r.arr.plan[1].active.length);
    }
  });

  it('all notes stay inside the practical range of their instrument', () => {
    for (const r of results) {
      for (const t of r.arr.tracks) {
        const def = GENRE_PRESETS[r.g].tracks.find((d) => d.id === t.id)!;
        for (const n of t.notes) {
          if (t.drums) { expect(n.midi).toBeGreaterThanOrEqual(DRUM_LO); expect(n.midi).toBeLessThanOrEqual(DRUM_HI); }
          else { expect(n.midi, `${r.g}/${t.id}`).toBeGreaterThanOrEqual(def.lo); expect(n.midi, `${r.g}/${t.id}`).toBeLessThanOrEqual(def.hi); }
          expect(n.vel).toBeGreaterThan(0); expect(n.vel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('comping never goes above the concurrent vocal note (normal voice register)', () => {
    for (const r of results) {
      expect(r.arr.register.mode).toBe('below');
      const vocal = vocalSong(r.inp, r.arr);
      for (const t of nonDrum(r.arr)) for (const n of t.notes) {
        for (const v of vocal) {
          if (n.startSec < v.end - 1e-6 && n.startSec + n.durSec > v.start + 1e-6) { const m = `${r.g}/${t.id} @${n.startSec.toFixed(2)}`; if (r.g === 'imn') expect(n.midi, m).toBeLessThanOrEqual(v.midi); else expect(n.midi, m).toBeLessThan(v.midi); }
        }
      }
    }
  });

  it('nothing is scheduled past the song end and sections are contiguous', () => {
    for (const r of results) {
      for (const t of r.arr.tracks) for (const n of t.notes) {
        expect(n.startSec).toBeGreaterThanOrEqual(0);
        expect(n.startSec + n.durSec).toBeLessThanOrEqual(r.arr.songSec + 1e-6);
      }
      let end = 0;
      for (const s of r.arr.plan) { expect(s.startSec).toBeCloseTo(end, 6); end = s.startSec + s.durSec; }
      expect(end).toBeCloseTo(r.arr.songSec, 6);
    }
  });

  it('is deterministic and fast', () => {
    const inp = song('worship');
    const t0 = performance.now();
    const a = generateArrangement(inp);
    const dt = performance.now() - t0;
    expect(JSON.stringify(generateArrangement(inp))).toBe(JSON.stringify(a));
    expect(dt).toBeLessThan(400);
  });
});

describe('M4 song form and dynamics', () => {
  it('default energy curve follows A4', () => {
    const e = defaultEnergies(STRUCT.map((s) => s[0]));
    expect(e.map((x) => x.energy)).toEqual([2, 2, 3, 3, 4, 3, 5, 2]);
    expect(e[5].rampTo).toBe(5);
    expect(e[7].rampTo).toBe(1);
  });

  it('energy is monotonic across strofe and refrene; final refren is the peak', () => {
    for (const g of GENRES) {
      const a = generateArrangement(song(g));
      const en = (ty: string) => a.plan.filter((s) => s.type === ty).map((s) => s.energy);
      for (const ty of ['strofa', 'refren']) { const x = en(ty); expect(x).toEqual([...x].sort((p, q) => p - q)); }
      const peak = Math.max(...a.plan.map((s) => s.energy));
      expect(a.plan[6].energy).toBe(peak);
      expect(a.plan[6].energy).toBe(5);
      expect(density(a, 6)).toBeGreaterThan(density(a, 2));
    }
  });

  it('user energy overrides are applied', () => {
    const a = generateArrangement(song('worship', { energy: { s2: 5 } }));
    expect(a.plan[2].energy).toBe(5);
    expect(density(a, 2)).toBeGreaterThan(density(generateArrangement(song('worship')), 2));
  });

  it('emotion changes instrumentation: rugaciune is pad + piano only', () => {
    const a = generateArrangement(song('worship', { emotion: 'rugaciune' }));
    expect(a.tracks.map((t) => t.id).sort()).toEqual(['pad', 'pian']);
  });

  it('transitions: drum fill before refren, crash on its downbeat, optional drop, bridge swell, ritardando', () => {
    const a = generateArrangement(song('worship', { drop: true }));
    const kinds = (k: string, id: string) => a.transitions.filter((t) => t.kind === k && t.sectionId === id);
    expect(kinds('fill', 's1').length).toBe(1);
    expect(kinds('crash', 's2').length).toBe(1);
    expect(kinds('swell', 's4').length).toBe(1);
    expect(kinds('drop', 's5').length).toBe(1);
    expect(kinds('ritardando', 's7').length).toBe(1);
    const barSec = (60 / 84) * 4;
    const dropStart = a.plan[5].startSec + 3 * barSec;
    for (const t of a.tracks) for (const n of t.notes) {
      expect(n.startSec >= dropStart - 1e-6 && n.startSec < dropStart + barSec - 1e-6, `${t.id} plays in the drop bar`).toBe(false);
      expect(n.startSec < dropStart && n.startSec + n.durSec > dropStart + 1e-6).toBe(false);
    }
    const crash = a.tracks.find((t) => t.id === 'tobe')!.notes.find((n) => n.midi === 49 && Math.abs(n.startSec - a.plan[2].startSec) < 1e-6);
    expect(crash).toBeTruthy();
    expect(a.songSec).toBeGreaterThan(a.plan.reduce((s, x) => s + x.bars, 0) * barSec); // ritardando + held chord
    const noDrop = generateArrangement(song('worship'));
    expect(noDrop.transitions.some((t) => t.kind === 'drop')).toBe(false);
  });

  it('generated sections have valid harmony and cadences; copies keep the source chords', () => {
    for (const g of GENRES) {
      const inp = song(g);
      const a = generateArrangement(inp);
      const pool = candidatePool(inp.key);
      const ch = (i: number): Chord[] => a.plan[i].chords.map((c) => c.chord);
      const rel = (c: Chord) => (((c.root - inp.key.tonic) % 12) + 12) % 12;
      // copies
      expect(ch(3)).toEqual(ch(1)); expect(ch(4)).toEqual(ch(2)); expect(ch(6)).toEqual(ch(2));
      expect(a.plan[3].chordSource).toBe('copy');
      for (const i of [0, 5, 7]) {
        expect(a.plan[i].chordSource).toBe('generated');
        expect(ch(i).length).toBeGreaterThan(0);
        for (const c of ch(i)) expect(pool.some((p) => p.chord.root === c.root && p.chord.quality === c.quality), `${g} chord ${c.roman}`).toBe(true);
      }
      // intro ends on tonic or dominant
      expect([0, 7]).toContain(rel(ch(0)[ch(0).length - 1]));
      // bridge: starts on IV / vi (iv / VI) and ends with a half cadence on V
      const br = ch(5);
      expect([5, 9, 8]).toContain(rel(br[0]));
      expect(cadenceValid(br[br.length - 2] ?? null, br[br.length - 1], inp.key, 'half', false)).toBe(true);
      // outro: final cadence (plagal Amin for hymns)
      const out = ch(7);
      expect(cadenceValid(out[out.length - 2] ?? null, out[out.length - 1], inp.key, 'authentic', g === 'imn')).toBe(true);
      if (g === 'imn') expect(rel(out[out.length - 2])).toBe(5);
    }
  });
});

describe('M4 patterns and meters', () => {
  const STYLES: DrumStyle[] = ['sparse', 'kit', 'kit8', 'rock', 'perc', 'percFull', 'hora'];
  it('drum accents follow the meter grouping in every supported meter', () => {
    for (const ts of TIME_SIGS) {
      const sig = ts.sig;
      const gs = groupStarts(sig);
      const map = accentMap(sig);
      expect(Math.max(...map)).toBe(1);
      expect(map[0]).toBe(1);
      if (isEighthMeter(sig)) for (const p of gs.slice(1)) expect(map[p], `${ts.id} group start ${p}`).toBeGreaterThan(Math.max(...map.filter((_, i) => !gs.includes(i))));
      for (const st of STYLES) {
        const bar = drumBar(sig, st, 4);
        expect(bar.length).toBeGreaterThan(0);
        for (const h of bar) { expect(h.pos).toBeGreaterThanOrEqual(0); expect(h.pos).toBeLessThan(sig.num); }
        const strong = bar.filter((h) => STRONG_DRUMS.includes(h.note));
        if (isEighthMeter(sig)) for (const h of strong) expect(gs, `${ts.id}/${st} strong hit at ${h.pos}`).toContain(h.pos);
        if (st !== 'perc') {
          const kick = bar.find((h) => h.pos === 0 && h.note === 36);
          expect(kick, `${ts.id}/${st} downbeat kick`).toBeTruthy();
          expect(Math.max(...bar.map((h) => h.vel)), `${ts.id}/${st} downbeat is the loudest`).toBeLessThanOrEqual(kick!.vel + 1e-9 + (st === 'rock' ? 0.0 : 0));
        }
      }
    }
  });

  it('every supported meter yields a valid whole-song arrangement', () => {
    for (const ts of TIME_SIGS) {
      const cfg: Cfg = { genre: 'popular', emotion: 'vesel', key: { tonic: 9, mode: 'minor' }, sig: ts.sig, bpm: 120 };
      const inp = song(cfg, { structure: STRUCT });
      const a = generateArrangement(inp);
      expect(a.tracks.length).toBeGreaterThanOrEqual(4);
      for (const t of a.tracks) for (const n of t.notes) expect(n.startSec + n.durSec).toBeLessThanOrEqual(a.songSec + 1e-6);
      const bar = (60 / 120) * ts.sig.num;
      // bass / comping hits land on a grid of the pulse (quantised to 1/2 beat)
      const beat = 0.5;
      for (const t of a.tracks.filter((x) => x.id === 'bas')) for (const n of t.notes.slice(0, 200)) {
        if (n.startSec > a.plan[7].startSec) break;
        const q = (n.startSec % bar) / beat;
        expect(Math.abs(q - Math.round(q)), `${ts.id} bass off grid`).toBeLessThan(1e-6);
      }
    }
  });
});

describe('M4 low-voice register (B2-E3)', () => {
  it('keeps comping above the voice with a gap and the bass below it', () => {
    for (const g of GENRES) {
      const cfg = CFG[g];
      const inp = song(cfg, { lo: 47 });
      // squeeze the melody to B2..E3 (47..52)
      for (const s of inp.sections) for (const n of s.notes) { while (n.midi > 52) n.midi -= 12; while (n.midi < 47) n.midi += 12; }
      const a = generateArrangement(inp);
      expect(a.register.mode).toBe('above');
      const hi = Math.max(...inp.sections.flatMap((s) => s.notes.map((n) => n.midi)));
      const lo = Math.min(...inp.sections.flatMap((s) => s.notes.map((n) => n.midi)));
      for (const t of nonDrum(a)) {
        const isBass = t.id === 'bas';
        for (const n of t.notes) {
          if (isBass) expect(n.midi, `${g} bass`).toBeLessThanOrEqual(lo - 1);
          else expect(n.midi, `${g}/${t.id}`).toBeGreaterThanOrEqual(hi + 3);
        }
      }
    }
  });
});

describe('M4 MIDI export', () => {
  it('writes GM programs, drums on channel 10, tempo, meter and chord markers', () => {
    const inp = song('worship');
    const a = generateArrangement(inp);
    const bytes = arrangementMidi(a, { name: 'Test', bpm: inp.bpm, sig: inp.sig, melody: [{ midi: 64, startSec: 0, durSec: 1, vel: 0.7 }] });
    const m = new Midi(bytes);
    expect(m.tracks.length).toBe(a.tracks.length + 1);
    expect(m.header.tempos[0].bpm).toBeCloseTo(84, 0);
    expect(m.header.timeSignatures[0].timeSignature).toEqual([4, 4]);
    for (const t of a.tracks) {
      const mt = m.tracks.find((x) => x.name === midiText(t.name))!;
      expect(mt).toBeTruthy();
      if (t.drums) { expect(mt.channel).toBe(9); expect(mt.instrument.percussion).toBe(true); }
      else { expect(mt.instrument.number).toBe(t.gm); expect(mt.channel).not.toBe(9); }
      expect(mt.notes.length).toBe(t.notes.length);
    }
    expect(m.header.meta.filter((x) => x.type === 'marker').length).toBeGreaterThan(20);
  });
});

describe('M5 adapter: melodic layers on the arrangement', () => {
  for (const g of GENRES) {
    it(`${g}: low voice B2-E3 -> melodic notes never overlap sung notes and stay above E3`, () => {
      const inp = song(CFG[g], { lo: 47 });
      for (const s of inp.sections) for (const n of s.notes) { while (n.midi > 52) n.midi -= 12; while (n.midi < 47) n.midi += 12; }
      const base = generateArrangement(inp);
      const a = addMelodicLayers(inp, base, 7);
      const extra = a.tracks.filter((t) => ['hook', 'answers', 'counter'].includes(t.id));
      expect(extra.length, 'melodic tracks').toBeGreaterThanOrEqual(2);
      expect(new Set(a.tracks.map((t) => t.channel)).size).toBe(a.tracks.length);
      expect(a.melodic).toBeTruthy();
      const vocal = vocalSong(inp, a);
      for (const t of extra) for (const n of t.notes) {
        expect(n.midi, `${g}/${t.id}`).toBeGreaterThan(52);
        expect(n.startSec + n.durSec).toBeLessThanOrEqual(a.songSec + 1e-6);
        // the counter-melody is meant to sound WITH the voice (above it); hook and answers fill the pauses
        if (t.id !== 'counter') for (const v of vocal) expect(n.startSec < v.end - 1e-6 && n.startSec + n.durSec > v.start + 1e-6, `${g}/${t.id} overlaps vocal @${n.startSec.toFixed(2)}`).toBe(false);
      }
      // switched-off layers disappear; same seed is deterministic
      const off = addMelodicLayers(inp, base, 7, ['counter']);
      expect(off.tracks.some((t) => t.id === 'counter')).toBe(false);
      expect(JSON.stringify(addMelodicLayers(inp, base, 7))).toBe(JSON.stringify(a));
    });
  }
  it('MIDI export carries the melodic tracks', () => {
    const inp = song('worship');
    const a = addMelodicLayers(inp, generateArrangement(inp), 3);
    const m = new Midi(arrangementMidi(a, { name: 'x', bpm: inp.bpm, sig: inp.sig }));
    expect(m.tracks.length).toBe(a.tracks.length);
    expect(a.tracks.length).toBeGreaterThan(generateArrangement(inp).tracks.length);
  });
});

describe('M5 adapter: answers in pauses', () => {
  it('a melody with >= 1-beat pauses yields non-empty answers that sit inside the pauses', () => {
    for (const g of ['worship', 'pop'] as Genre[]) {
      const inp = song(g);
      const a = addMelodicLayers(inp, generateArrangement(inp), 5);
      const ans = a.tracks.find((t) => t.id === 'answers');
      expect(ans, `${g} answers`).toBeTruthy();
      expect(ans!.notes.length).toBeGreaterThan(0);
      const vocal = vocalSong(inp, a);
      for (const n of ans!.notes) for (const v of vocal) expect(n.startSec < v.end - 1e-6 && n.startSec + n.durSec > v.start + 1e-6).toBe(false);
    }
  });
});
