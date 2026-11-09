import type { KeySig } from '../../model/types';
import type { Chord, ChordQuality, Func } from './types';

export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6],
  dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], hdim7: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
  sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 2, 4, 7],
};
const SUFFIX: Record<ChordQuality, string> = {
  maj: '', min: 'm', dim: 'dim', dom7: '7', maj7: 'maj7', min7: 'm7', hdim7: 'm7b5', dim7: 'dim7', sus2: 'sus2', sus4: 'sus4', add9: 'add9',
};
export const isMinorish = (q: ChordQuality) => q === 'min' || q === 'dim' || q === 'min7' || q === 'hdim7' || q === 'dim7';
export const hasSeventh = (q: ChordQuality) => q === 'dom7' || q === 'maj7' || q === 'min7' || q === 'hdim7' || q === 'dim7';

export const chordPcs = (c: Pick<Chord, 'root' | 'quality'>): number[] =>
  QUALITY_INTERVALS[c.quality].map((i) => (c.root + i) % 12);

/** Interval (semitones above root) of each role: root, third, fifth, seventh. */
export function chordRoles(c: Pick<Chord, 'root' | 'quality'>) {
  const iv = QUALITY_INTERVALS[c.quality];
  const third = iv.find((i) => i === 3 || i === 4 || i === 2 || i === 5);
  const fifth = iv.find((i) => i === 7 || i === 6);
  const seventh = iv.find((i) => i === 9 || i === 10 || i === 11);
  return {
    root: c.root,
    third: third !== undefined ? (c.root + third) % 12 : null,
    fifth: fifth !== undefined ? (c.root + fifth) % 12 : null,
    seventh: seventh !== undefined ? (c.root + seventh) % 12 : null,
  };
}

export type ChordNaming = 'letter' | 'ro';
const L_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const L_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const R_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const R_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];

export function prefersFlats(key: KeySig | null): boolean {
  if (!key) return false;
  const majorFlats = [5, 10, 3, 8, 1];
  const minorFlats = [2, 7, 0, 5, 10, 3];
  return (key.mode === 'major' ? majorFlats : minorFlats).includes(key.tonic);
}

export function pcLabel(pc: number, naming: ChordNaming, flats: boolean): string {
  const i = ((pc % 12) + 12) % 12;
  return (naming === 'letter' ? (flats ? L_FLAT : L_SHARP) : flats ? R_FLAT : R_SHARP)[i];
}

