import type { EmotionId, GenreId } from './types';

export interface Rng {
  next(): number;
  int(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(arr: T[]): T;
}
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 */
export function makeRng(seed: number | string): Rng {
  let a = hashSeed(seed) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (x, y) => x + Math.floor(next() * (y - x + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

export interface InstrumentRange { name: string; low: number; high: number }
/** Practical sounding ranges (MIDI) per GM program. */
export const INSTRUMENT_RANGES: Record<number, InstrumentRange> = {
  0: { name: 'Acoustic Grand Piano', low: 36, high: 96 },
  4: { name: 'Electric Piano 1', low: 36, high: 96 },
  19: { name: 'Church Organ', low: 36, high: 96 },
  21: { name: 'Accordion', low: 53, high: 89 },
  24: { name: 'Nylon Guitar', low: 40, high: 88 },
  27: { name: 'Clean Electric Guitar', low: 40, high: 88 },
  29: { name: 'Overdriven Guitar', low: 40, high: 88 },
  40: { name: 'Violin', low: 55, high: 100 },
  41: { name: 'Viola', low: 48, high: 84 },
  42: { name: 'Cello', low: 36, high: 76 },
  48: { name: 'String Ensemble', low: 36, high: 96 },
  61: { name: 'Brass Section', low: 40, high: 82 },
  68: { name: 'Oboe', low: 58, high: 91 },
  71: { name: 'Clarinet', low: 50, high: 91 },
  73: { name: 'Flute', low: 60, high: 96 },
  75: { name: 'Pan Flute (nai)', low: 60, high: 96 },
};
export function rangeOf(gm: number): InstrumentRange {
  return INSTRUMENT_RANGES[gm] ?? { name: `GM ${gm}`, low: 36, high: 96 };
}

export interface GenreProfile {
  leadPrograms: number[];
  answerPrograms: number[];
  counterPrograms: number[];
  /** only held phrase-end notes in pauses */
  minimalAnswers: boolean;
  density: number;
  maxAnswerNotes: number;
  /** 0..1: ornament (mordent/trill) tendency */
  ornament: number;
  /** ornaments use the harmonic-minor scale in minor keys */
  harmonicMinorOrnaments: boolean;
  counterMinEnergy: number;
}
export const GENRES: Record<GenreId, GenreProfile> = {
  worship: { leadPrograms: [27, 0], answerPrograms: [0, 27], counterPrograms: [48, 42], minimalAnswers: false, density: 1, maxAnswerNotes: 5, ornament: 0.12, harmonicMinorOrnaments: false, counterMinEnergy: 4 },
  imn: { leadPrograms: [19], answerPrograms: [19], counterPrograms: [48, 19], minimalAnswers: true, density: 0.6, maxAnswerNotes: 1, ornament: 0, harmonicMinorOrnaments: false, counterMinEnergy: 4 },
  cantare: { leadPrograms: [73, 24], answerPrograms: [24, 0], counterPrograms: [48, 41], minimalAnswers: false, density: 0.9, maxAnswerNotes: 4, ornament: 0.15, harmonicMinorOrnaments: false, counterMinEnergy: 4 },
  pop: { leadPrograms: [4, 73], answerPrograms: [4, 0], counterPrograms: [48, 71], minimalAnswers: false, density: 1.1, maxAnswerNotes: 5, ornament: 0.1, harmonicMinorOrnaments: false, counterMinEnergy: 4 },
  rock: { leadPrograms: [29], answerPrograms: [29, 27], counterPrograms: [61, 48], minimalAnswers: false, density: 1.2, maxAnswerNotes: 6, ornament: 0.05, harmonicMinorOrnaments: false, counterMinEnergy: 4 },
  popular: { leadPrograms: [40, 75, 21], answerPrograms: [40, 75, 21], counterPrograms: [21, 71, 48], minimalAnswers: false, density: 1.15, maxAnswerNotes: 6, ornament: 1, harmonicMinorOrnaments: true, counterMinEnergy: 4 },
};

export interface EmotionProfile {
  /** note-density multiplier */
  density: number;
  /** register shift in semitones (small, applied to targets/centres) */
  register: number;
  /** 0..1 ornament amount */
  ornament: number;
  /** note-length factor 0.5..1 (1 = legato) */
  articulation: number;
  /** base MIDI velocity */
  velocity: number;
}
export const EMOTIONS: Record<EmotionId, EmotionProfile> = {
  trist: { density: 0.75, register: -2, ornament: 0.25, articulation: 0.95, velocity: 62 },
  romantic: { density: 0.9, register: 1, ornament: 0.35, articulation: 0.92, velocity: 68 },
  vesel: { density: 1.15, register: 2, ornament: 0.3, articulation: 0.7, velocity: 80 },
  energic: { density: 1.3, register: 2, ornament: 0.2, articulation: 0.6, velocity: 92 },
  epic: { density: 1.1, register: 1, ornament: 0.2, articulation: 0.85, velocity: 94 },
  nostalgic: { density: 0.8, register: 0, ornament: 0.4, articulation: 0.92, velocity: 64 },
  linistit: { density: 0.6, register: -1, ornament: 0.15, articulation: 1, velocity: 56 },
  dramatic: { density: 1, register: 0, ornament: 0.3, articulation: 0.8, velocity: 90 },
  inchinare: { density: 0.7, register: 0, ornament: 0.2, articulation: 1, velocity: 60 },
  lauda: { density: 1.2, register: 2, ornament: 0.25, articulation: 0.7, velocity: 86 },
  rugaciune: { density: 0.55, register: -1, ornament: 0.1, articulation: 1, velocity: 54 },
  biruinta: { density: 1.25, register: 2, ornament: 0.2, articulation: 0.75, velocity: 94 },
};

/** energy 1..5 -> density multiplier */
export const ENERGY_DENSITY = [0.5, 0.75, 1, 1.3, 1.6];
