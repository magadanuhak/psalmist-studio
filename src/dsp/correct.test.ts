import { describe, expect, it } from 'vitest';
import { correctNotes, cleanupNotes } from './correct';
import { DEFAULT_CORRECTION, type Note } from '../model/types';
import { TIME_SIGS, gridSec } from '../music/timesig';

const sig = TIME_SIGS[0].sig;
const mk = (midi: number, startSec: number, durSec: number, centsDev = 0): Note => ({
  id: `${midi}-${startSec}`, midi, startSec, durSec, velocity: 0.8, centsDev, confidence: 0.9,
});

describe('correction', () => {
  const key = { tonic: 0, mode: 'major' as const };
  it('snaps out-of-scale short notes to key, keeps held chromatic notes (flagged)', () => {
    const out = correctNotes(
      [mk(61, 0, 0.3, 10), mk(63, 1, 1.0, 5), mk(60, 2, 0.5)],
      key, 120, sig, { ...DEFAULT_CORRECTION, quantizeStrength: 0 },
    );
    expect(out[0].midi % 12).not.toBe(1);
    expect(out[1].midi).toBe(63);
    expect(out[1].isChromaticIntent).toBe(true);
  });
  it('quantizes to grid at 100%', () => {
    const g = gridSec(100, sig, '1/8');
    const out = correctNotes([mk(60, 0.07, 0.55), mk(62, 0.68, 0.5)], key, 100, sig, { ...DEFAULT_CORRECTION, quantizeStrength: 100, grid: '1/8', cleanup: false });
    for (const n of out) expect(Math.abs(n.startSec / g - Math.round(n.startSec / g))).toBeLessThan(1e-6);
  });
  it('cleanup deletes <60 ms and merges fragments', () => {
    const out = cleanupNotes([mk(60, 0, 0.4), mk(60, 0.42, 0.4), mk(62, 1, 0.03)]);
    expect(out).toHaveLength(1);
    expect(out[0].durSec).toBeCloseTo(0.82, 2);
  });
  it('does not mutate the original notes', () => {
    const src = [mk(61, 0.07, 0.3, 10)];
    correctNotes(src, key, 100, sig, DEFAULT_CORRECTION);
    expect(src[0].midi).toBe(61);
    expect(src[0].startSec).toBe(0.07);
  });
});
