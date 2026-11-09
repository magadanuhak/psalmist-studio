import { describe, expect, it } from 'vitest';
import { clickSchedule, renderClicks } from '../audio/click';
import { detectBleed, reduceBleed } from './bleed';

const sr = 16000, dur = 40;
const sig = { num: 4, den: 4, grouping: [4] };
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; }; }
/** a sung line (harmonics of a moving fundamental) + room noise + optional click leakage (delayed by the headphone-to-mic path) */
function take(bleedGain: number, seed = 3) {
  const r = rng(seed), n = dur * sr, a = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f0 = 221.37 * Math.pow(2, Math.floor(i / sr / 0.75) % 5 / 12 * 2) * (1 + 0.012 * Math.sin((2 * Math.PI * 5.3 * i) / sr));
    ph += (2 * Math.PI * f0) / sr;
    let v = 0;
    for (let h = 1; h <= 3; h++) v += Math.sin(ph * h) / (h * h);
    a[i] = 0.12 * v + 0.002 * r();
  }
  const ev = clickSchedule(100, sig, 16);
  const leak = renderClicks(ev.map((e) => ({ ...e, t: e.t + 0.021 })), sr, dur, 'rim', bleedGain);
  for (let i = 0; i < n; i++) a[i] += leak[i];
  return { a, ev };
}
const energy = (x: Float32Array, i0: number, i1: number) => { let e = 0; for (let i = i0; i < i1; i++) e += x[i] * x[i]; return e; };

describe('headphone bleed check', () => {
  it('finds click energy that follows the schedule, with its lag', () => {
    const { a, ev } = take(0.05);
    const r = detectBleed(a, sr, ev);
    expect(r.level === 'mild' || r.level === 'strong').toBe(true);
    expect(Math.abs(r.lagMs - 21)).toBeLessThanOrEqual(3);
  });
  it('a clean take (no leak) is not flagged', () => {
    const { a, ev } = take(0);
    expect(detectBleed(a, sr, ev).level).toBe('none');
  });
  it('a loud leak is "strong"', () => {
    const { a, ev } = take(0.4);
    expect(detectBleed(a, sr, ev).level).toBe('strong');
  });
  it('subtraction removes most of the click and keeps the voice', () => {
    const { a, ev } = take(0.1);
    const rep = detectBleed(a, sr, ev);
    const out = reduceBleed(a, sr, ev, rep.lagMs);
    const clean = take(0).a;
    const resid = (x: Float32Array) => ev.slice(1, 50).reduce((s, e) => { let q = 0; for (let k = Math.round((e.t + 0.02) * sr); k < Math.round((e.t + 0.06) * sr); k++) q += (x[k] - clean[k]) ** 2; return s + q; }, 0);
    expect(resid(out) / resid(a)).toBeLessThan(0.3);
    expect(energy(out, 0, out.length) / energy(clean, 0, clean.length)).toBeGreaterThan(0.9);
    expect(detectBleed(out, sr, ev).ratio).toBeLessThan(rep.ratio);
  });
});
