/** Pitch of a rendered note, measured against the note it should be (Q1 tuning audit). Harmonic-comb estimate: robust for weak fundamentals
 *  (bass instruments) and decides the octave from which candidate explains the partials without leaving unexplained half-integer partials. */
import { rfft } from '../../dsp/fft';

export interface PitchCheck { hz: number; cents: number; octave: number; /** fraction of the first 6 partials found */ coverage: number }

const N = 1 << 16;

export function checkPitch(seg: Float32Array, sr: number, targetHz: number): PitchCheck | null {
  const buf = new Float32Array(N);
  const n = Math.min(seg.length, N);
  if (n < 2048) return null;
  for (let i = 0; i < n; i++) buf[i] = seg[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const sp = rfft(buf, N);
  const mag = (k: number) => Math.hypot(sp[2 * k], sp[2 * k + 1]);
  const binHz = sr / N;
  let gmax = 0;
  for (let k = 2; k < N / 2; k++) gmax = Math.max(gmax, mag(k));
  if (gmax < 1e-6) return null;
  const peak = (f: number, centsWin: number) => {
    const lo = Math.max(2, Math.floor((f * Math.pow(2, -centsWin / 1200)) / binHz)), hi = Math.min(N / 2 - 2, Math.ceil((f * Math.pow(2, centsWin / 1200)) / binHz));
    let best = lo, bv = 0;
    for (let k = lo; k <= hi; k++) { const v = mag(k); if (v > bv) { bv = v; best = k; } }
    const a = Math.log(mag(best - 1) + 1e-12), b = Math.log(mag(best) + 1e-12), c = Math.log(mag(best + 1) + 1e-12);
    const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
    return { f: (best + Math.max(-0.5, Math.min(0.5, d))) * binHz, v: bv };
  };
  const present = (v: number) => v >= 0.08 * gmax;
  let best: { r: number; score: number; hz: number; cov: number } | null = null;
  for (const r of [0.25, 0.5, 1, 2]) {
    const c0 = targetHz * r;
    if (c0 < 25 || c0 > sr / 2.2) continue;
    const H = Math.max(1, Math.min(6, Math.floor(sr / 2.1 / c0)));
    const fund = peak(c0, 60);
    const fundStrong = fund.v >= 0.5 * gmax;
    // refine the candidate fundamental with its partials: weighted mean of (peak / h)
    let integer = 0, half = 0, wsum = 0, fsum = 0;
    for (let h = 1; h <= H; h++) {
      const p = h === 1 ? fund : peak(c0 * h, 50 + 10 * h);
      if (present(p.v)) { integer++; wsum += p.v; fsum += (p.f / h) * p.v; }
    }
    for (let h = 1; h <= Math.min(4, H); h++) if (present(peak(c0 * (h + 0.5), 45).v)) half++;
    const score = integer - 2 * half + (fundStrong ? 1 : 0) - (r === 1 ? 0 : 0.01);
    // mallets and bells: a strong lone fundamental (the other partials are not harmonic) is the pitch
    const hz = fundStrong && integer <= 3 ? fund.f : wsum > 0 ? fsum / wsum : 0;
    if ((integer >= 2 || fundStrong) && hz > 0 && (!best || score > best.score)) best = { r, score, hz, cov: integer / H };
  }
  if (!best) return null;
  const oct = Math.round(Math.log2(best.hz / targetHz)) || 0;
  return { hz: best.hz, octave: oct, cents: 1200 * Math.log2(best.hz / (targetHz * Math.pow(2, oct))), coverage: best.cov };
}
