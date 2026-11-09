/** Pitch clarity of a sample: how much of its body is a clean, voiced tone at the labelled pitch (not air, flutter, key clicks or effects). */
import { trackPitch } from '../../dsp/pitch';

export interface Clarity { clarity: number; voiced: number; onPitch: number; flatness: number }

/** voiced = share of frames with a confident pitch; onPitch = share of those within 60 cents of the label (octave-exact); flatness = spectral flatness 0..1 (noise-like when high). */
export function measureClarity(x: Float32Array, sr: number, midi: number): Clarity {
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const a = Math.round(0.08 * sr), b = Math.min(x.length, Math.round(Math.min(x.length / sr, 1.4) * sr));
  const seg = x.subarray(Math.min(a, Math.max(0, b - 4096)), b);
  if (seg.length < 2048) return { clarity: 0, voiced: 0, onPitch: 0, flatness: 1 };
  const tr = trackPitch(seg, sr, { fmin: Math.max(40, hz * 0.7), fmax: Math.min(4000, hz * 1.45) });
  let voiced = 0, on = 0;
  for (let i = 0; i < tr.hz.length; i++) {
    if (tr.hz[i] > 0 && tr.voicedProb[i] >= 0.5) { voiced++; if (Math.abs(1200 * Math.log2(tr.hz[i] / hz)) <= 60) on++; }
  }
  const nf = tr.hz.length || 1;
  // flatness: geometric / arithmetic mean of a coarse band spectrum
  const N = 4096, bands = 40, p = new Float64Array(bands);
  for (let s0 = 0; s0 + N <= seg.length; s0 += N) {
    for (let k = 0; k < bands; k++) { const f = 100 * Math.pow(2, k / 6); const w = (2 * Math.PI * f) / sr; let re = 0, im = 0; for (let i = 0; i < N; i += 4) { const v = seg[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); re += v * Math.cos(w * i); im += v * Math.sin(w * i); } p[k] += re * re + im * im; }
  }
  let g = 0, m = 0, c = 0;
  for (let k = 0; k < bands; k++) if (100 * Math.pow(2, k / 6) < sr / 2.2) { g += Math.log(p[k] + 1e-20); m += p[k]; c++; }
  const flatness = c ? Math.exp(g / c) / (m / c + 1e-20) : 1;
  const v = voiced / nf, o = voiced ? on / voiced : 0;
  return { voiced: v, onPitch: o, flatness, clarity: v * o };
}
