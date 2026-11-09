import { describe, expect, it } from 'vitest';
import { checkPitch } from './pitchcheck';

const SR = 44100;
function tone(f: number, amps: number[], sec = 0.9) {
  const x = new Float32Array(Math.round(SR * sec));
  for (let i = 0; i < x.length; i++) { let v = 0; amps.forEach((a, h) => { v += a * Math.sin(2 * Math.PI * f * (h + 1) * (i / SR)); }); x[i] = v * 0.2; }
  return x;
}
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

describe('pitch check of rendered notes', () => {
  it('measures cents and octave of a harmonic tone', () => {
    const f = hz(60) * Math.pow(2, 12 / 1200);
    const r = checkPitch(tone(f, [1, 0.6, 0.4, 0.3, 0.2, 0.1]), SR, hz(60))!;
    expect(r.octave).toBe(0);
    expect(r.cents).toBeCloseTo(12, 0);
  });
  it('finds a weak or missing fundamental at the right octave', () => {
    const r = checkPitch(tone(hz(40), [0.03, 1, 0.9, 0.6, 0.5, 0.3]), SR, hz(40))!;
    expect(r.octave).toBe(0);
    expect(Math.abs(r.cents)).toBeLessThan(3);
  });
  it('reports an octave error when the sound is an octave too high or low', () => {
    expect(checkPitch(tone(hz(72), [1, 0.5, 0.3, 0.2, 0.1, 0.05]), SR, hz(60))!.octave).toBe(1);
    expect(checkPitch(tone(hz(48), [1, 0.5, 0.3, 0.2, 0.1, 0.05]), SR, hz(60))!.octave).toBe(-1);
  });
  it('returns null for silence', () => { expect(checkPitch(new Float32Array(20000), SR, 440)).toBeNull(); });
});
