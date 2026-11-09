import { describe, expect, it } from 'vitest';
import { detectMeter, type OnsetIn } from './meter';

/** 4/4 at 85 BPM, 8 bars; every bar: long stressed note on beat 1, shorter on 2/3/4. A weak pickup note one beat before bar 1. */
function song(pickupBeats: number): OnsetIn[] {
  const beat = 60 / 85;
  const out: OnsetIn[] = [];
  const t0 = 1.0;
  if (pickupBeats > 0) out.push({ startSec: t0 - pickupBeats * beat, durSec: 0.8 * pickupBeats * beat, midi: 74, velocity: 0.4 });
  const dur = [1.9, 0.9, 1.4, 0.9], vel = [0.95, 0.5, 0.75, 0.5], pit = [67, 65, 70, 69];
  for (let b = 0; b < 8; b++) {
    const bt = t0 + b * 4 * beat;
    // a short breath every 4 bars, as phrases end
    for (let k = 0; k < 4; k++) {
      if (k === 3 && (b % 4 === 3)) continue;
      out.push({ startSec: bt + k * beat, durSec: dur[k] * beat * (k === 0 && b % 2 ? 0.75 : 0.9), midi: pit[k] + (b % 2), velocity: k === 0 && b % 2 ? 0.78 : vel[k], });
    }
  }
  return out;
}

describe('pickup (anacrusis)', () => {
  it('puts the downbeat on the first stressed note and reports the pickup', () => {
    const r = detectMeter({ notes: song(1) })!;
    const o = r.options.find((x) => x.id === '4/4')!; // 4/4 is among the two offered meters
    expect(o).toBeTruthy();
    expect(Math.abs(o.bpm - 85)).toBeLessThanOrEqual(2);
    expect(Math.abs(o.firstDownbeatSec - 1.0)).toBeLessThan(0.08);
    expect(o.pickupSec).toBeGreaterThan(0.5);
    expect(o.pickupSec).toBeLessThan(0.9);
    expect(o.bars).toBe(9); // 8 full bars + the short pickup bar
  });
  it('no pickup when the song starts on the downbeat', () => {
    const o = detectMeter({ notes: song(0) })!.options[0];
    expect(o.pickupSec).toBe(0);
    expect(o.bars).toBe(8);
  });
});
