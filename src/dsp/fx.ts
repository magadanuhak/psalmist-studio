/** Vocal chain (X1): HPF -> EQ -> compressor -> de-esser -> sends (reverb, tempo-synced delay).
 *  Pure TypeScript, runs identically for realtime playback (pre-rendered buffer) and offline export. */
import type { Emotion } from '../model/types';

export type BiquadKind = 'hpf' | 'lpf' | 'peak' | 'highshelf' | 'lowshelf' | 'bandpass';

export function biquadCoeffs(kind: BiquadKind, sr: number, f0: number, q = 0.707, gainDb = 0): [number, number, number, number, number] {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f0) / sr, cw = Math.cos(w), sw = Math.sin(w);
  const al = sw / (2 * q);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (kind) {
    case 'hpf': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'lpf': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
    }
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export function biquad(x: Float32Array, c: [number, number, number, number, number]): Float32Array {
  const [b0, b1, b2, a1, a2] = c;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export interface CompOpts { thresholdDb: number; ratio: number; kneeDb: number; attackMs: number; releaseMs: number; makeupDb: number }

/** Feed-forward compressor with soft knee; returns the processed signal and the gain-reduction track (dB, <= 0). */
export function compress(x: Float32Array, sr: number, o: CompOpts, sidechain?: Float32Array): { y: Float32Array; grDb: Float32Array } {
  const y = new Float32Array(x.length), gr = new Float32Array(x.length);
  const aA = Math.exp(-1 / ((o.attackMs / 1000) * sr)), aR = Math.exp(-1 / ((o.releaseMs / 1000) * sr));
  let env = 0;
  const mk = Math.pow(10, o.makeupDb / 20);
  const sc = sidechain ?? x;
  for (let i = 0; i < x.length; i++) {
    const lvl = Math.abs(sc[i]);
    env = lvl > env ? aA * env + (1 - aA) * lvl : aR * env + (1 - aR) * lvl;
    const db = 20 * Math.log10(env + 1e-9);
    const over = db - o.thresholdDb;
    let red = 0;
    if (2 * over < -o.kneeDb) red = 0;
    else if (2 * Math.abs(over) <= o.kneeDb) red = (1 / o.ratio - 1) * ((over + o.kneeDb / 2) ** 2) / (2 * o.kneeDb);
    else red = (1 / o.ratio - 1) * over;
    gr[i] = red;
    y[i] = x[i] * Math.pow(10, red / 20) * mk;
  }
  return { y, grDb: gr };
}

/** Band-limited de-esser: compresses only the 5-9 kHz band when it exceeds the threshold. */
export function deEss(x: Float32Array, sr: number, thresholdDb = -32, ratio = 4): Float32Array {
  const band = biquad(biquad(x, biquadCoeffs('bandpass', sr, 6500, 1.2)), biquadCoeffs('bandpass', sr, 6500, 1.2));
  const { y } = compress(band, sr, { thresholdDb, ratio, kneeDb: 6, attackMs: 1, releaseMs: 40, makeupDb: 0 });
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - band[i] + y[i];
  return out;
}

/** Freeverb-style algorithmic stereo reverb (generated, no impulse-response files). Returns wet only. */
export function reverb(x: Float32Array, sr: number, o: { room: number; damp: number; preDelayMs: number }): [Float32Array, Float32Array] {
  const scale = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const fb = 0.7 + 0.28 * Math.max(0, Math.min(1, o.room));
  const out: Float32Array[] = [new Float32Array(x.length), new Float32Array(x.length)];
  const pre = Math.round((o.preDelayMs / 1000) * sr);
  for (let ch = 0; ch < 2; ch++) {
    const combs = combT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * scale)), i: 0, s: 0 }));
    const aps = apT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * scale)), i: 0 }));
    const d = Math.max(0, Math.min(0.95, o.damp));
    for (let n = 0; n < x.length; n++) {
      const inp = (n >= pre ? x[n - pre] : 0) * 0.015;
      let acc = 0;
      for (const c of combs) {
        const v = c.buf[c.i];
        c.s = v * (1 - d) + c.s * d;
        c.buf[c.i] = inp + c.s * fb;
        if (++c.i >= c.buf.length) c.i = 0;
        acc += v;
      }
      for (const a of aps) {
        const v = a.buf[a.i];
        const o2 = -acc + v;
        a.buf[a.i] = acc + v * 0.5;
        if (++a.i >= a.buf.length) a.i = 0;
        acc = o2;
      }
      out[ch][n] = acc;
    }
  }
  return [out[0], out[1]];
}

