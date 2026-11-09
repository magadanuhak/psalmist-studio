/**
 * Autotune: pitch correction of a recorded voice towards the key's scale.
 * Own time-domain PSOLA shifter (no Rubber Band or any GPL code): pitch-synchronous grains are re-spaced to the corrected period while
 * their positions stay on the original timeline, so note timing is preserved (well within 5 ms).
 */
import type { KeySig, PitchTrack } from '../model/types';
import { scalePcs } from '../music/theory';
import { trackPitch } from './pitch';

export interface AutotuneOpts {
  /** key whose scale the notes are pulled to; null = chromatic (nearest semitone) */
  key: KeySig | null;
  /** 0 = no correction, 1 = on the note */
  strength: number;
  /** time (ms) to move onto a new target note: 0 = instant ("robot"), 100+ = natural slides */
  speedMs: number;
  /** 0..1: how much of the natural vibrato stays (1 = all) */
  keepVibrato: number;
  /** 0..1: leaves part of the natural intonation drift, so it does not sound mechanical */
  humanize: number;
  /** pitch track of the audio when already known (hop 10 ms) */
  track?: PitchTrack;
}
export const DEFAULT_AUTOTUNE: Omit<AutotuneOpts, 'key' | 'track'> = { strength: 0.9, speedMs: 40, keepVibrato: 0.8, humanize: 0.2 };

export interface AutotuneResult { audio: Float32Array; /** applied shift per pitch frame, cents */ shiftCents: Float32Array; track: PitchTrack; voicedFrames: number }

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);

function targetNote(m: number, scale: Set<number> | null, cur: number | null): number {
  const near = (x: number) => { let b = Math.round(x), bd = 99; for (let c = Math.floor(x) - 2; c <= Math.ceil(x) + 2; c++) { if (scale && !scale.has(((c % 12) + 12) % 12)) continue; const d = Math.abs(c - x); if (d < bd) { bd = d; b = c; } } return b; };
  const n = near(m);
  // hysteresis: stay on the current note until the pitch is clearly closer to another one
  if (cur !== null && cur !== n && Math.abs(m - cur) < Math.abs(m - n) + 0.18 && (!scale || scale.has(((cur % 12) + 12) % 12))) return cur;
  return n;
}

export function autotune(audio: Float32Array, sr: number, o: AutotuneOpts): AutotuneResult {
  const track = o.track ?? trackPitch(audio, sr);
  const hop = track.hopSec, nF = track.hz.length;
  const scale = o.key ? new Set(scalePcs(o.key)) : null;
  const shift = new Float32Array(nF);
  const voicedF = (f: number) => track.hz[f] > 0 && track.voicedProb[f] > 0.5;
  let voicedFrames = 0;
  const tau = Math.max(0, o.speedMs) / 1000;
  const alpha = tau <= 0 ? 1 : 1 - Math.exp(-hop / tau);
  let f = 0;
  while (f < nF) {
    if (!voicedF(f)) { f++; continue; }
    let e = f;
    while (e < nF && (voicedF(e) || (e + 2 < nF && voicedF(e + 1)) || (e + 3 < nF && voicedF(e + 2)))) e++; // bridge tiny gaps
    const len = e - f;
    // midi per frame (gaps interpolated by holding the last value)
    const m = new Float64Array(len);
    let last = midiOf(track.hz[f]);
    for (let i = 0; i < len; i++) { if (voicedF(f + i)) last = midiOf(track.hz[f + i]); m[i] = last; }
    // slow component (centre of the note) = running mean over ~140 ms; the rest is vibrato / micro-movement
    const half = Math.max(1, Math.round(0.07 / hop));
    const slow = new Float64Array(len);
    for (let i = 0; i < len; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - half); k <= Math.min(len - 1, i + half); k++) { s += m[k]; c++; } slow[i] = s / c; }
    let cur: number | null = null;
    let d = 0;
    for (let i = 0; i < len; i++) {
      cur = targetNote(slow[i], scale, cur);
      const want = (cur - slow[i]) * 100 * o.strength * (1 - 0.5 * o.humanize); // cents to move the centre
      d = i === 0 ? want * (alpha < 1 ? alpha : 1) : d + alpha * (want - d);
      const vib = (m[i] - slow[i]) * 100;
      shift[f + i] = d - (1 - o.keepVibrato) * vib;
      voicedFrames++;
    }
    f = e;
  }
  return { audio: psola(audio, sr, track, shift), shiftCents: shift, track, voicedFrames };
}

