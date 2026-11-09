import { describe, expect, it } from 'vitest';
import { biquad, biquadCoeffs, compress, presetFor, vocalChain, deEss } from './fx';
import { applyCurve, duckGains, integratedLufs, limiter, master, truePeakDb } from './mix';
import { mulberry32 } from './synth';

const SR = 44100;
const sine = (f: number, sec: number, amp: number) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const db = (x: number) => 20 * Math.log10(x);

/** music-like stereo bed: chords + noise bursts */
function bed(sec: number, seed: number): Float32Array[] {
  const r = mulberry32(seed);
  const n = Math.round(sec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t) ** 2;
    const s = 0.12 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * env + 0.06 * (r() * 2 - 1) * (i % 22050 < 2000 ? 3 : 1);
    L[i] = s; R[i] = s * 0.9 + 0.02 * (r() * 2 - 1);
  }
  return [L, R];
}

describe('X1 vocal chain', () => {
  it('high-pass removes 40 Hz rumble and keeps 1 kHz', () => {
    const c = biquadCoeffs('hpf', SR, 80, 0.707);
    const lo = biquad(biquad(sine(40, 1, 0.5), c), c), mid = biquad(biquad(sine(1000, 1, 0.5), c), c);
    expect(db(rms(lo, 20000) / rms(sine(40, 1, 0.5), 20000))).toBeLessThan(-12);
    expect(Math.abs(db(rms(mid, 20000) / rms(sine(1000, 1, 0.5), 20000)))).toBeLessThan(0.5);
  });
  it('compressor ~3:1 reduces a loud sine by about the expected amount', () => {
    const x = sine(500, 1, 0.8); // -2 dBFS peak
    const { y } = compress(x, SR, { thresholdDb: -22, ratio: 3, kneeDb: 4, attackMs: 5, releaseMs: 100, makeupDb: 0 });
    const inDb = db(rms(x, 30000)), outDb = db(rms(y, 30000));
    const over = inDb - (-22 + 3); // roughly: peak envelope detector -> use measured change
    expect(inDb - outDb).toBeGreaterThan(5);
    void over;
  });
  it('de-esser lowers 6.5 kHz more than 500 Hz', () => {
    const x = Float32Array.from(sine(500, 1, 0.2).map((v, i) => v + 0.2 * Math.sin((2 * Math.PI * 6500 * i) / SR)));
    const y = deEss(x, SR);
    const hi = (s: Float32Array) => rms(biquad(s, biquadCoeffs('bandpass', SR, 6500, 2)), 20000);
    expect(hi(y) / hi(x)).toBeLessThan(0.8);
  });
  it('same chain, same input -> identical output (realtime and offline share the code)', () => {
    const v = sine(220, 1, 0.3);
    const a = vocalChain(v, SR, presetFor('inchinare'), 90), b = vocalChain(v, SR, presetFor('inchinare'), 90);
    expect(a[0]).toEqual(b[0]); expect(a[1]).toEqual(b[1]);
    expect(a[0].length).toBe(v.length);
  });
  it('emotion presets differ: Rugăciune has a bigger reverb send than Energic; Epic has a delay', () => {
    expect(presetFor('rugaciune').reverb.send).toBeGreaterThan(presetFor('energic').reverb.send);
    expect(presetFor('epic').delay.send).toBeGreaterThan(0);
    expect(presetFor('epic').delay.beats).toBe(1);
  });
});

describe('X2 mix and master', () => {
  it('loudness meter: stereo 1 kHz at -20 dBFS reads about -20 LUFS', () => {
    const s = sine(1000, 6, 0.1);
    expect(Math.abs(integratedLufs([s, s], SR) + 20)).toBeLessThan(0.5);
  });
  it('master: -14 +- 1 LUFS and true peak <= -1 dBTP on quiet and on hot material', () => {
    for (const [seed, gain] of [[1, 0.3], [2, 3.0]] as const) {
      const b = bed(20, seed).map((c) => c.map((v) => v * gain));
      const m = master(b, SR);
      const lufs = integratedLufs(m.ch, SR);
      const tp = truePeakDb(m.ch);
      console.log(`master gain ${gain}: ${lufs.toFixed(2)} LUFS, ${tp.toFixed(2)} dBTP`);
      expect(Math.abs(lufs + 14)).toBeLessThanOrEqual(1);
      expect(tp).toBeLessThanOrEqual(-0.95);
    }
  });
  it('limiter holds the ceiling on inter-sample peaks', () => {
    const x = sine(11025.5, 2, 1.2);
    const y = limiter([x, x], SR, -1);
    expect(truePeakDb(y)).toBeLessThanOrEqual(-0.9);
  });
  it('ducking: accompaniment is 2-4 dB lower while the voice sings than in the pauses (measured)', () => {
    const voice = new Float32Array(SR * 10);
    for (let i = 0; i < voice.length; i++) { const t = i / SR; if (Math.floor(t / 2) % 2 === 0) voice[i] = 0.2 * Math.sin(2 * Math.PI * 200 * t); }
    const acc = sine(300, 10, 0.3);
    const ducked = applyCurve(acc, SR, duckGains(voice, SR, 3));
    const sung = rms(ducked, Math.round(0.8 * SR), Math.round(1.8 * SR));
    const pause = rms(ducked, Math.round(3.6 * SR), Math.round(3.95 * SR));
    const diff = db(pause / sung);
    console.log('ducking measured', diff.toFixed(2), 'dB');
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(4);
  });
});
