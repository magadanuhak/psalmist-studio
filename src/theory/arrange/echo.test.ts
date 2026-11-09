import { describe, expect, it } from 'vitest';
import { buildEchoes, contourSimilarity, intervalMatch, phraseEnds, quoteHook } from './echo';
import type { ArrVocalNote } from './types';

const beat = 0.6, bar = 2.4;
const key = { tonic: 0, mode: 'major' as const };
// two 4-note phrases separated by pauses of 1.5 bars
const phrase = (t0: number, midis: number[]): ArrVocalNote[] => midis.map((m, i) => ({ midi: m, startSec: t0 + i * beat, durSec: beat * 0.9 }));
const vocal = [...phrase(0, [64, 67, 65, 62]), ...phrase(2.4 + 3.6, [64, 65, 67, 64]), ...phrase(2 * (2.4 + 3.6), [60, 62, 64, 62]), ...phrase(3 * (2.4 + 3.6), [67, 65, 64, 62])];

describe('answers are echoes, not free lines', () => {
  it('finds phrase ends only at pauses of at least one bar', () => {
    const pe = phraseEnds(vocal, bar);
    expect(pe.length).toBe(3);
    expect(pe.every((p) => p.pauseDur >= bar)).toBe(true);
  });
  it('one echo per phrase pair, inside the pause, softer, contour similar to the source phrase (>= 0.8)', () => {
    const { notes, sources } = buildEchoes(vocal, { key, barSec: bar, beatSec: beat, vocalHi: 70, level: 0.63 });
    expect(sources.length).toBe(2); // 3 pauses -> pauses 1 and 3
    const pe = phraseEnds(vocal, bar);
    let at = 0;
    sources.forEach((src, k) => {
      const mine = notes.slice(at, at + src.length).map((n) => n.midi); at += src.length;
      expect(contourSimilarity(mine, src)).toBeGreaterThanOrEqual(0.8);
      const first = notes[at - src.length];
      expect(first.startSec).toBeGreaterThanOrEqual(pe[k * 2].pauseStart);
      expect(first.startSec + 0.2).toBeLessThan(pe[k * 2].pauseStart + pe[k * 2].pauseDur);
    });
    expect(Math.max(...notes.map((n) => n.vel))).toBeLessThanOrEqual(0.4);
    expect(notes.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(((n.midi % 12) + 12) % 12))).toBe(true);
  });
  it('the intro hook quotes the refren: interval match >= 90%', () => {
    const refren = phrase(0, [67, 69, 67, 64, 62, 64]);
    const q = quoteHook(refren, { startSec: 0, durSec: 9.6 }, bar, 12, 1);
    expect(intervalMatch(q.map((n) => n.midi), refren.map((n) => n.midi))).toBeGreaterThanOrEqual(0.9);
    expect(q[q.length - 1].startSec + q[q.length - 1].durSec).toBeLessThanOrEqual(9.6);
  });
});
