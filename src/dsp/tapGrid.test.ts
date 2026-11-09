import { describe, expect, it } from 'vitest';
import { gridFromBars, gridFromTaps } from './tapGrid';

describe('tap grid', () => {
  it('fits bar times with jitter', () => {
    const bars = Array.from({ length: 30 }, (_, k) => 24.4 + k * 2.824 + (k % 2 ? 0.03 : -0.03));
    const g = gridFromBars(bars, 4)!;
    expect(g.barSec).toBeCloseTo(2.824, 2);
    expect(((24.4 - g.t0) / g.barSec) % 1).toBeCloseTo(0, 1);
    expect(g.bpm).toBeCloseTo(85, 0);
  });
  it('uses the taps marked "1" when there are at least 3', () => {
    const taps = Array.from({ length: 12 }, (_, i) => ({ t: 1 + i * 0.7, down: i % 4 === 0 }));
    const g = gridFromTaps(taps, 4)!;
    expect(g.barSec).toBeCloseTo(2.8, 2);
    expect(g.t0).toBeCloseTo(1, 2);
  });
  it('falls back to beat taps and ignores a stumble', () => {
    const taps = Array.from({ length: 16 }, (_, i) => ({ t: 0.5 + i * 0.6 + (i === 7 ? 0.2 : 0), down: i === 0 }));
    const g = gridFromTaps(taps, 4)!;
    expect(g.beatSec).toBeCloseTo(0.6, 1);
    expect(g.t0).toBeCloseTo(0.5, 1);
    expect(gridFromTaps([{ t: 1 }, { t: 2 }], 4)).toBeNull();
  });
});
