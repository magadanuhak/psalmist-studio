import { describe, expect, it } from 'vitest';
import { barsFromDownbeats, fillDownbeats, tempoMapFromBars } from './beatMap';

describe('piecewise tempo map from downbeats', () => {
  // a drifting song: half-bar 1.40 s, then 1.34 s; two downbeats missing; one spurious
  const real: number[] = []; let t = 3; for (let i = 0; i < 40; i++) { real.push(t); t += i < 20 ? 1.4 : 1.34; }
  const seen = real.filter((_, i) => i !== 7 && i !== 8 && i !== 25);
  seen.push(real[12] + 0.3);
  it('fills missed downbeats by interpolation and drops spurious ones', () => {
    const f = fillDownbeats(seen);
    expect(f.length).toBe(40);
    f.forEach((x, i) => expect(Math.abs(x - real[i])).toBeLessThan(0.08));
  });
  it('bars follow the drift (a linear fit would not): bar lengths 2.8 s then 2.68 s', () => {
    const bars = barsFromDownbeats(seen, 2, 0);
    const len = bars.slice(1).map((x, i) => x - bars[i]);
    expect(len[2]).toBeCloseTo(2.8, 1);
    expect(len[len.length - 2]).toBeCloseTo(2.68, 1);
  });
  it('project-time map starts at 0', () => {
    const { map, t0 } = tempoMapFromBars(barsFromDownbeats(seen, 2, 0), 10);
    expect(map[0]).toBe(0); expect(t0).toBeCloseTo(3, 1); expect(map.length).toBe(11);
  });
});