/** TD-PSOLA with grains on the original timeline. */
export function psola(x: Float32Array, sr: number, track: PitchTrack, shiftCents: ArrayLike<number>): Float32Array {
  const n = x.length, hop = track.hopSec, nF = track.hz.length;
  const acc = new Float32Array(n), wsum = new Float32Array(n), mask = new Float32Array(n);
  const hzAt = (t: number) => { const k = Math.min(nF - 1, Math.max(0, Math.round(t / hop))); return track.hz[k]; };
  const okAt = (t: number) => { const k = Math.min(nF - 1, Math.max(0, Math.round(t / hop))); return track.hz[k] > 0 && track.voicedProb[k] > 0.5; };
  const ratioAt = (t: number) => { const p = t / hop, k = Math.min(nF - 2, Math.max(0, Math.floor(p))), u = p - k; return Math.pow(2, ((shiftCents[k] ?? 0) * (1 - u) + (shiftCents[k + 1] ?? 0) * u) / 1200); };
  let t = 0;
  while (t < n / sr) {
    if (!okAt(t)) { t += hop; continue; }
    // voiced run [t0, t1]
    const t0 = t;
    while (t < n / sr && (okAt(t) || okAt(t + 2 * hop))) t += hop;
    const t1 = t;
    // analysis marks: one per period, snapped to the local waveform peak
    const marks: { pos: number; T: number }[] = [];
    // each next mark is one period after the previous, nudged to the position where the waveform repeats best (stable phase, no peak hopping)
    let p = Math.round(t0 * sr);
    {
      const T0 = sr / (hzAt(t0) || 150);
      const lo = Math.max(0, Math.round(p - T0 / 4)), hi = Math.min(n - 1, Math.round(p + T0 / 4));
      let bi = p, bv = -1;
      for (let i = lo; i <= hi; i++) if (x[i] > bv) { bv = x[i]; bi = i; }
      p = bi;
    }
    marks.push({ pos: p, T: sr / (hzAt(p / sr) || 150) });
    while (p < t1 * sr) {
      const T = sr / (hzAt(p / sr) || 150);
      const nom = Math.round(p + T), span = Math.max(1, Math.round(T / 6)), len = Math.round(T), stepC = Math.max(1, Math.round(len / 48));
      let best = nom, bc = -Infinity;
      for (let d = -span; d <= span; d++) {
        const q = nom + d;
        if (q - len < 0 || q + len >= n || p - len < 0) continue;
        let c = 0, e1 = 1e-12, e2 = 1e-12;
        for (let k = -len >> 1; k < len >> 1; k += stepC) { const u = x[p + k], v = x[q + k]; c += u * v; e1 += u * u; e2 += v * v; }
        const nc = c / Math.sqrt(e1 * e2);
        if (nc > bc) { bc = nc; best = q; }
      }
      p = best;
      marks.push({ pos: p, T: sr / (hzAt(p / sr) || 150) });
    }
    if (marks.length < 3) continue;
    // synthesis marks: spacing = corrected period, grain taken from the nearest analysis mark
    let s = marks[0].pos, mi = 0;
    while (s < t1 * sr) {
      while (mi + 1 < marks.length && Math.abs(marks[mi + 1].pos - s) <= Math.abs(marks[mi].pos - s)) mi++;
      const mk = marks[mi];
      const L = Math.round(mk.T); // half grain: one period each side
      for (let k = -L; k <= L; k++) {
        const a = mk.pos + k, b = Math.round(s) + k;
        if (a < 0 || a >= n || b < 0 || b >= n) continue;
        const w = 0.5 * (1 + Math.cos((Math.PI * k) / (L + 1)));
        acc[b] += w * x[a]; wsum[b] += w;
      }
      const hz = hzAt(s / sr) || 150;
      s += sr / (hz * ratioAt(s / sr));
    }
    for (let i = Math.max(0, Math.round(t0 * sr)); i < Math.min(n, Math.round(t1 * sr)); i++) mask[i] = 1;
  }
  // smooth the voiced mask (5 ms ramps) and blend: voiced = normalised grains, the rest = the original
  const ramp = Math.max(1, Math.round(0.005 * sr));
  const m2 = new Float32Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) { run = mask[i] ? Math.min(ramp, run + 1) : Math.max(0, run - 1); m2[i] = run / ramp; }
  run = 0;
  for (let i = n - 1; i >= 0; i--) { run = mask[i] ? Math.min(ramp, run + 1) : Math.max(0, run - 1); m2[i] = Math.min(m2[i], run / ramp); }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = wsum[i] > 0.15 ? acc[i] / wsum[i] : x[i];
    out[i] = m2[i] * g + (1 - m2[i]) * x[i];
  }
  return out;
}
