import { describe, expect, it } from 'vitest';
import { detectPitch, hzToMidi } from './livePitch';

const tone = (hz: number, sr: number, n = 2048, amp = 0.2) => Float32Array.from({ length: n }, (_, i) => amp * (Math.sin((2 * Math.PI * hz * i) / sr) + 0.5 * Math.sin((4 * Math.PI * hz * i) / sr) + 0.25 * Math.sin((6 * Math.PI * hz * i) / sr)));
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('live pitch (YIN)', () => {
  it('finds low male to high female pitches within 5 cents at 44.1 and 48 kHz', () => {
    for (const sr of [44100, 48000]) for (const hz of [82.4, 110, 196, 261.63, 440, 659.3, 880]) {
      const r = detectPitch(tone(hz, sr), sr)!;
      expect(r, `${hz}@${sr}`).not.toBeNull();
      expect(Math.abs(cents(r.hz, hz))).toBeLessThan(5);
    }
  });
  it('is silent on silence and on noise', () => {
    expect(detectPitch(new Float32Array(2048), 48000)).toBeNull();
    let s = 7;
    const noise = Float32Array.from({ length: 2048 }, () => { s = (s * 1664525 + 1013904223) >>> 0; return 0.2 * (s / 4294967296 - 0.5); });
    expect(detectPitch(noise, 48000)).toBeNull();
  });
  it('converts Hz to midi', () => { expect(hzToMidi(440)).toBeCloseTo(69, 9); expect(hzToMidi(261.6256)).toBeCloseTo(60, 3); });
});
