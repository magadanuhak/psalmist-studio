/** Synthetic voice-like signals for tests and tooling (deterministic, seeded). */
import type { KeySig } from '../model/types';
import { MAJOR_SCALE, MINOR_SCALE, HARMONIC_MINOR } from '../music/theory';

export interface GtNote { midi: number; start: number; dur: number }

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A plausible sung melody: starts/ends on tonic, stepwise motion, phrase rests. */
export function makeMelody(
  rng: () => number, key: KeySig, bpm: number, targetSec: number, harmonic = false,
): GtNote[] {
  const sc = key.mode === 'major' ? MAJOR_SCALE : harmonic ? HARMONIC_MINOR : MINOR_SCALE;
  // scale pitches over ~2 octaves around G3..G4
  const base = 48 + key.tonic;
  const pitches: number[] = [];
  for (let o = 0; o < 3; o++) for (const s of sc) pitches.push(base + 12 * o + s);
  const lo = 53, hi = 72;
  const usable = pitches.filter((p) => p >= lo && p <= hi);
  const beat = 60 / bpm;
  const tonicIdx = usable.findIndex((p) => (p - key.tonic) % 12 === 0 && p >= 57);
  let idx = tonicIdx >= 0 ? tonicIdx : 0;
  const notes: GtNote[] = [];
  let t = 0.3;
  const durs = [0.5, 1, 1, 1, 1.5, 2];
  let count = 0;
  const isTonicOrFifth = (i: number) => {
    const r = (usable[i] - key.tonic + 120) % 12;
    return r === 0 || r === 7;
  };
  while (t < targetSec - 2 * beat * 2) {
    const d = durs[Math.floor(rng() * durs.length)] * beat;
    notes.push({ midi: usable[idx], start: t, dur: d });
    t += d;
    count++;
    const phraseEnd = count % 7 === 0;
    if (phraseEnd) {
      // cadence toward a stable degree, then breathe
      let best = idx, bd = 99;
      for (let i = 0; i < usable.length; i++) if (isTonicOrFifth(i) && Math.abs(i - idx) < bd && i !== idx) { bd = Math.abs(i - idx); best = i; }
      idx = best;
      t += (1 + (rng() < 0.4 ? 1 : 0)) * beat;
      continue;
    }
    const r = rng();
    let step = r < 0.18 ? 0 : r < 0.5 ? 1 : r < 0.82 ? -1 : r < 0.9 ? 2 : r < 0.97 ? -2 : (rng() < 0.5 ? 3 : -3);
    // gravity toward tonic/fifth
    if (idx + step < 0 || idx + step >= usable.length) step = -step;
    idx = Math.max(0, Math.min(usable.length - 1, idx + step));
  }
  // final cadence: land on tonic
  let ti = idx, bd = 99;
  for (let i = 0; i < usable.length; i++) {
    if ((usable[i] - key.tonic + 120) % 12 === 0 && Math.abs(i - idx) < bd) { bd = Math.abs(i - idx); ti = i; }
  }
  notes.push({ midi: usable[ti], start: t, dur: 3 * beat });
  return notes;
}

export interface RenderOpts {
  sr: number;
  vibratoCents?: number;
  vibratoHz?: number;
  glideSec?: number;
  totalSec?: number;
  seed?: number;
  /** per-note random intonation error, +-cents */
  detuneCents?: number;
  /** whole-voice tuning offset in cents (singer sharp/flat vs A440) */
  globalCents?: number;
  /** start notes this many cents flat and scoop up */
  scoopCents?: number;
}

export function renderVoice(notes: GtNote[], o: RenderOpts): Float32Array {
  const { sr } = o;
  const vibC = o.vibratoCents ?? 35, vibHz = o.vibratoHz ?? 5.5, glide = o.glideSec ?? 0.05;
  const total = o.totalSec ?? notes[notes.length - 1].start + notes[notes.length - 1].dur + 0.6;
  const n = Math.ceil(total * sr);
  const out = new Float32Array(n);
  const rng = mulberry32((o.seed ?? 1) * 7919);
  const vibPhase0 = rng() * 6.28;
  let phase = 0;
  let ni = 0;
  const detune = notes.map(() => (rng() * 2 - 1) * (o.detuneCents ?? 0));
  const NH = 12;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (ni + 1 < notes.length && t >= notes[ni + 1].start) ni++;
    const note = notes[ni];
    if (t < note.start || t > note.start + note.dur + 0.05) { phase += 0; continue; }
    const prev = ni > 0 ? notes[ni - 1] : null;
    const legato = prev && note.start - (prev.start + prev.dur) < 0.02;
    const tin = t - note.start;
    let midi = note.midi;
    if (legato && tin < glide) {
      const u = tin / glide;
      const s = u * u * (3 - 2 * u);
      midi = prev!.midi + (note.midi - prev!.midi) * s;
    }
    const vibRamp = Math.min(1, Math.max(0, (tin - 0.15) / 0.2));
    const scoop = o.scoopCents ? -o.scoopCents * Math.exp(-tin / 0.06) * (legato ? 0 : 1) : 0;
    const cents = vibC * vibRamp * Math.sin(2 * Math.PI * vibHz * t + vibPhase0) + detune[ni] + scoop + (o.globalCents ?? 0);
    const f0 = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
    phase += (2 * Math.PI * f0) / sr;
    // envelope
    const tout = note.start + note.dur - t;
    let env = Math.min(1, tin / 0.025) * Math.min(1, Math.max(0, (tout + 0.03) / 0.05));
    if (legato && (prev!.midi === note.midi || ni % 2 === 0)) {
      env *= 1 - 0.65 * Math.exp(-((tin / 0.03) ** 2));
    }
    if (tout < -0.0) env *= Math.max(0, 1 + tout / 0.05);
    let s = 0;
    for (let h = 1; h <= NH; h++) {
      const fh = f0 * h;
      if (fh > sr * 0.45) break;
      const a = (1 / Math.pow(h, 1.1)) * (1 + 2 * Math.exp(-(((fh - 700) / 400) ** 2)));
      s += a * Math.sin(h * phase);
    }
    out[i] = 0.25 * env * s;
  }
  return out;
}

export function rmsOver(x: Float32Array, a = 0, b = x.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

export function makeNoise(n: number, kind: 'white' | 'pink', seed: number): Float32Array {
  const rng = mulberry32(seed);
  const g = () => {
    const u = Math.max(1e-9, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out = new Float32Array(n);
  if (kind === 'white') { for (let i = 0; i < n; i++) out[i] = g(); return out; }
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = g();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
  }
  return out;
}

/** Add noise so voiced-region SNR equals snrDb. */
export function addNoise(clean: Float32Array, notes: GtNote[], sr: number, snrDb: number, kind: 'white' | 'pink', seed: number): Float32Array {
  let s = 0, c = 0;
  for (const nt of notes) {
    const a = Math.floor((nt.start + 0.05) * sr), b = Math.min(clean.length, Math.floor((nt.start + nt.dur - 0.03) * sr));
    for (let i = a; i < b; i++) { s += clean[i] * clean[i]; c++; }
  }
  const sigRms = Math.sqrt(s / Math.max(1, c));
  const noise = makeNoise(clean.length, kind, seed);
  const nr = rmsOver(noise);
  const g = (sigRms / Math.pow(10, snrDb / 20)) / nr;
  const out = new Float32Array(clean.length);
  for (let i = 0; i < out.length; i++) out[i] = clean[i] + noise[i] * g;
  return out;
}
