import { describe, expect, it } from 'vitest';
import { alignCapture, placeSegment } from './align';

describe('X0 final recording stays aligned (+-10 ms after latency compensation)', () => {
  it('loopback simulation: clicks sung at known song times land within 10 ms, for several latencies', () => {
    const sr = 48000;
    for (const latency of [0, 37, 112, 180]) {
      const clicks = [1.0, 2.5, 4.0, 7.25];
      const from = -2; // one count-in bar before the song start
      const engineT0 = 10.35, capT0 = 10.1; // capture started 250 ms before the minus
      const data = new Float32Array(sr * 12);
      for (const s of clicks) { const jitter = (Math.random() - 0.5) * 0.004; data[Math.round((engineT0 + (s - from) - capT0 + latency / 1000 + jitter) * sr)] = 1; }
      const out = alignCapture({ data, t0: capT0, sr }, { engineT0, from, latencyMs: latency, songStart: 0, songEnd: 9 });
      const found: number[] = [];
      out.forEach((v, i) => { if (v > 0.5) found.push(i / sr); });
      expect(found.length).toBe(clicks.length);
      found.forEach((f, i) => expect(Math.abs(f - clicks[i])).toBeLessThanOrEqual(0.01));
    }
  });
  it('punch-in segments land at their song time in the take', () => {
    const sr = 1000, take = new Float32Array(10 * sr);
    placeSegment(take, sr, 4, Float32Array.from([1, 2, 3]));
    expect(take[4000]).toBe(1); expect(take[4002]).toBe(3); expect(take[3999]).toBe(0);
  });
});
