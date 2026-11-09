// Generates test-audio/*.wav : a sung-like melody (harmonic voice, vibrato, scoops, slight detune) + noise.
// Usage: node scripts/gen-test-wav.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const SR = 44100;
const BPM = 90;
const beat = 60 / BPM;

// [midi, beats] - C major, 4/4, 8 bars
const MELODY = [
  [60, 1], [64, 1], [67, 1], [64, 1], [69, 2], [67, 2],
  [64, 1], [67, 1], [69, 1], [67, 1], [64, 2], [62, 2],
  [60, 1], [64, 1], [67, 1], [72, 1], [71, 2], [69, 2],
  [67, 1], [64, 1], [62, 1], [64, 1], [60, 4],
];

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());

const notes = [];
let t = 0;
for (const [midi, b] of MELODY) {
  const jitter = (rnd() - 0.5) * 0.05; // +-25 ms human timing
  notes.push({ midi, start: Math.max(0, t + jitter), dur: b * beat - 0.07, detune: (rnd() * 2 - 1) * 20 });
  t += b * beat;
}
const total = t + 1.0;
const n = Math.ceil(total * SR);
const voice = new Float32Array(n);
let phase = 0;
let ni = 0;
for (let i = 0; i < n; i++) {
  const tt = i / SR;
  while (ni + 1 < notes.length && tt >= notes[ni + 1].start) ni++;
  const nt = notes[ni];
  const tin = tt - nt.start, tout = nt.start + nt.dur - tt;
  if (tin < 0 || tout < -0.04) continue;
  const prev = ni > 0 ? notes[ni - 1] : null;
  let midi = nt.midi;
  if (prev && tin < 0.06) { const u = tin / 0.06; midi = prev.midi + (nt.midi - prev.midi) * u * u * (3 - 2 * u); }
  const vib = 38 * Math.min(1, Math.max(0, (tin - 0.18) / 0.25)) * Math.sin(2 * Math.PI * 5.6 * tt);
  const scoop = -45 * Math.exp(-tin / 0.05);
  const f0 = 440 * Math.pow(2, (midi - 69 + (vib + nt.detune + scoop) / 100) / 12);
  phase += (2 * Math.PI * f0) / SR;
  const env = Math.min(1, tin / 0.03) * Math.min(1, Math.max(0, (tout + 0.04) / 0.07));
  let s = 0;
  for (let h = 1; h <= 14; h++) {
    const fh = f0 * h;
    if (fh > SR * 0.45) break;
    s += (1 / Math.pow(h, 1.1)) * (1 + 2 * Math.exp(-(((fh - 700) / 420) ** 2))) * Math.sin(h * phase);
  }
  voice[i] = 0.22 * env * s;
}

// room noise (~ 22 dB SNR) + a mains hum + two clicks
let rms = 0, c = 0;
for (let i = 0; i < n; i++) if (Math.abs(voice[i]) > 0.01) { rms += voice[i] ** 2; c++; }
rms = Math.sqrt(rms / c);
const noiseAmp = rms / Math.pow(10, 22 / 20);
const out = new Float32Array(n);
for (let i = 0; i < n; i++) out[i] = voice[i] + gauss() * noiseAmp + 0.004 * Math.sin((2 * Math.PI * 50 * i) / SR);
out[Math.floor(6.1 * SR)] += 0.5; out[Math.floor(6.1 * SR) + 1] -= 0.4;
out[Math.floor(14.7 * SR)] += 0.45;

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

mkdirSync('test-audio', { recursive: true });
writeFileSync('test-audio/melody-do-major-90bpm.wav', wav(out));
writeFileSync('test-audio/melody-do-major-90bpm.json', JSON.stringify({ bpm: BPM, key: 'C major', notes }, null, 2));
console.log(`wrote test-audio/melody-do-major-90bpm.wav (${total.toFixed(1)} s, ${notes.length} notes)`);
