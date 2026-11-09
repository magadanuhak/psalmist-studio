import { describe, expect, it } from 'vitest';
import { bandLevels, TARGET_CURVE } from '../audio/audit';
import { ACC_EQ_MAX_DB, correctionFor, matchAccEq } from './accEq';

const SR = 44100;
function noiseBands(gainDb: number[]): [Float32Array, Float32Array] {
  // sum of sines at the octave centres with the given gains
  const n = SR * 3; const x = new Float32Array(n);
  [62, 125, 250, 500, 1000, 2000, 4000, 8000].forEach((f, k) => { const a = Math.pow(10, gainDb[k] / 20) * 0.03; for (let i = 0; i < n; i++) x[i] += a * Math.sin(2 * Math.PI * f * 1.003 * (i / SR)); });
  return [x, x.slice()];
}

describe('accompaniment match EQ', () => {
  it('computes limited corrections only where the balance is off by more than 1.5 dB', () => {
    const target = TARGET_CURVE.worship;
    const g = correctionFor([0, 0, 0, -2.5, -5.5, -9, -12, -16].map((v, i) => v + (i === 4 ? 9 : 0)), target);
    expect(g[4]).toBeLessThan(-3);
    expect(g[4]).toBeGreaterThanOrEqual(-ACC_EQ_MAX_DB);
    expect(g[1]).toBe(0);
    expect(g.every((v) => Math.abs(v) <= ACC_EQ_MAX_DB)).toBe(true);
  });
  it('pulls a boomy / nasal mix toward the target and never boosts beyond the limit', () => {
    const target = TARGET_CURVE.cantare;
    const [l, r] = noiseBands([0, 0, 0, 8, 12, 4, -6, -14]);
    const before = bandLevels([l, r], SR);
    const out = matchAccEq(l, r, SR, target);
    const after = bandLevels([out.l, out.r], SR);
    const dev = (lv: number[]) => { const ref = (lv[1] + lv[2] + lv[3]) / 3; return lv.map((v, i) => v - ref - target[i]); };
    const sum = (d: number[]) => d.reduce((s, v) => s + Math.abs(v), 0);
    expect(sum(dev(after))).toBeLessThan(sum(dev(before)));
    expect(out.gains.every((v) => Math.abs(v) <= ACC_EQ_MAX_DB + 1e-4)).toBe(true);
  });
});
