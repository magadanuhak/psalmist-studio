/** Mix (X2): ducking curve from the vocal envelope, glue compressor, true-peak limiter, BS.1770 loudness. Pure TypeScript. */
import { biquad, compress } from './fx';

export const DUCK_RATE = 100; // control-rate samples per second

/** Vocal activity envelope (0..1, 100 Hz): fast attack, slow release, thresholded. */
export function vocalActivity(voice: Float32Array, sr: number, thresholdDb = -48): Float32Array {
  const n = Math.ceil((voice.length / sr) * DUCK_RATE) + 1;
  const hop = sr / DUCK_RATE;
  const env = new Float32Array(n);
  const aA = Math.exp(-1 / (0.03 * DUCK_RATE)), aR = Math.exp(-1 / (0.25 * DUCK_RATE));
  let e = 0;
  for (let k = 0; k < n; k++) {
    let s = 0, c = 0;
    for (let i = Math.floor(k * hop); i < Math.min(voice.length, Math.floor((k + 1) * hop)); i++) { s += voice[i] * voice[i]; c++; }
    const db = c ? 10 * Math.log10(s / c + 1e-12) : -120;
    const target = db > thresholdDb ? 1 : 0;
    e = target > e ? aA * e + (1 - aA) * target : aR * e + (1 - aR) * target;
    env[k] = e;
  }
  return env;
}

/** Gain (linear) to apply to the accompaniment bus: -depthDb while the voice sings, 0 dB in pauses. */
export function duckGains(voice: Float32Array, sr: number, depthDb = 3): Float32Array {
  const act = vocalActivity(voice, sr);
  const g = new Float32Array(act.length);
  for (let i = 0; i < act.length; i++) g[i] = Math.pow(10, (-depthDb * act[i]) / 20);
  return g;
}

/** Apply a 100 Hz gain curve to a signal (linear interpolation). */
export function applyCurve(x: Float32Array, sr: number, curve: Float32Array): Float32Array {
  const y = new Float32Array(x.length);
  const hop = sr / DUCK_RATE;
  for (let i = 0; i < x.length; i++) {
    const p = i / hop, k = Math.floor(p);
    const a = curve[Math.min(k, curve.length - 1)], b = curve[Math.min(k + 1, curve.length - 1)];
    y[i] = x[i] * (a + (b - a) * (p - k));
  }
  return y;
}

// ---------------------------------------------------------------- loudness (ITU-R BS.1770-4)

