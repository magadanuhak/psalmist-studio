/** Song form (A4): energy curve and harmony of the generated sections (intro / bridge / outro / copies). */
import type { Genre, KeySig, SectionType, TimeSig } from '../../model/types';
import { funcOf, romanOf } from '../harmony/chords';
import type { Chord, ChordQuality } from '../harmony/types';
import type { ArrSectionInput, Energy, PlannedChord } from './types';

export const clampE = (n: number): Energy => Math.max(1, Math.min(5, Math.round(n))) as Energy;

/** Default energy per section from the song order (A4). Bridge builds 3 -> 5, outro fades 2 -> 1. */
export function defaultEnergies(types: SectionType[]): { energy: Energy; rampTo?: Energy }[] {
  const refrens = types.filter((x) => x === 'refren').length;
  let strofa = 0, refren = 0;
  return types.map((ty) => {
    switch (ty) {
      case 'intro': return { energy: 2 as Energy };
      case 'strofa': { strofa++; return { energy: (strofa === 1 ? 2 : 3) as Energy }; }
      case 'prerefren': return { energy: 3 as Energy };
      case 'refren': {
        refren++;
        if (refren === 1) return { energy: 3 as Energy };
        return { energy: (refren === refrens ? 5 : 4) as Energy };
      }
      case 'bridge': return { energy: 3 as Energy, rampTo: 5 as Energy };
      case 'interlude': return { energy: 3 as Energy };
      case 'outro': return { energy: 2 as Energy, rampTo: 1 as Energy };
    }
  });
}

export function mkChord(root: number, quality: ChordQuality, key: KeySig): Chord {
  const r = ((root % 12) + 12) % 12;
  return { root: r, quality, roman: romanOf(r, quality, key), func: funcOf(r, quality, key, false) };
}

const deg = (key: KeySig, rel: number, q: ChordQuality) => mkChord(key.tonic + rel, q, key);

export const tonicChord = (key: KeySig) => deg(key, 0, key.mode === 'major' ? 'maj' : 'min');
export const dominantChord = (key: KeySig, seventh: boolean) => deg(key, 7, seventh ? 'dom7' : 'maj');
const subdominantChord = (key: KeySig) => deg(key, 5, key.mode === 'major' ? 'maj' : 'min');

const SEVENTH_V: Genre[] = ['imn', 'cantare', 'popular'];

/** Bridge: starts on IV (or iv / VI in minor), ends with a half cadence on V. */
export function bridgeChords(bars: number, key: KeySig, genre: Genre): Chord[] {
  const major = key.mode === 'major';
  const S = subdominantChord(key);
  const alt = major ? deg(key, 9, 'min') : deg(key, 8, 'maj'); // vi / VI
  const mid = major ? deg(key, 2, 'min') : deg(key, 8, 'maj'); // ii / VI
  const V = dominantChord(key, SEVENTH_V.includes(genre));
  if (bars <= 1) return [V];
  if (bars === 2) return [S, V];
  if (bars === 3) return [S, mid, V];
  const tail = major ? [S, alt, mid, V] : [S, alt, S, V];
  const head: Chord[] = [];
  for (let i = 0; i < bars - 4; i++) head.push(i % 2 === 0 ? S : alt);
  return [...head, ...tail];
}

/** Fallback loop when no chords exist anywhere in the song yet. */
export function defaultLoop(key: KeySig): Chord[] {
  return key.mode === 'major'
    ? [deg(key, 0, 'maj'), deg(key, 7, 'maj'), deg(key, 9, 'min'), deg(key, 5, 'maj')]
    : [deg(key, 0, 'min'), deg(key, 8, 'maj'), deg(key, 3, 'maj'), deg(key, 7, 'maj')];
}

export interface RawSlot { startBeat: number; beats: number; chord: Chord; phraseEnd: boolean }

/** Cut slots longer than a bar into bar-sized slots (cadence editing and the arrangement work bar by bar). */
export function splitToBars(slots: RawSlot[], num: number): RawSlot[] {
  const out: RawSlot[] = [];
  for (const s of slots) {
    let b = s.startBeat;
    const end = s.startBeat + s.beats;
    while (b < end - 1e-6) {
      const barEnd = (Math.floor(b / num + 1e-6) + 1) * num;
      const e = Math.min(end, barEnd);
      out.push({ startBeat: b, beats: e - b, chord: s.chord, phraseEnd: s.phraseEnd && e >= end - 1e-6 });
      b = e;
    }
  }
  return out;
}

