import type { KeySig, Mode } from '../model/types';

export const hzToMidiF = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export const LETTER_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SOLFEGE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export type NameStyle = 'solfege' | 'letter';
export const pcName = (pc: number, style: NameStyle = 'solfege') =>
  (style === 'solfege' ? SOLFEGE_NAMES : LETTER_NAMES)[((pc % 12) + 12) % 12];
export const midiName = (m: number, style: NameStyle = 'solfege') =>
  `${pcName(m, style)}${Math.floor(m / 12) - 1}`;

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

/** Pitch classes allowed for snapping. Minor includes raised 7th (harmonic minor). */
export function scalePcs(key: KeySig): Set<number> {
  const base = key.mode === 'major' ? MAJOR_SCALE : [...MINOR_SCALE, 11];
  return new Set(base.map((i) => (i + key.tonic) % 12));
}

export function keyName(key: KeySig, style: NameStyle = 'solfege'): string {
  return `${pcName(key.tonic, style)} ${key.mode === 'major' ? 'major' : 'minor'}`;
}
export const modeLabel = (m: Mode) => (m === 'major' ? 'major' : 'minor');

/** Degree label within key (1..7 with accidentals) or null when out of scale. */
export function scaleDegree(midi: number, key: KeySig): number | null {
  const rel = (((midi - key.tonic) % 12) + 12) % 12;
  const sc = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const i = sc.indexOf(rel);
  return i >= 0 ? i + 1 : null;
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
