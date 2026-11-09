import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { addNoise, makeMelody, mulberry32, renderVoice, type GtNote } from './synth';
import { analyzeVoice, recommendKey, voiceTypeOf, type VoiceReport } from './voiceReport';
import { readWav } from './wavFixture';
import { existsSync } from 'node:fs';
import type { Note } from '../model/types';

const SR = 44100;
const KEY = { tonic: 0, mode: 'major' as const };

/** the detune renderVoice() applies to every note (same rng sequence) */
function truthDetune(n: number, seed: number, amount: number): number[] {
  const rng = mulberry32(seed * 7919);
  rng();
  return Array.from({ length: n }, () => (rng() * 2 - 1) * amount);
}

describe('X0 voice report: intonation on synthetic takes with known detune', () => {
  for (const [amount, seed] of [[12, 3], [25, 5], [38, 8]] as const) {
    it(`detune +-${amount} cents: mean |error| estimated within 5 cents`, () => {
      const gt = makeMelody(mulberry32(40 + seed), KEY, 90, 40);
      const clean = renderVoice(gt, { sr: SR, vibratoCents: 0, detuneCents: amount, seed });
      const a = analyze(addNoise(clean, gt, SR, 28, 'white', 3), SR, 90);
      const rep = analyzeVoice({ notes: a.notes, analysis: a, bpm: 90 });
      // truth: deviation of every note from the duration-weighted mean offset (the app removes the global offset)
      const d = truthDetune(gt.length, seed, amount);
      const w = gt.map((g) => g.dur);
      const mean = d.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((s, x) => s + x, 0);
      const truth = d.reduce((s, x) => s + Math.abs(x - mean), 0) / d.length;
      console.log(`detune ${amount}: truth ${truth.toFixed(1)} est ${rep.intonation.meanAbsCents.toFixed(1)} cents, in tune ${rep.intonation.withinTolerancePct.toFixed(0)}%`);
      expect(Math.abs(rep.intonation.meanAbsCents - truth)).toBeLessThanOrEqual(5);
    });
  }
  it('a note held consistently flat produces the tip "Ții nota Si puțin jos"', () => {
    const notes: Note[] = [];
    for (let i = 0; i < 8; i++) notes.push({ id: `n${i}`, midi: i % 2 ? 59 : 62, startSec: i, durSec: 0.8, velocity: 0.7, centsDev: i % 2 ? -32 : 3, confidence: 1 });
    const rep = analyzeVoice({ notes, bpm: 60 });
    expect(rep.intonation.flat[0].pc).toBe(11);
    expect(rep.tips.some((t) => t.includes('Ții nota Si puțin jos'))).toBe(true);
  });
});

describe('X0 voice report: timing on synthetic takes with known onset errors', () => {
  for (const [jit, seed] of [[0.02, 1], [0.04, 2], [0.06, 3]] as const) {
    it(`onset jitter +-${jit * 1000} ms: mean abs deviation within 15 ms`, () => {
      const bpm = 100;
      const base = makeMelody(mulberry32(70 + seed), KEY, bpm, 40);
      const rng = mulberry32(900 + seed);
      const gt: GtNote[] = base.map((g) => ({ ...g }));
      const errs: number[] = [];
      for (let i = 0; i < gt.length; i++) {
        const e = (rng() * 2 - 1) * jit;
        errs.push(e);
        gt[i].start += e;
        gt[i].dur -= e;
      }
      const clean = renderVoice(gt, { sr: SR, vibratoCents: 20, seed: 6 });
      const a = analyze(addNoise(clean, gt, SR, 28, 'white', 5), SR, bpm);
      const rep = analyzeVoice({ notes: a.notes, analysis: a, bpm });
      const med = [...errs].sort((x, y) => x - y)[Math.floor(errs.length / 2)];
      const truth = (errs.reduce((s, x) => s + Math.abs(x - med), 0) / errs.length) * 1000;
      console.log(`jitter ${jit * 1000}: truth ${truth.toFixed(1)} ms, est ${rep.timing.meanAbsMs.toFixed(1)} ms`);
      expect(Math.abs(rep.timing.meanAbsMs - truth)).toBeLessThanOrEqual(15);
    });
  }
});

describe('X0 voice report: range, voice type and recommended key', () => {
  const mk = (midis: number[]): Note[] => midis.map((m, i) => ({ id: `n${i}`, midi: m, startSec: i, durSec: 1, velocity: 0.7, centsDev: 0, confidence: 1 }));
  it('voice type follows the tessitura centre', () => {
    expect(voiceTypeOf(46, 40, 52)).toBe('bas');
    expect(voiceTypeOf(52, 45, 60)).toBe('bariton');
    expect(voiceTypeOf(57, 50, 66)).toBe('tenor');
    expect(voiceTypeOf(70, 62, 80)).toBe('sopran');
  });
  it('a tenor whose top note exceeds the voice ceiling is moved down, a bass singing too low is moved up, never beyond +-6', () => {
    const high = analyzeVoice({ notes: mk([55, 56, 57, 58, 59, 60, 58, 57, 56, 59, 60, 74]), bpm: 60 });
    const advHigh = recommendKey(high, { tonic: 0, mode: 'major' });
    expect(advHigh.semitones).toBeLessThan(0);
    const low = analyzeVoice({ notes: mk([38, 40, 41, 43, 45, 43, 41, 40, 38, 40, 43, 45]), bpm: 60 });
    const advLow = recommendKey(low, { tonic: 0, mode: 'major' });
    expect(advLow.semitones).toBeGreaterThan(0);
    for (const adv of [advHigh, advLow]) expect(Math.abs(adv.semitones)).toBeLessThanOrEqual(6);
    expect(advHigh.newKey!.tonic).toBe(((0 + advHigh.semitones) % 12 + 12) % 12);
  });
});

const REAL = 'test-audio/real/strofa-curat.wav';
describe.skipIf(!existsSync(REAL))('X0 on the real fixture strofa-curat.wav (low male voice)', () => {
  it('reports a low male voice, a sensible range and a sensible key', () => {
    const { data, sr } = readWav(REAL);
    const a = analyze(data, sr, 80);
    const rep: VoiceReport = analyzeVoice({ notes: a.notes, analysis: a, bpm: 80 });
    const adv = recommendKey(rep, a.keyEstimate ? { tonic: a.keyEstimate.tonic, mode: a.keyEstimate.mode } : null);
    console.log('REAL', JSON.stringify({ range: rep.range, tess: rep.tessitura, type: rep.voiceType, into: rep.intonation.meanAbsCents.toFixed(1), within: rep.intonation.withinTolerancePct.toFixed(0), timing: rep.timing.meanAbsMs.toFixed(0), vib: rep.stability, adv: { s: adv.semitones, k: adv.newKey }, key: a.keyEstimate && { t: a.keyEstimate.tonic, m: a.keyEstimate.mode } }));
    expect(['bas', 'bariton']).toContain(rep.voiceType);
    expect(rep.range!.lo).toBeGreaterThanOrEqual(36);
    expect(rep.range!.hi).toBeLessThanOrEqual(60);
    expect(Math.abs(adv.semitones)).toBeLessThanOrEqual(3);
    expect(rep.tips.length).toBeGreaterThan(1);
    expect(a.keyEstimate?.tonic).toBe(11);
  });
});
