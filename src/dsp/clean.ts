import type { NoiseProfile } from '../model/types';
import { getFFT, hann } from './fft';

const FFT_SIZE = 2048;
const HOP = 512;

/** 2nd-order Butterworth high-pass (12 dB/oct), direct form I. */
export function highpass(x: Float32Array, sr: number, fc = 80): Float32Array {
  const w0 = (2 * Math.PI * fc) / sr;
  const cos = Math.cos(w0), alpha = Math.sin(w0) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0;
  const a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

/** Interpolate across isolated sample-level spikes (clicks/pops). Returns number of repaired runs. */
export function removeClicks(x: Float32Array): number {
  const n = x.length;
  if (n < 64) return 0;
  const d = new Float32Array(n);
  for (let i = 1; i < n - 1; i++) d[i] = x[i] - 0.5 * (x[i - 1] + x[i + 1]);
  const win = 128;
  let acc = 0;
  for (let i = 0; i < win && i < n; i++) acc += Math.abs(d[i]);
  let repaired = 0;
  for (let i = 1; i < n - 1; i++) {
    const out = i + win / 2 < n ? Math.abs(d[i + win / 2]) : 0;
    const inn = i - win / 2 >= 0 ? Math.abs(d[i - win / 2]) : 0;
    acc += out - inn;
    const local = acc / win;
    if (Math.abs(d[i]) > 0.04 && Math.abs(d[i]) > 14 * local) {
      let j = i;
      while (j < n - 1 && j - i < 8 && Math.abs(d[j + 1]) > 0.02 && Math.abs(d[j + 1]) > 8 * local) j++;
      const a = x[i - 1], b = x[Math.min(n - 1, j + 1)];
      for (let k = i; k <= j; k++) x[k] = a + ((b - a) * (k - i + 1)) / (j - i + 2);
      i = j + 1;
      repaired++;
    }
  }
  return repaired;
}

function stftMags(x: Float32Array): { mags: Float32Array[]; spectra: Float64Array[] } {
  const fft = getFFT(FFT_SIZE);
  const win = hann(FFT_SIZE);
  const frames = Math.max(1, Math.ceil((x.length + FFT_SIZE) / HOP));
  const mags: Float32Array[] = [];
  const spectra: Float64Array[] = [];
  const buf = new Array<number>(FFT_SIZE);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - (FFT_SIZE - HOP);
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      buf[i] = idx >= 0 && idx < x.length ? x[idx] * win[i] : 0;
    }
    const out = fft.createComplexArray() as unknown as Float64Array;
    fft.realTransform(out, buf);
    fft.completeSpectrum(out);
    const m = new Float32Array(FFT_SIZE / 2 + 1);
    for (let k = 0; k <= FFT_SIZE / 2; k++) m[k] = Math.hypot(out[2 * k], out[2 * k + 1]);
    mags.push(m);
    spectra.push(out);
  }
  return { mags, spectra };
}

export function buildNoiseProfile(x: Float32Array, sr: number): NoiseProfile {
  const { mags } = stftMags(x);
  const bins = FFT_SIZE / 2 + 1;
  const mean = new Array<number>(bins).fill(0), std = new Array<number>(bins).fill(0);
  const use = mags.length > 6 ? mags.slice(2, mags.length - 2) : mags;
  for (const m of use) for (let k = 0; k < bins; k++) mean[k] += m[k];
  for (let k = 0; k < bins; k++) mean[k] /= use.length;
  for (const m of use) for (let k = 0; k < bins; k++) std[k] += (m[k] - mean[k]) ** 2;
  for (let k = 0; k < bins; k++) std[k] = Math.sqrt(std[k] / use.length);
  return { mean, std, fftSize: FFT_SIZE, sampleRate: sr };
}

/** Estimate a profile from the quietest 15% of frames when no room tone exists. */
function profileFromQuietest(mags: Float32Array[], sr: number): NoiseProfile {
  const bins = FFT_SIZE / 2 + 1;
  const energy = mags.map((m) => m.reduce((s, v) => s + v * v, 0));
  const order = energy.map((e, i) => [e, i] as const).sort((a, b) => a[0] - b[0]);
  // a take with no real silence (legato singing, no room tone): the quietest frames are still voiced and would teach the gate the voice itself
  // (the fundamental of a low male voice vanishes). Then the noise floor is the per-bin 15th percentile over time: harmonics move with the notes.
  const eMed = order[Math.floor(order.length / 2)][0], eQuiet = order[Math.floor(order.length * 0.15)][0];
  if (order.length >= 40 && eQuiet > 0.25 * eMed) {
    const mean = new Array<number>(bins).fill(0), std = new Array<number>(bins).fill(0);
    const col = new Float32Array(mags.length);
    for (let k = 0; k < bins; k++) {
      for (let f = 0; f < mags.length; f++) col[f] = mags[f][k];
      const sorted = Float32Array.from(col).sort();
      mean[k] = sorted[Math.floor(sorted.length * 0.15)];
      std[k] = 0.25 * mean[k];
    }
    return { mean, std, fftSize: FFT_SIZE, sampleRate: sr };
  }
  const take = order.slice(0, Math.max(4, Math.floor(order.length * 0.15))).map((o) => mags[o[1]]);
  const mean = new Array<number>(bins).fill(0), std = new Array<number>(bins).fill(0);
  for (const m of take) for (let k = 0; k < bins; k++) mean[k] += m[k];
  for (let k = 0; k < bins; k++) mean[k] /= take.length;
  for (const m of take) for (let k = 0; k < bins; k++) std[k] += (m[k] - mean[k]) ** 2;
  for (let k = 0; k < bins; k++) std[k] = Math.sqrt(std[k] / take.length);
  return { mean, std, fftSize: FFT_SIZE, sampleRate: sr };
}

