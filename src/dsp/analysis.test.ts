import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { addNoise, makeMelody, mulberry32, renderVoice, type GtNote } from './synth';
import type { KeySig } from '../model/types';

const SR = 44100;

interface Case { key: KeySig; bpm: number; harmonic?: boolean; noise: 'white' | 'pink'; vib: number; vibHz: number }
const CASES: Case[] = [
  { key: { tonic: 0, mode: 'major' }, bpm: 90, noise: 'white', vib: 35, vibHz: 5.5 },
  { key: { tonic: 7, mode: 'major' }, bpm: 120, noise: 'pink', vib: 45, vibHz: 6 },
  { key: { tonic: 2, mode: 'major' }, bpm: 70, noise: 'white', vib: 30, vibHz: 4.5 },
  { key: { tonic: 9, mode: 'minor' }, bpm: 100, noise: 'white', vib: 40, vibHz: 5 },
  { key: { tonic: 4, mode: 'minor' }, bpm: 140, noise: 'pink', vib: 35, vibHz: 6.5 },
  { key: { tonic: 2, mode: 'minor' }, bpm: 80, harmonic: true, noise: 'white', vib: 40, vibHz: 5.5 },
  { key: { tonic: 11, mode: 'minor' }, bpm: 110, harmonic: true, noise: 'pink', vib: 30, vibHz: 7 },
  { key: { tonic: 5, mode: 'major' }, bpm: 130, noise: 'white', vib: 50, vibHz: 5.5 },
  { key: { tonic: 10, mode: 'major' }, bpm: 75, noise: 'pink', vib: 40, vibHz: 5 },
  { key: { tonic: 6, mode: 'minor' }, bpm: 95, noise: 'white', vib: 35, vibHz: 5 },
];

function score(gt: GtNote[], det: { midi: number; startSec: number }[]) {
  let ok = 0;
  for (const g of gt) {
    if (det.some((d) => d.midi === g.midi && Math.abs(d.startSec - g.start) <= 0.05)) ok++;
  }
  return ok;
}

describe('analysis on synthetic voice-like melodies (20 dB SNR)', () => {
  const results: { ok: number; total: number; keyOk: boolean; ms: number; extra: number }[] = [];
  CASES.forEach((c, i) => {
    it(`melody ${i + 1}: key ${c.key.tonic}${c.key.mode} @${c.bpm}bpm`, () => {
      const rng = mulberry32(100 + i);
      const gt = makeMelody(rng, c.key, c.bpm, 22, c.harmonic);
      const clean = renderVoice(gt, { sr: SR, vibratoCents: c.vib, vibratoHz: c.vibHz, seed: i + 1, detuneCents: 25, scoopCents: 70, glideSec: 0.08 });
      const noisy = addNoise(clean, gt, SR, 20, c.noise, 500 + i);
      const t0 = performance.now();
      const a = analyze(noisy, SR, c.bpm);
      const ms = performance.now() - t0;
      const ok = score(gt, a.notes);
      const k = a.keyEstimate;
      // relative major/minor spelled differently still has to match exactly per spec
      const keyOk = !!k && k.tonic === c.key.tonic && k.mode === c.key.mode;
      results.push({ ok, total: gt.length, keyOk, ms, extra: a.notes.length - gt.length });
      console.log(`m${i + 1}: notes ${ok}/${gt.length} det=${a.notes.length} key=${k?.tonic}${k?.mode} want=${c.key.tonic}${c.key.mode} ${keyOk ? 'OK' : 'MISS'} ${ms.toFixed(0)}ms`);
      expect(ok / gt.length).toBeGreaterThan(0.75);
    });
  });
  it('aggregate thresholds: >=95% notes, >=85% keys', () => {
    const ok = results.reduce((s, r) => s + r.ok, 0);
    const total = results.reduce((s, r) => s + r.total, 0);
    const keys = results.filter((r) => r.keyOk).length / results.length;
    console.log(`AGGREGATE notes ${(100 * ok / total).toFixed(1)}%  keys ${(keys * 100).toFixed(0)}%`);
    expect(ok / total).toBeGreaterThanOrEqual(0.95);
    expect(keys).toBeGreaterThanOrEqual(0.85);
  });
  it('analyzes 60 s of audio in < 3 s', () => {
    const rng = mulberry32(777);
    const key: KeySig = { tonic: 0, mode: 'major' };
    const gt = makeMelody(rng, key, 100, 60);
    const clean = renderVoice(gt, { sr: SR, seed: 9 });
    const noisy = addNoise(clean, gt, SR, 20, 'white', 5);
    const t0 = performance.now();
    analyze(noisy, SR, 100);
    const ms = performance.now() - t0;
    console.log(`60s analysis: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(3000);
  });
});
