import { describe, expect, it } from 'vitest';
import { pulseOffsets, tempoMapFromPulses, warpArrangement, warpTime } from './tempoMap';
import type { Arrangement } from './types';

describe('tempo map', () => {
  const bar = 2.8, t0 = 1;
  // a singer who drifts: the bar grows from 2.8 s to 3.0 s and comes back
  const pulses = (() => { const out: number[] = []; let t = t0; for (let i = 0; i < 120; i++) { out.push(t + (i % 3 === 0 ? 0.012 : -0.01)); t += (bar / 6) * (1 + 0.025 * Math.sin(i / 19)); } return out; })();
  const map = tempoMapFromPulses(pulses, 6, bar, t0, 20);
  it('follows the drift and stays smooth (no jump between neighbouring bars bigger than 90 ms)', () => {
    expect(Math.abs(map[0])).toBeLessThan(0.3);
    expect(Math.max(...map.map((v, k) => (k ? Math.abs(v - map[k - 1] - bar) : 0)))).toBeLessThan(0.09);
    expect(Math.max(...map.map((v, k) => Math.abs(v - k * bar)))).toBeGreaterThan(0.03); // it really moved away from the straight grid
  });
  it('pulses sit much closer to the mapped grid than to the straight one', () => {
    const o = pulseOffsets(pulses, 6, bar, t0, map);
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    expect(med(o.mapped)).toBeLessThan(0.02);
    expect(med(o.mapped)).toBeLessThan(med(o.linear));
  });
  it('warps time piecewise linearly and keeps order', () => {
    const m = [0, 2.9, 5.7, 8.6];
    expect(warpTime(m, 2.8, 2.8)).toBeCloseTo(2.9, 6);
    expect(warpTime(m, 2.8, 4.2)).toBeCloseTo(4.3, 6);
    const arr = { tracks: [{ id: 'a', name: 'a', gm: 0, channel: 0, drums: false, level: 1, pan: 0, reverb: 0, notes: [{ midi: 60, startSec: 2.8, durSec: 1.4, vel: 0.5 }] }], plan: [{ id: 's', type: 'strofa', label: 's', bars: 3, startSec: 0, durSec: 8.4, startBar: 0, energy: 2, chordSource: 'own', chords: [], active: [] }], markers: [], transitions: [], songSec: 8.4, register: { mode: 'above', lo: 0, hi: 0, vocalLo: 0, vocalHi: 0 } } as unknown as Arrangement;
    const w = warpArrangement(arr, m, 2.8);
    expect(w.tracks[0].notes[0].startSec).toBeCloseTo(2.9, 6);
    expect(w.tracks[0].notes[0].durSec).toBeCloseTo(1.4, 6);
    expect(w.songSec).toBeCloseTo(8.6, 6);
  });
});
