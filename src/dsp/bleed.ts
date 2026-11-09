/**
 * Headphone bleed: the metronome leaking from the headphones into the microphone.
 * Detection looks for energy that follows the click schedule (at an unknown but constant lag); reduction subtracts the learned click shape.
 */
import type { ClickEvent } from '../audio/click';

export type BleedLevel = 'none' | 'mild' | 'strong';
export interface BleedReport { level: BleedLevel; /** click-aligned energy over the local background */ ratio: number; /** share of clicks that stand out */ consistency: number; lagMs: number }

/** one-pole high-pass (the click lives above the voice's fundamental) */
function highpass(x: Float32Array, sr: number, fc = 1500): Float32Array {
  const a = Math.exp(-2 * Math.PI * fc / sr);
  let cur = x;
  for (let pass = 0; pass < 3; pass++) { // three poles: the voice's harmonics fall away steeply
    const y = new Float32Array(cur.length);
    let px = 0, py = 0;
    for (let i = 0; i < cur.length; i++) { const v = a * (py + cur[i] - px); y[i] = v; px = cur[i]; py = v; }
    cur = y;
  }
  return cur;
}

/** zero-phase high-pass: forward and backward, so the band can be subtracted from the raw signal exactly */
function highpassZp(x: Float32Array, sr: number, fc = 500): Float32Array {
  const f = highpass(x, sr, fc).reverse(); // (reverse is in place)
  return highpass(f, sr, fc).reverse();
}

const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function detectBleed(audio: Float32Array, sr: number, clicks: Pick<ClickEvent, 't'>[], searchMs = 60): BleedReport {
  const none: BleedReport = { level: 'none', ratio: 1, consistency: 0, lagMs: 0 };
  const ts = clicks.map((c) => c.t).filter((t) => t > 0.05 && t < audio.length / sr - 0.2);
  if (ts.length < 4) return none;
  const x = highpass(audio, sr);
  const env = (t: number) => { // rms of 1.5 ms around t
    const n = Math.max(2, Math.round(0.0015 * sr)), i0 = Math.round(t * sr);
    let e = 0, c = 0;
    for (let i = Math.max(0, i0); i < Math.min(x.length, i0 + n); i++) { e += x[i] * x[i]; c++; }
    return c ? Math.sqrt(e / c) : 0;
  };
  const gap = median(ts.slice(1).map((t, i) => t - ts[i]));
  // lag scan: mean envelope at t + lag
  let best = -1, bestLag = 0;
  for (let lag = 0; lag <= searchMs; lag++) {
    const a = ts.reduce((s, t) => s + env(t + lag / 1000), 0) / ts.length;
    if (a > best) { best = a; bestLag = lag; }
  }
  const lag = bestLag / 1000;
  // background: envelope at the same offsets inside the beat, away from the click
  const bg: number[] = [];
  for (const t of ts) for (const f of [0.35, 0.5, 0.65]) bg.push(env(t + gap * f));
  const base = Math.max(median(bg), 1e-6);
  const per = ts.map((t) => env(t + lag) / Math.max(median([0.3, 0.45, 0.6, 0.7].map((f) => env(t + gap * f))), 1e-6));
  const ratio = best / base;
  const consistency = per.filter((r) => r > 2.5).length / per.length;
  const level: BleedLevel = ratio > 8 && consistency > 0.6 ? 'strong' : ratio > 2.5 && consistency > 0.5 ? 'mild' : 'none';
  return { level, ratio, consistency, lagMs: bestLag };
}

/** Subtract the click's high band (median shape of aligned segments per click kind, so the voice averages out). The low band of the click is left as it is: it is inaudible under the voice. */
export function reduceBleed(audio: Float32Array, sr: number, clicks: Pick<ClickEvent, 't' | 'kind'>[], lagMs: number): Float32Array {
  const out = Float32Array.from(audio);
  const hp = highpassZp(audio, sr);
  const len = Math.round(0.08 * sr), pre = Math.round(0.002 * sr);
  for (const k of [...new Set(clicks.map((c) => c.kind))]) {
    const segs = clicks.filter((c) => c.kind === k).map((c) => Math.round((c.t + lagMs / 1000) * sr) - pre).filter((i) => i >= 0 && i + len < audio.length);
    if (segs.length < 3) continue;
    const tpl = new Float32Array(len);
    const col = new Array<number>(segs.length);
    for (let j = 0; j < len; j++) { for (let s = 0; s < segs.length; s++) col[s] = hp[segs[s] + j]; tpl[j] = median(col); }
    let tt = 0;
    for (let j = 0; j < len; j++) tt += tpl[j] * tpl[j];
    if (tt < 1e-12) continue;
    for (const i0 of segs) {
      let dot = 0;
      for (let j = 0; j < len; j++) dot += hp[i0 + j] * tpl[j];
      const g = Math.max(0, Math.min(1.5, dot / tt));
      for (let j = 0; j < len; j++) out[i0 + j] -= g * tpl[j];
    }
  }
  return out;
}