export interface CleanOptions {
  /** threshold = mean + k * std */
  k?: number;
  floorGain?: number;
  targetRmsDb?: number;
}

export interface CleanResult { audio: Float32Array; profile: NoiseProfile; clicks: number; gainDb: number }

export function cleanAudio(
  input: Float32Array, sr: number, profileIn?: NoiseProfile | null, opts: CleanOptions = {},
): CleanResult {
  const k = opts.k ?? 3.2, floor = opts.floorGain ?? 0.03, targetDb = opts.targetRmsDb ?? -16;
  let x = highpass(input, sr, 80);
  const clicks = removeClicks(x);
  const { mags, spectra } = stftMags(x);
  const bins = FFT_SIZE / 2 + 1;
  let profile = profileIn && profileIn.sampleRate === sr && profileIn.fftSize === FFT_SIZE ? profileIn : null;
  if (!profile) profile = profileFromQuietest(mags, sr);
  // the profile may come from raw (non-HPF) room tone: high-passed bins are already tiny, thresholds stay valid.
  const thr = new Float32Array(bins);
  for (let b = 0; b < bins; b++) thr[b] = profile.mean[b] + k * profile.std[b] + 1e-9;

  const F = mags.length;
  const mask: Float32Array[] = [];
  for (let f = 0; f < F; f++) {
    const g = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const r = mags[f][b] / thr[b];
      g[b] = r <= 1 ? 0 : Math.min(1, (r - 1) / 1.5);
    }
    mask.push(g);
  }
  // smooth over frequency (3 taps) then time (peak-hold with decay -> avoids musical noise & chopped tails)
  const sm: Float32Array[] = mask.map((g) => {
    const o = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const l = g[Math.max(0, b - 1)], r = g[Math.min(bins - 1, b + 1)];
      o[b] = 0.25 * l + 0.5 * g[b] + 0.25 * r;
    }
    return o;
  });
  const out = new Float32Array(x.length);
  const win = hann(FFT_SIZE);
  const fft = getFFT(FFT_SIZE);
  const tmp = fft.createComplexArray() as unknown as Float64Array;
  const norm = new Float32Array(x.length);
  let prevMask = new Float32Array(bins);
  for (let f = 0; f < F; f++) {
    const cur = sm[f];
    const next = f + 1 < F ? sm[f + 1] : cur;
    const spec = spectra[f];
    const full = new Float64Array(FFT_SIZE * 2);
    for (let b = 0; b < bins; b++) {
      // time smoothing: [prev, cur, next] weighted, with fast attack from either neighbour
      const t = Math.max(cur[b], 0.5 * prevMask[b], 0.5 * next[b]);
      const g = floor + (1 - floor) * Math.min(1, 0.6 * t + 0.4 * cur[b] + (t > 0.9 ? 0.4 : 0));
      prevMask[b] = cur[b];
      full[2 * b] = spec[2 * b] * g;
      full[2 * b + 1] = spec[2 * b + 1] * g;
      if (b > 0 && b < FFT_SIZE / 2) {
        full[2 * (FFT_SIZE - b)] = full[2 * b];
        full[2 * (FFT_SIZE - b) + 1] = -full[2 * b + 1];
      }
    }
    fft.inverseTransform(tmp, full);
    const start = f * HOP - (FFT_SIZE - HOP);
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      if (idx >= 0 && idx < x.length) {
        out[idx] += tmp[2 * i] * win[i];
        norm[idx] += win[i] * win[i];
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  x = out;

  // normalise voiced-region RMS to target, never clip
  const frame = 1024;
  const frameRmsV: number[] = [];
  for (let i = 0; i + frame <= x.length; i += frame) {
    let s = 0;
    for (let j = 0; j < frame; j++) s += x[i + j] * x[i + j];
    frameRmsV.push(Math.sqrt(s / frame));
  }
  const maxR = Math.max(...frameRmsV, 1e-9);
  const voiced = frameRmsV.filter((r) => r > maxR * 0.2);
  const meanSq = voiced.reduce((s, r) => s + r * r, 0) / Math.max(1, voiced.length);
  const rmsNow = Math.sqrt(meanSq) || 1e-9;
  let gain = Math.pow(10, targetDb / 20) / rmsNow;
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak * gain > 0.97) gain = 0.97 / peak;
  if (peak < 1e-7) gain = 1;
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  return { audio: x, profile, clicks, gainDb: 20 * Math.log10(gain) };
}