/** Fit a chord list onto `bars` bars: cycled when shorter, trimmed when longer. */
export function fitSlots(src: RawSlot[], bars: number, num: number): RawSlot[] {
  const total = bars * num;
  if (!src.length) return [];
  const len = Math.max(...src.map((s) => s.startBeat + s.beats));
  if (len <= 0) return [];
  const out: RawSlot[] = [];
  for (let k = 0; k * len < total - 1e-6; k++) {
    for (const s of src) {
      const st = s.startBeat + k * len;
      if (st >= total - 1e-6) break;
      out.push({ ...s, startBeat: st, beats: Math.min(s.beats, total - st) });
    }
  }
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], phraseEnd: true };
  return out;
}

const relOf = (c: Chord, key: KeySig) => (((c.root - key.tonic) % 12) + 12) % 12;

export interface FormPlan { chordSource: 'own' | 'copy' | 'generated' | 'none'; slots: RawSlot[] }

/** Chords of every section: own / inherited, or generated for intro / bridge / outro (A4). */
export function planSectionChords(sections: ArrSectionInput[], key: KeySig, genre: Genre, sig: TimeSig): FormPlan[] {
  const num = sig.num;
  const own: (RawSlot[] | null)[] = sections.map((s) => (s.chords?.length ? fitSlots(s.chords.map((c) => ({ ...c })), s.bars, num) : null));
  const refIdx = sections.findIndex((s, i) => s.type === 'refren' && own[i]);
  const anyIdx = own.findIndex((x) => !!x);
  const ref = refIdx >= 0 ? own[refIdx]! : anyIdx >= 0 ? own[anyIdx]! : null;
  const refBars = ref ? splitToBars(ref, num) : [];
  const refLen = refBars.length ? Math.max(...refBars.map((s) => s.startBeat + s.beats)) : 0;
  const loop = (bars: number): RawSlot[] => {
    const lp = defaultLoop(key);
    return Array.from({ length: bars }, (_, i) => ({ startBeat: i * num, beats: num, chord: lp[i % lp.length], phraseEnd: i % 4 === 3 || i === bars - 1 }));
  };
  const tail = (bars: number): RawSlot[] => {
    if (!refBars.length) return loop(bars);
    const take = Math.min(bars, Math.round(refLen / num));
    const from = refLen - take * num;
    const part = refBars.filter((s) => s.startBeat >= from - 1e-6).map((s) => ({ ...s, startBeat: s.startBeat - from }));
    return fitSlots(part, bars, num);
  };
  return sections.map((s, i): FormPlan => {
    const mine = own[i];
    if (mine) return { chordSource: s.isCopy ? 'copy' : 'own', slots: mine };
    if (s.type === 'intro') {
      const slots = splitToBars(tail(s.bars), num);
      const last = slots[slots.length - 1];
      if (last && ![0, 7].includes(relOf(last.chord, key))) slots[slots.length - 1] = { ...last, chord: dominantChord(key, SEVENTH_V.includes(genre)) };
      return { chordSource: 'generated', slots };
    }
    if (s.type === 'interlude') {
      // turnaround prior: VI - VII leads back to i (major keys: IV - V leads to I); the rest of a longer interlude rests on the tonic
      const half = num / 2;
      const [a, b] = key.mode === 'major' ? [deg(key, 5, 'maj'), deg(key, 7, 'maj')] : [deg(key, 8, 'maj'), deg(key, 10, 'maj')];
      const slots: RawSlot[] = [];
      for (let k = 0; k < s.bars - 1; k++) slots.push({ startBeat: k * num, beats: num, chord: tonicChord(key), phraseEnd: false });
      const t0 = (s.bars - 1) * num;
      slots.push({ startBeat: t0, beats: half, chord: a, phraseEnd: false }, { startBeat: t0 + half, beats: num - half, chord: b, phraseEnd: true });
      return { chordSource: 'generated', slots };
    }
    if (s.type === 'bridge') {
      const ch = bridgeChords(s.bars, key, genre);
      return {
        chordSource: 'generated',
        slots: ch.map((c, k) => ({ startBeat: k * num, beats: num, chord: c, phraseEnd: k === ch.length - 1 || k % 4 === 3 })),
      };
    }
    if (s.type === 'outro') {
      const slots = splitToBars(tail(s.bars), num);
      const n = slots.length;
      const plagal = genre === 'imn';
      if (n >= 1) slots[n - 1] = { ...slots[n - 1], chord: tonicChord(key), phraseEnd: true };
      if (n >= 2) {
        const pen = plagal ? subdominantChord(key) : dominantChord(key, SEVENTH_V.includes(genre));
        slots[n - 2] = { ...slots[n - 2], chord: pen };
      }
      return { chordSource: 'generated', slots };
    }
    return { chordSource: 'none', slots: [] };
  });
}

export function toPlanned(slots: RawSlot[], bpm: number): PlannedChord[] {
  const beat = 60 / bpm;
  return slots.map((s) => ({ startBeat: s.startBeat, beats: s.beats, startSec: s.startBeat * beat, durSec: s.beats * beat, chord: s.chord, phraseEnd: s.phraseEnd }));
}
