import type { PitchTrack } from '../model/types';

export interface PitchOptions { fmin?: number; fmax?: number; hopSec?: number }

/** Windowed-sinc lowpass + decimate by integer factor. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const half = 4 * factor;
  const len = 2 * half + 1;
  const h = new Float32Array(len);
  const fc = 0.45 / factor; // cycles/sample
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const n = i - half;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < len; i++) h[i] /= sum;
  const outLen = Math.floor(x.length / factor);
  const y = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const c = o * factor;
    let acc = 0;
    for (let k = 0; k < len; k++) {
      const idx = c + k - half;
      if (idx >= 0 && idx < x.length) acc += x[idx] * h[k];
    }
    y[o] = acc;
  }
  return y;
}

export function frameRms(x: Float32Array, sr: number, hopSec: number, winSec = 0.025): Float32Array {
  const n = Math.floor(x.length / (sr * hopSec)) + 1;
  const out = new Float32Array(n);
  const half = Math.round((winSec * sr) / 2);
  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  for (let i = 0; i < n; i++) {
    const c = Math.round(i * hopSec * sr);
    const a = Math.max(0, c - half), b = Math.min(x.length, c + half);
    out[i] = b > a ? Math.sqrt((pre[b] - pre[a]) / (b - a)) : 0;
  }
  return out;
}

const THRESHOLDS = Array.from({ length: 12 }, (_, i) => 0.05 + i * 0.05);
const THR_W = (() => {
  const w = THRESHOLDS.map((t) => Math.exp(-t / 0.2));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / s);
})();

const BIN_CENTS = 25;

/** pYIN-style tracker: YIN CMNDF, multiple thresholds, probabilistic voicing, HMM/Viterbi smoothing. */
export function trackPitch(input: Float32Array, sr: number, opts: PitchOptions = {}): PitchTrack {
  const fmin = opts.fmin ?? 65, fmax = opts.fmax ?? 1100, hopSec = opts.hopSec ?? 0.01;
  const D = Math.max(1, Math.round(sr / 12000));
  const x = decimate(input, D);
  const sr2 = sr / D;
  const nFrames = Math.floor(input.length / (sr * hopSec)) + 1;
  const rms = frameRms(input, sr, hopSec);

  // voicing gate from level statistics
  const db = Array.from(rms, (v) => 20 * Math.log10(v + 1e-9));
  const sorted = [...db].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -90;
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const gateDb = Math.max(p95 - 38, Math.min(p10 + 8, p95 - 14), -70);

  const tauMin = Math.max(2, Math.floor(sr2 / fmax));
  const tauMax = Math.ceil(sr2 / fmin);
  const W = Math.round(0.035 * sr2);
  const total = W + tauMax + 2;

  const pre = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];

  const nBins = Math.ceil((Math.log2(fmax / fmin) * 1200) / BIN_CENTS) + 1;
  const binHz = (b: number) => fmin * Math.pow(2, (b * BIN_CENTS) / 1200);
  const hzToBin = (f: number) => Math.round((Math.log2(f / fmin) * 1200) / BIN_CENTS);

  const obs = new Float32Array(nFrames * (nBins + 1)); // last index = unvoiced
  const cands: { hz: number; mass: number }[][] = new Array(nFrames);
  const pvArr = new Float32Array(nFrames);

  const d = new Float32Array(tauMax + 2);
  const dn = new Float32Array(tauMax + 2);

  for (let f = 0; f < nFrames; f++) {
    cands[f] = [];
    const base = f * (nBins + 1);
    const lvl = db[f];
    const gateGain = Math.min(1, Math.max(0, (lvl - gateDb) / 6));
    if (gateGain <= 0) { obs[base + nBins] = 1; continue; }
    const center = Math.round((f * hopSec * sr) / D);
    const start = center - (total >> 1);
    const get = (i: number) => (i >= 0 && i < x.length ? x[i] : 0);
    let e0 = 0;
    for (let j = 0; j < W; j++) { const v = get(start + j); e0 += v * v; }
    if (e0 < 1e-12) { obs[base + nBins] = 1; continue; }
    const eAt = (s: number) => {
      const a = Math.min(Math.max(s, 0), x.length), b = Math.min(Math.max(s + W, 0), x.length);
      return pre[b] - pre[a];
    };
    const interior = start >= 0 && start + W + tauMax < x.length;
    for (let tau = 1; tau <= tauMax; tau++) {
      let r = 0;
      if (interior) {
        for (let j = 0; j < W; j++) r += x[start + j] * x[start + j + tau];
      } else {
        for (let j = 0; j < W; j++) r += get(start + j) * get(start + j + tau);
      }
      d[tau] = Math.max(0, e0 + eAt(start + tau) - 2 * r);
    }
    let run = 0;
    dn[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      dn[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    const massByTau = new Map<number, number>();
    let dminFirst = 1;
    for (let k = 0; k < THRESHOLDS.length; k++) {
      let tau = tauMin;
      let found = -1;
      while (tau < tauMax) {
        if (dn[tau] < THRESHOLDS[k]) {
          while (tau + 1 < tauMax && dn[tau + 1] < dn[tau]) tau++;
          found = tau; break;
        }
        tau++;
      }
      if (found > 0) {
        // sub-harmonic check: if half the period is (almost) as periodic, the true fundamental is the octave above
        const half = Math.round(found / 2);
        if (half >= tauMin) {
          let bi = -1, bv = 1;
          for (let q = Math.max(tauMin, half - 2); q <= Math.min(tauMax - 1, half + 2); q++) if (dn[q] < bv) { bv = dn[q]; bi = q; }
          if (bi > 0 && bv < 0.4 && bv < dn[found] + 0.15) found = bi;
        }
        massByTau.set(found, (massByTau.get(found) ?? 0) + THR_W[k]);
        if (dn[found] < dminFirst) dminFirst = dn[found];
      }
    }
    if (massByTau.size === 0) { obs[base + nBins] = 1; continue; }
    let msum = 0;
    for (const m of massByTau.values()) msum += m;
    const pv = Math.min(0.98, Math.max(0.02, 1.25 - 2.2 * dminFirst)) * gateGain;
    pvArr[f] = pv;
    for (const [tau, m] of massByTau) {
      const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
      const den = a - 2 * b + c;
      const shift = den > 1e-9 ? (a - c) / (2 * den) : 0;
      const hz = sr2 / (tau + Math.max(-1, Math.min(1, shift)));
      if (hz < fmin * 0.95 || hz > fmax * 1.05) continue;
      const rel = m / msum;
      cands[f].push({ hz, mass: rel });
      const cb = (Math.log2(hz / fmin) * 1200) / BIN_CENTS;
      for (let b2 = Math.max(0, Math.floor(cb) - 2); b2 <= Math.min(nBins - 1, Math.ceil(cb) + 2); b2++) {
        const dd = b2 - cb;
        obs[base + b2] += pv * rel * Math.exp(-0.5 * dd * dd);
      }
    }
    obs[base + nBins] = 1 - pv;
  }

  // Viterbi over pitch bins + unvoiced state
  const S = nBins + 1;
  const U = nBins;
  const maxJump = 16, sigma = 3.5;
  const trans = new Float32Array(maxJump + 1);
  for (let j = 0; j <= maxJump; j++) trans[j] = -j / sigma;
  const lSwitch = Math.log(0.02), lStay = Math.log(0.98);
  const lUV = lSwitch - Math.log(nBins) * 0.3;
  let prev = new Float32Array(S), cur = new Float32Array(S);
  const back = new Int16Array(nFrames * S);
  const lo = (p: number) => Math.log(p + 1e-4);
  for (let s = 0; s < S; s++) prev[s] = lo(obs[s]) + (s === U ? 0 : -0.7);
  for (let f = 1; f < nFrames; f++) {
    const base = f * S;
    const fromU = prev[U] + lUV;
    for (let s = 0; s < nBins; s++) {
      let best = fromU, arg = U;
      const a = Math.max(0, s - maxJump), b = Math.min(nBins - 1, s + maxJump);
      for (let q = a; q <= b; q++) {
        const v = prev[q] + trans[Math.abs(q - s)] + lStay;
        if (v > best) { best = v; arg = q; }
      }
      cur[s] = best + lo(obs[base + s]);
      back[base + s] = arg;
    }
    let best = prev[U] + lStay, arg = U;
    for (let q = 0; q < nBins; q++) {
      const v = prev[q] + lSwitch;
      if (v > best) { best = v; arg = q; }
    }
    cur[U] = best + lo(obs[base + U]);
    back[base + U] = arg;
    const t = prev; prev = cur; cur = t;
  }
  let state = 0;
  for (let s = 1; s < S; s++) if (prev[s] > prev[state]) state = s;
  const path = new Int16Array(nFrames);
  for (let f = nFrames - 1; f >= 0; f--) {
    path[f] = state;
    if (f > 0) state = back[f * S + state];
  }

  const hz = new Float32Array(nFrames);
  const voicedProb = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const s = path[f];
    if (s === U) continue;
    let bestHz = 0, bestM = -1;
    for (const c of cands[f]) {
      if (Math.abs(hzToBin(c.hz) - s) <= 2 && c.mass > bestM) { bestM = c.mass; bestHz = c.hz; }
    }
    hz[f] = bestHz > 0 ? bestHz : binHz(s);
    voicedProb[f] = Math.max(pvArr[f], 0.05);
  }
  return { hopSec, hz, voicedProb, rms };
}
