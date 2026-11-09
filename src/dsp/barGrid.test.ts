import { describe, expect, it } from 'vitest';
import { fitBarGrid } from './formFromVocal';
import type { OnsetIn } from './meter';

const BAR = 2.824, BEAT = BAR / 4;

/** a sung song: long stressed note on every downbeat, shorter ones on beats 3 / 4 and 2; phrases of 4 bars separated by a breath */
function song(t0: number, bars: number, entryBeat: number, pickup = false): OnsetIn[] {
  const out: OnsetIn[] = [];
  for (let b = 0; b < bars; b++) {
    const bt = t0 + b * BAR;
    const phraseStart = b % 4 === 0;
    out.push({ startSec: bt + 0.0, durSec: 1.6 * BEAT, midi: 67 + (b % 3), velocity: 0.9 });
    out.push({ startSec: bt + 2 * BEAT, durSec: 1.0 * BEAT, midi: 70, velocity: 0.6 });
    out.push({ startSec: bt + 3 * BEAT, durSec: 0.7 * BEAT, midi: 69, velocity: 0.5 });
    if (!(b % 4 === 3)) out.push({ startSec: bt + BEAT, durSec: 0.6 * BEAT, midi: 65, velocity: 0.5 });
    if (phraseStart && pickup) out.push({ startSec: bt - 0.5 * BEAT, durSec: 0.4 * BEAT, midi: 62, velocity: 0.5 });
  }
  // the singer enters on `entryBeat` of the first bar (the earlier notes are simply not sung)
  return out.filter((n) => n.startSec >= t0 + entryBeat * BEAT - 0.05);
}

describe('global bar grid', () => {
  const cases: [string, number, number, boolean][] = [['starts on the downbeat', 0, 0, false], ['enters on beat 2', 0, 1, false], ['enters on beat 3', 0, 2, false], ['with pickups', 0, 0, true]];
  for (const [name, , entry, pk] of cases) {
    it(name, () => {
      const t0 = 24.4;
      const g = fitBarGrid(song(t0, 24, entry, pk), BAR * 1.02, 4)!;
      expect(Math.abs(g.barSec - BAR) / BAR).toBeLessThan(0.006);
      const d = (((g.t0 - t0) % g.barSec) + g.barSec * 1.5) % g.barSec - g.barSec / 2;
      expect(Math.abs(d)).toBeLessThan(0.12);
    });
  }
});
