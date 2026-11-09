/** Pure (Tone-free) parts of the synthesized instruments: emotion presets, vowel formants, arpeggiator. */
import type { NoteEv } from './humanize';

export type SynthEmotion =
  | 'trist' | 'romantic' | 'vesel' | 'energic' | 'epic' | 'nostalgic' | 'linistit' | 'dramatic'
  | 'inchinare' | 'lauda' | 'rugaciune' | 'biruinta';

export interface EmotionSynthParams {
  /** 0 dark .. 1 bright (filter cutoff) */
  bright: number;
  /** envelope attack / release in seconds (pads) */
  attack: number;
  release: number;
  /** detune spread in cents (chorus-like width) */
  detune: number;
  /** slow movement (LFO depth 0..1) */
  movement: number;
  /** output level 0..1 */
  level: number;
}

export const EMOTION_SYNTH: Record<SynthEmotion, EmotionSynthParams> = {
  trist: { bright: 0.28, attack: 1.4, release: 2.4, detune: 8, movement: 0.25, level: 0.7 },
  romantic: { bright: 0.45, attack: 0.9, release: 2.0, detune: 10, movement: 0.35, level: 0.75 },
  vesel: { bright: 0.8, attack: 0.15, release: 0.9, detune: 7, movement: 0.2, level: 0.8 },
  energic: { bright: 0.9, attack: 0.05, release: 0.5, detune: 12, movement: 0.15, level: 0.85 },
  epic: { bright: 0.75, attack: 1.1, release: 3.0, detune: 16, movement: 0.5, level: 0.95 },
  nostalgic: { bright: 0.35, attack: 1.0, release: 2.2, detune: 14, movement: 0.4, level: 0.7 },
  linistit: { bright: 0.3, attack: 1.6, release: 2.8, detune: 6, movement: 0.3, level: 0.6 },
  dramatic: { bright: 0.6, attack: 0.7, release: 1.8, detune: 14, movement: 0.6, level: 0.9 },
  inchinare: { bright: 0.42, attack: 1.8, release: 3.2, detune: 10, movement: 0.45, level: 0.75 },
  lauda: { bright: 0.85, attack: 0.12, release: 1.0, detune: 9, movement: 0.2, level: 0.85 },
  rugaciune: { bright: 0.22, attack: 2.2, release: 3.6, detune: 5, movement: 0.2, level: 0.55 },
  biruinta: { bright: 0.88, attack: 0.5, release: 2.6, detune: 15, movement: 0.45, level: 0.95 },
};

export function emotionParams(e: string | undefined): EmotionSynthParams {
  return EMOTION_SYNTH[(e ?? 'inchinare') as SynthEmotion] ?? EMOTION_SYNTH.inchinare;
}

/** Cutoff in Hz from the brightness value (exponential 300 Hz .. 9 kHz). */
export function cutoffHz(bright: number): number { return 300 * Math.pow(30, Math.min(1, Math.max(0, bright))); }

export type Vowel = 'aah' | 'ooh' | 'eeh';
/** Formant centre frequencies (Hz), bandwidth Q and relative gain for three bands, by vowel (adult mixed voice). */
export const VOWEL_FORMANTS: Record<Vowel, { f: [number, number, number]; q: [number, number, number]; g: [number, number, number] }> = {
  aah: { f: [800, 1150, 2900], q: [9, 11, 14], g: [1, 0.5, 0.25] },
  ooh: { f: [450, 800, 2830], q: [8, 10, 14], g: [1, 0.35, 0.12] },
  eeh: { f: [400, 1700, 2600], q: [8, 12, 14], g: [1, 0.45, 0.3] },
};

export type ArpPattern = 'up' | 'down' | 'updown' | 'broken';

/**
 * Arpeggiate chord tones (MIDI, any order) over `steps` sixteenth/eighth slots.
 * Pure and deterministic; the caller picks the grid (stepSec).
 */
export function arpeggiate(chord: readonly number[], pattern: ArpPattern, startSec: number, stepSec: number, steps: number, vel = 0.7, octaves = 1): NoteEv[] {
  const base = [...chord].sort((a, b) => a - b);
  const pool: number[] = [];
  for (let o = 0; o < octaves; o++) for (const n of base) pool.push(n + 12 * o);
  let order: number[] = [];
  switch (pattern) {
    case 'up': order = pool; break;
    case 'down': order = pool.slice().reverse(); break;
    case 'updown': order = [...pool, ...pool.slice(1, -1).reverse()]; break;
    case 'broken': order = pool.map((_, i) => pool[(i * 2) % pool.length]); break;
  }
  if (!order.length) return [];
  return Array.from({ length: steps }, (_, i) => ({
    midi: order[i % order.length], time: startSec + i * stepSec, dur: stepSec * 0.9, vel: Math.min(1, vel * (i % 4 === 0 ? 1 : 0.85)),
  }));
}