/** Tempo-synced feedback delay (wet only). `beats` = 0.5 (1/8) or 1 (1/4). */
export function delay(x: Float32Array, sr: number, bpm: number, beats: number, feedback: number): [Float32Array, Float32Array] {
  const d = Math.max(1, Math.round((60 / bpm) * beats * sr));
  const l = new Float32Array(x.length), r = new Float32Array(x.length);
  const lp = biquadCoeffs('lpf', sr, 3500, 0.707);
  const tap = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) tap[i] = x[i - d] + tap[i - d] * feedback;
  const f = biquad(tap, lp);
  for (let i = 0; i < x.length; i++) { l[i] = f[i]; r[i] = i >= Math.round(d / 2) ? f[i - Math.round(d / 2)] * 0.6 : 0; }
  return [l, r];
}

export interface VocalPreset {
  name: string;
  hpfHz: number;
  mudCutDb: number;
  presenceDb: number;
  airDb: number;
  comp: CompOpts;
  deEss: boolean;
  reverb: { send: number; room: number; damp: number; preDelayMs: number };
  delay: { send: number; beats: number; feedback: number };
}

const base = (): VocalPreset => ({
  name: 'Standard', hpfHz: 80, mudCutDb: -2.5, presenceDb: 2.5, airDb: 1.5,
  comp: { thresholdDb: -22, ratio: 3, kneeDb: 8, attackMs: 8, releaseMs: 120, makeupDb: 2 },
  deEss: true,
  reverb: { send: 0.14, room: 0.45, damp: 0.5, preDelayMs: 18 },
  delay: { send: 0, beats: 0.5, feedback: 0.3 },
});

/** Presets per emotion (editable in Pro). */
export function presetFor(e: Emotion): VocalPreset {
  const p = base();
  switch (e) {
    case 'rugaciune': case 'linistit': p.name = 'Sală mare, blândă'; p.reverb = { send: 0.3, room: 0.85, damp: 0.6, preDelayMs: 30 }; p.comp.ratio = 2.5; break;
    case 'inchinare': p.name = 'Închinare'; p.reverb = { send: 0.24, room: 0.7, damp: 0.5, preDelayMs: 25 }; p.delay = { send: 0.1, beats: 1, feedback: 0.3 }; break;
    case 'lauda': case 'vesel': p.name = 'Cameră scurtă + slap'; p.reverb = { send: 0.1, room: 0.25, damp: 0.4, preDelayMs: 8 }; p.delay = { send: 0.12, beats: 0.5, feedback: 0.12 }; break;
    case 'epic': case 'biruinta': p.name = 'Hol + ecou 1/4'; p.reverb = { send: 0.26, room: 0.9, damp: 0.45, preDelayMs: 35 }; p.delay = { send: 0.18, beats: 1, feedback: 0.4 }; break;
    case 'energic': p.name = 'Strălucitor'; p.presenceDb = 3.2; p.reverb = { send: 0.08, room: 0.3, damp: 0.4, preDelayMs: 10 }; p.delay = { send: 0.1, beats: 0.5, feedback: 0.2 }; break;
    case 'nostalgic': case 'romantic': p.name = 'Cald'; p.airDb = 0.5; p.reverb = { send: 0.2, room: 0.6, damp: 0.65, preDelayMs: 22 }; break;
    case 'trist': p.name = 'Intim'; p.reverb = { send: 0.18, room: 0.65, damp: 0.7, preDelayMs: 20 }; break;
    case 'dramatic': p.name = 'Dramatic'; p.reverb = { send: 0.2, room: 0.75, damp: 0.5, preDelayMs: 28 }; p.comp.ratio = 3.5; break;
  }
  return p;
}

/** The whole chain. Returns a stereo signal (dry + sends) of the same length. */
export function vocalChain(x: Float32Array, sr: number, p: VocalPreset, bpm: number): [Float32Array, Float32Array] {
  let y = biquad(biquad(x, biquadCoeffs('hpf', sr, p.hpfHz, 0.707)), biquadCoeffs('hpf', sr, p.hpfHz, 0.707)); // 24 dB/oct
  y = biquad(y, biquadCoeffs('peak', sr, 300, 1, p.mudCutDb));
  y = biquad(y, biquadCoeffs('peak', sr, 3000, 1, p.presenceDb));
  y = biquad(y, biquadCoeffs('highshelf', sr, 10000, 0.707, p.airDb));
  y = compress(y, sr, p.comp).y;
  if (p.deEss) y = deEss(y, sr);
  const L = Float32Array.from(y), R = Float32Array.from(y);
  if (p.reverb.send > 0) {
    const [wl, wr] = reverb(y, sr, p.reverb);
    for (let i = 0; i < y.length; i++) { L[i] += wl[i] * p.reverb.send * 6; R[i] += wr[i] * p.reverb.send * 6; }
  }
  if (p.delay.send > 0) {
    const [dl, dr] = delay(y, sr, bpm, p.delay.beats, p.delay.feedback);
    for (let i = 0; i < y.length; i++) { L[i] += dl[i] * p.delay.send; R[i] += dr[i] * p.delay.send; }
  }
  return [L, R];
}