/** Chord symbol. Romanian style: major "Do", minor lowercase + m ("lam", "mim"). */
export function chordName(c: Pick<Chord, 'root' | 'quality'>, naming: ChordNaming, key: KeySig | null, bassPc?: number): string {
  const flats = prefersFlats(key);
  let root = pcLabel(c.root, naming, flats);
  let suffix = SUFFIX[c.quality];
  if (naming === 'ro' && (c.quality === 'min' || c.quality === 'min7' || c.quality === 'hdim7')) {
    root = root.charAt(0).toLowerCase() + root.slice(1);
    suffix = c.quality === 'min' ? 'm' : c.quality === 'min7' ? 'm7' : 'm7b5';
  }
  const bass = bassPc !== undefined && bassPc !== c.root ? `/${spellBass(c, bassPc, naming, flats)}` : '';
  return `${root}${suffix}${bass}`;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SOLFEGE_OF: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

/** Bass note of a slash chord spelled by interval (C#/E#, not C#/F): third = 2 letters up, fifth = 4, seventh = 6. */
function spellBass(c: Pick<Chord, 'root' | 'quality'>, bassPc: number, naming: ChordNaming, flats: boolean): string {
  const roles = chordRoles(c);
  const steps = bassPc === roles.third ? 2 : bassPc === roles.fifth ? 4 : bassPc === roles.seventh ? 6 : -1;
  if (steps < 0) return pcLabel(bassPc, naming, flats);
  const rootName = pcLabel(c.root, 'letter', flats);
  const li = LETTERS.indexOf(rootName[0]);
  if (li < 0) return pcLabel(bassPc, naming, flats);
  const letter = LETTERS[(li + steps) % 7];
  const diff = (((bassPc - LETTER_PC[(li + steps) % 7]) % 12) + 12) % 12;
  const acc = diff === 0 ? '' : diff === 1 ? '#' : diff === 2 ? '##' : diff === 11 ? 'b' : diff === 10 ? 'bb' : null;
  if (acc === null) return pcLabel(bassPc, naming, flats);
  return (naming === 'ro' ? SOLFEGE_OF[letter] : letter) + acc;
}

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
export function romanOf(root: number, quality: ChordQuality, key: KeySig, target?: number): string {
  const rel = (((root - key.tonic) % 12) + 12) % 12;
  let r = ROMAN[rel];
  if (isMinorish(quality)) r = r.replace(/[IVX]+/, (m) => m.toLowerCase());
  if (quality === 'dim' || quality === 'dim7') r += '°';
  if (quality === 'hdim7') r += 'ø7';
  else if (quality === 'dom7' || quality === 'min7') r += '7';
  else if (quality === 'maj7') r += 'maj7';
  else if (quality === 'sus2' || quality === 'sus4' || quality === 'add9') r += quality;
  if (target !== undefined) {
    const trel = (((target - key.tonic) % 12) + 12) % 12;
    let t = ROMAN[trel];
    const minorTarget = key.mode === 'major' ? [2, 4, 9].includes(trel) : [0, 5].includes(trel);
    if (minorTarget) t = t.toLowerCase();
    return `${quality === 'dom7' ? 'V7' : 'V'}/${t}`;
  }
  return r;
}

export function funcOf(root: number, quality: ChordQuality, key: KeySig, secondary: boolean): Func {
  if (secondary) return 'D';
  const rel = (((root - key.tonic) % 12) + 12) % 12;
  if (key.mode === 'major') {
    if ([0, 9, 4].includes(rel)) return 'T';
    if ([7, 11].includes(rel)) return 'D';
    return 'S';
  }
  if ([0, 3].includes(rel)) return 'T';
  if ([7, 11, 10].includes(rel)) return rel === 10 && quality === 'maj' ? 'S' : 'D';
  return 'S';
}

export interface Cand {
  chord: Chord;
  rel: number;                  // root relative to tonic
  tier: 'A' | 'B' | 'C';        // lowest variant it appears in
  kind: 'diatonic' | 'colour' | 'seventh' | 'borrowed' | 'secondary';
  /** secondary dominant: relative root it resolves to */
  target?: number;
}

function mk(key: KeySig, rel: number, quality: ChordQuality, tier: Cand['tier'], kind: Cand['kind'], target?: number): Cand {
  const root = (key.tonic + rel) % 12;
  const targetPc = target !== undefined ? (key.tonic + target) % 12 : undefined;
  return {
    chord: { root, quality, roman: romanOf(root, quality, key, targetPc), func: funcOf(root, quality, key, target !== undefined) },
    rel, tier, kind, target,
  };
}

/** Full candidate pool for a key (variants filter by tier/kind). */
export function candidatePool(key: KeySig): Cand[] {
  const k = key;
  const c: Cand[] = [];
  if (k.mode === 'major') {
    const tri: [number, ChordQuality][] = [[0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min']];
    for (const [r, q] of tri) c.push(mk(k, r, q, 'A', 'diatonic'));
    c.push(mk(k, 11, 'dim', 'C', 'diatonic'));
    const sev: [number, ChordQuality][] = [[0, 'maj7'], [2, 'min7'], [4, 'min7'], [5, 'maj7'], [7, 'dom7'], [9, 'min7'], [11, 'hdim7']];
    for (const [r, q] of sev) c.push(mk(k, r, q, r === 7 ? 'B' : 'C', 'seventh'));
    for (const [r, q] of [[0, 'sus2'], [0, 'add9'], [5, 'sus2'], [5, 'add9'], [7, 'sus4'], [0, 'sus4']] as [number, ChordQuality][]) c.push(mk(k, r, q, 'B', 'colour'));
    c.push(mk(k, 5, 'min', 'B', 'borrowed'), mk(k, 8, 'maj', 'B', 'borrowed'), mk(k, 10, 'maj', 'B', 'borrowed'));
    c.push(mk(k, 2, 'maj', 'C', 'secondary', 7), mk(k, 2, 'dom7', 'C', 'secondary', 7), mk(k, 4, 'dom7', 'C', 'secondary', 9),
      mk(k, 0, 'dom7', 'C', 'secondary', 5), mk(k, 9, 'dom7', 'C', 'secondary', 2));
  } else {
    const tri: [number, ChordQuality][] = [[0, 'min'], [3, 'maj'], [5, 'min'], [7, 'maj'], [8, 'maj'], [10, 'maj'], [7, 'min']];
    for (const [r, q] of tri) c.push(mk(k, r, q, 'A', 'diatonic'));
    c.push(mk(k, 2, 'dim', 'C', 'diatonic'), mk(k, 11, 'dim', 'C', 'diatonic'));
    const sev: [number, ChordQuality][] = [[0, 'min7'], [2, 'hdim7'], [3, 'maj7'], [5, 'min7'], [7, 'dom7'], [8, 'maj7'], [11, 'dim7']];
    for (const [r, q] of sev) c.push(mk(k, r, q, r === 7 ? 'B' : 'C', 'seventh'));
    for (const [r, q] of [[0, 'sus2'], [0, 'sus4'], [7, 'sus4'], [5, 'sus2']] as [number, ChordQuality][]) c.push(mk(k, r, q, 'B', 'colour'));
    c.push(mk(k, 5, 'maj', 'B', 'borrowed'));
    c.push(mk(k, 0, 'dom7', 'C', 'secondary', 5), mk(k, 2, 'maj', 'C', 'secondary', 7), mk(k, 2, 'dom7', 'C', 'secondary', 7),
      mk(k, 10, 'dom7', 'C', 'secondary', 3), mk(k, 3, 'dom7', 'C', 'secondary', 8));
  }
  return c;
}

/** Build a Cand for any chord (user pick / lock outside the pool). */
export function candFromChord(chord: Pick<Chord, 'root' | 'quality'>, key: KeySig): Cand {
  const rel = (((chord.root - key.tonic) % 12) + 12) % 12;
  const hit = candidatePool(key).find((x) => x.chord.root === chord.root && x.chord.quality === chord.quality);
  if (hit) return hit;
  return mk(key, rel, chord.quality, 'C', 'borrowed');
}