function kWeight(x: Float32Array, sr: number): Float32Array {
  // pre-filter (high shelf +4 dB @ ~1.68 kHz) and RLB high-pass (~38 Hz), coefficients for the actual sample rate
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const s: [number, number, number, number, number] = [
    (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0,
  ];
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const d0 = 1 + K1 / Q1 + K1 * K1;
  const h: [number, number, number, number, number] = [1, -2, 1, (2 * (K1 * K1 - 1)) / d0, (1 - K1 / Q1 + K1 * K1) / d0];
  return biquad(biquad(x, s), h);
}

/** Integrated loudness (LUFS) of a stereo signal with absolute (-70) and relative (-10 LU) gating. */
export function integratedLufs(ch: Float32Array[], sr: number): number {
  const w = ch.map((c) => kWeight(c, sr));
  const blk = Math.round(0.4 * sr), step = Math.round(0.1 * sr);
  const n = w[0].length;
  const ms: number[] = [];
  for (let s = 0; s + blk <= n; s += step) {
    let acc = 0;
    for (const c of w) { let e = 0; for (let i = s; i < s + blk; i++) e += c[i] * c[i]; acc += e / blk; }
    ms.push(acc);
  }
  if (!ms.length) return -Infinity;
  const l = (z: number) => -0.691 + 10 * Math.log10(z + 1e-20);
  const abs = ms.filter((z) => l(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = l(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const g = abs.filter((z) => l(z) > rel);
  if (!g.length) return -Infinity;
  return l(g.reduce((a, b) => a + b, 0) / g.length);
}

// ---------------------------------------------------------------- true peak

const TP_TAPS = (() => {
  // 4x polyphase windowed-sinc interpolator (12 taps per phase)
  const phases: Float32Array[] = [];
  const T = 12;
  for (let p = 0; p < 4; p++) {
    const h = new Float32Array(T);
    let sum = 0;
    for (let k = 0; k < T; k++) {
      const x = k - T / 2 + 1 - p / 4;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5 - p / 4 + 0.0)) / T);
      h[k] = sinc * Math.max(0, win);
      sum += h[k];
    }
    for (let k = 0; k < T; k++) h[k] /= sum;
    phases.push(h);
  }
  return phases;
})();

/** Per-sample true-peak magnitude estimate (4x oversampled, linear). */
export function truePeakTrack(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const T = TP_TAPS[0].length;
  for (let i = 0; i < x.length; i++) {
    let m = Math.abs(x[i]);
    for (let p = 1; p < 4; p++) {
      let s = 0;
      const h = TP_TAPS[p];
      for (let k = 0; k < T; k++) { const j = i - T / 2 + 1 + k; if (j >= 0 && j < x.length) s += h[k] * x[j]; }
      m = Math.max(m, Math.abs(s));
    }
    out[i] = m;
  }
  return out;
}
export const truePeakDb = (ch: Float32Array[]) => 20 * Math.log10(Math.max(1e-9, ...ch.map((c) => { let m = 0; const t = truePeakTrack(c); for (const v of t) if (v > m) m = v; return m; })));

/** Look-ahead true-peak limiter (stereo-linked). Ceiling in dBTP. */
export function limiter(ch: Float32Array[], sr: number, ceilingDb = -1, releaseMs = 80): Float32Array[] {
  const n = ch[0].length;
  const look = Math.round(0.002 * sr);
  const ceil = Math.pow(10, ceilingDb / 20);
  const tp = ch.map((c) => truePeakTrack(c));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(...tp.map((t) => t[i])); need[i] = p > ceil ? ceil / p : 1; }
  // minimum over the look-ahead window, box-smoothed over `look` samples, then a release ramp
  const minWin = new Float32Array(n);
  const dq: number[] = [];
  const W = 2 * look;
  for (let i = 0; i < n + look; i++) {
    if (i < n) { while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop(); dq.push(i); }
    while (dq.length && dq[0] < i - W) dq.shift();
    const t = i - look;
    if (t >= 0 && t < n) minWin[t] = need[dq[0]];
  }
  const smooth = new Float32Array(n);
  let acc = 0;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { acc += minWin[i]; cum[i + 1] = acc; }
  for (let i = 0; i < n; i++) { const a0 = Math.max(0, i - look + 1); smooth[i] = (cum[i + 1] - cum[a0]) / (i + 1 - a0); }
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const gain = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const tg = Math.min(smooth[i], need[i]);
    g = tg < g ? tg : g + (tg - g) * (1 - rel);
    gain[i] = Math.min(g, need[i]);
  }
  const out = ch.map(() => new Float32Array(n));
  for (let k = 0; k < ch.length; k++) for (let i = 0; i < n; i++) out[k][i] = ch[k][i] * gain[i];
  return out;
}

/** Gentle glue compressor on the stereo bus (linked). */
export function glue(ch: Float32Array[], sr: number): Float32Array[] {
  const n = ch[0].length;
  const key = new Float32Array(n);
  for (let i = 0; i < n; i++) key[i] = Math.max(...ch.map((c) => Math.abs(c[i])));
  const { grDb } = compress(key, sr, { thresholdDb: -20, ratio: 2, kneeDb: 10, attackMs: 30, releaseMs: 250, makeupDb: 0 }, key);
  return ch.map((c) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = c[i] * Math.pow(10, grDb[i] / 20); return y; });
}

export interface MasterResult { ch: Float32Array[]; lufs: number; truePeakDb: number }

/** Master chain: glue -> gain to the loudness target -> true-peak limiter, iterated until the target is met. */
export function master(ch: Float32Array[], sr: number, targetLufs = -14, ceilingDb = -1): MasterResult {
  const g = glue(ch, sr);
  let cur = integratedLufs(g, sr);
  if (!Number.isFinite(cur)) return { ch: g, lufs: cur, truePeakDb: truePeakDb(g) };
  let gainDb = targetLufs - cur;
  let out = g;
  for (let it = 0; it < 6; it++) {
    const k = Math.pow(10, gainDb / 20);
    out = limiter(g.map((c) => c.map((v) => v * k)), sr, ceilingDb);
    cur = integratedLufs(out, sr);
    const err = targetLufs - cur;
    if (Math.abs(err) < 0.15) break;
    gainDb += err;
  }
  return { ch: out, lufs: cur, truePeakDb: truePeakDb(out) };
}
