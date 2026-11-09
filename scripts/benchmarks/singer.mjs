// Realistic synthetic singer for the ground-truth benchmarks (classic DSP only): glottal pulse source -> vowel formant resonators,
// vibrato ~5.5 Hz +-30 cents after ~200 ms, onset scoops, timing jitter +-30 ms, a small global detune, breaths, room noise at ~30 dB SNR.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SONGS = (() => { const j = JSON.parse(readFileSync(fileURLToPath(new URL('./songs.json', import.meta.url)), 'utf8')); delete j._doc; return j; })();

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteMidi = (n) => { const m = /^([A-G])(#|b)?(-?\d)$/.exec(n); return NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1); };
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** seconds per eighth note for a song. */
export const eighthSec = (s, tempoScale = 1) => 60 / (s.bpm * tempoScale * (s.compound ? 3 : 2));

/** Truth timing: bar-line times (s), chord per bar, note list. opts: { bars (excerpt length), lead, tempoScale }. */
export function truthOf(song, opts = {}) {
  const lead = opts.lead ?? 1.0, e8 = eighthSec(song, opts.tempoScale ?? 1);
  const nBars = Math.min(opts.bars ?? song.chords.length, song.chords.length);
  const barSec = e8 * song.eighths;
  const bars = Array.from({ length: nBars }, (_, k) => lead + (song.pickup + k * song.eighths) * e8);
  const notes = []; let u = 0;
  for (const [n, d] of song.melody) { if (n !== 'R') notes.push({ name: n, midi: noteMidi(n), u, d }); u += d; }
  const endU = song.pickup + nBars * song.eighths;
  return { lead, e8, barSec, bars, chords: song.chords.slice(0, nBars), notes: notes.filter((x) => x.u < endU), totalSec: lead + endU * e8 + 1.2 };
}

const VOWELS = { a: [700, 1220, 2600], o: [450, 800, 2830], e: [530, 1840, 2480], u: [325, 700, 2530] };
const VOWEL_ORDER = 'aoeau';
const BW = [80, 90, 120];
const LF_GAIN = Number(process.env.LF_GAIN ?? 10);

/** @param opts { register: 'male'|'female', bars, seed, snrDb, detuneCents, jitterMs, tempoScale, noise } -> { samples: Float32Array, sr, truth } */
export function sing(song, opts = {}) {
  const sr = 44100, R = rng(opts.seed ?? 7), gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += R(); return (s - 2) / 0.577; };
  const truth = truthOf(song, opts);
  const female = opts.register === 'female';
  // whole-octave transposition into the register: male B2..E4 (47..64), female A3..A5 (57..81)
  const [lo, hi] = female ? [57, 81] : [47, 64];
  const ms = truth.notes.map((n) => n.midi), mid = (Math.min(...ms) + Math.max(...ms)) / 2, cen = (lo + hi) / 2;
  const shift = 12 * Math.round((cen - mid) / 12);
  const detune = (opts.detuneCents ?? -14) / 100, jit = (opts.jitterMs ?? 30) / 1000;
  const formScale = female ? 1.18 : 1.0;
  const out = new Float32Array(Math.ceil(truth.totalSec * sr));
  const events = truth.notes.map((n, i) => ({ ...n, midi: n.midi + shift, t0: truth.lead + n.u * truth.e8 + Math.max(-jit, Math.min(jit, gauss() * jit * 0.55)), dur: n.d * truth.e8, vowel: VOWEL_ORDER[i % 5], amp: 0.8 + 0.2 * R() }));
  // legato: a note that directly follows another glides from it; long notes at a phrase end are cut a little and a breath may follow
  for (let i = 0; i < events.length; i++) {
    const e = events[i], nx = events[i + 1];
    e.legatoNext = !!nx && nx.u === e.u + e.d && e.d < 6;
    e.end = e.t0 + e.dur * (e.legatoNext ? 0.97 : e.d >= 6 ? 0.88 : 0.94);
    if (nx) e.end = Math.min(e.end, nx.t0 + (e.legatoNext ? 0.03 : -0.015));
    if (nx && nx.midi === e.midi) e.end = Math.min(e.end, nx.t0 - 0.08); // a repeated syllable is articulated: a real gap, not a legato slur
  }
  const breaths = [];
  events.forEach((e, i) => { const nx = events[i + 1]; if (nx && e.d >= 6 && i % 2 === 1 && nx.t0 - e.end > 0.17) breaths.push({ t: e.end + 0.03, dur: Math.min(0.28, nx.t0 - e.end - 0.06) }); });
  const state = { ph: 0, y: [[0, 0], [0, 0], [0, 0]], f: [...VOWELS.a], vib: R() * 6, lp: 0, lf: 0 };
  const res = (f, bw) => { const r = Math.exp(-Math.PI * bw / sr), c = -r * r, b = 2 * r * Math.cos(2 * Math.PI * f / sr), a = 1 - b - c; return { a, b, c }; };
  let k = state.f.map((f, j) => res(f, BW[j])), step = 0;
  for (let ei = 0; ei < events.length; ei++) {
    const e = events[ei], prev = events[ei - 1];
    const i0 = Math.max(0, Math.floor((e.t0 - 0.012) * sr)), i1 = Math.min(out.length, Math.floor((e.end + 0.06) * sr));
    const target = VOWELS[e.vowel];
    for (let i = i0; i < i1; i++) {
      const t = i / sr, tn = t - e.t0;
      let cents = 0;
      if (tn < 0.09) cents -= 70 * Math.pow(1 - Math.max(0, tn) / 0.09, 2);   // scoop up into the note
      let midi = e.midi;
      if (prev && prev.legatoNext && tn < 0.05) { const w = Math.max(0, tn) / 0.05; midi = prev.midi * (1 - w) + e.midi * w; cents = 0; }
      const vibDepth = tn < 0.2 ? 0 : Math.min(1, (tn - 0.2) / 0.3) * 30;        // vibrato starts after ~200 ms
      state.vib += (2 * Math.PI * (5.5 + 0.25 * Math.sin(t * 0.7))) / sr;
      cents += vibDepth * Math.sin(state.vib) + 3 * Math.sin(t * 13.1);
      const f0 = 440 * Math.pow(2, (midi + detune - 69) / 12 + cents / 1200);
      state.ph += f0 / sr; if (state.ph >= 1) state.ph -= 1;
      const p = state.ph;
      const g = p < 0.6 ? 0.5 * Math.sin((Math.PI * p) / 0.6) * (Math.PI / 0.6) : p < 0.8 ? -Math.sin((Math.PI * (p - 0.6)) / 0.2) * (Math.PI / 0.2) * 0.6 : 0;
      // flow + its derivative: a real chest voice keeps a strong fundamental (the derivative alone is all upper harmonics)
      const flow = p < 0.6 ? 0.5 * (1 - Math.cos((Math.PI * p) / 0.6)) : p < 0.8 ? Math.cos((Math.PI * (p - 0.6)) / 0.4) : 0;
      const src = g * 0.25 + (flow - 0.35) * 0.9 + (R() - 0.5) * 0.06;
      if (step++ % 64 === 0) { const w = Math.min(1, Math.max(0, tn) / 0.06); for (let j = 0; j < 3; j++) state.f[j] = state.f[j] * (1 - w) + target[j] * formScale * w; k = state.f.map((f, j) => res(f, BW[j])); }
      state.lp += 0.3 * (src - state.lp); // spectral tilt of a real voice: no sharp glottal edges
      let x = state.lp;
      for (let j = 0; j < 3; j++) { const y = k[j].a * x + k[j].b * state.y[j][0] + k[j].c * state.y[j][1]; state.y[j][1] = state.y[j][0]; state.y[j][0] = y; x = y; }
      state.lf += 0.05 * (src - state.lf);                  // chest resonance: keeps the fundamental strong (H1 close to the formant peak), as in a real low voice
      x += LF_GAIN * state.lf;
      const att = Math.min(1, Math.max(0, tn / 0.03)), rel = Math.min(1, Math.max(0, (e.end + 0.05 - t) / 0.07));
      out[i] += x * att * rel * e.amp * (0.9 + 0.012 * (e.midi - 55));
    }
  }
  let rms = 0, n = 0; for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 1e-4) { rms += out[i] * out[i]; n++; }
  rms = Math.sqrt(rms / Math.max(1, n));
  const gain = 0.18 / (rms || 1); for (let i = 0; i < out.length; i++) out[i] *= gain;
  // breaths: filtered noise bursts under the voice
  for (const b of breaths) { const a = Math.floor(b.t * sr), z = Math.floor(b.dur * sr); let l = 0; for (let i = 0; i < z && a + i < out.length; i++) { const w = Math.sin((Math.PI * i) / z); const nz = R() - 0.5; l += 0.35 * (nz - l); out[a + i] += (nz - l) * 0.16 * w * w; } }
  // room noise: pink-ish, ~30 dB under the voice
  if (opts.noise !== false) {
    const snr = opts.snrDb ?? 30, amp = 0.18 * Math.pow(10, -snr / 20) * 1.7; let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < out.length; i++) { const w = R() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; out[i] += (b0 + b1 + b2 + w * 0.1848) * 0.11 * amp; }
  }
  return { samples: out, sr, truth: { ...truth, shift, register: female ? 'female' : 'male', rangeMidi: [Math.min(...events.map((e) => e.midi)), Math.max(...events.map((e) => e.midi))] } };
}

export function wavBytes(samples, sr) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

const PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** root + major/minor family of a chord name (G7 = G, Am7 = Am) */
export const chordFamily = (c) => { const m = /^([A-G])([#b]?)(.*)$/.exec(c); if (!m) return null; return { root: (PCS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, minor: /^(m(?!aj)|min|dim)/.test(m[3]) }; };
/** acceptable chords of bar i (0-based): the primary plus the alternatives listed in songs.json; X7 counts as X */
export const acceptableAt = (song, i) => [song.chords[i], ...((song.alt ?? {})[String(i + 1)] ?? [])];
export const chordOk = (ref, mine) => { const a = chordFamily(ref), b = chordFamily(mine); return !!a && !!b && a.root === b.root && a.minor === b.minor; };
