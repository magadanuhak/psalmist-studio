// Procedural church / room impulse responses (seeded, deterministic). No third-party material (OpenAIR items were
// not used: their licences vary per item and none was verified as CC0 / CC-BY). Output: public/instruments/ir/*.wav
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './lib.mjs';

const SR = 44100;
const SPACES = [
  { id: 'studio', name: 'Studio', rt60: 0.38, len: 0.7, pre: 0.004, early: 6, esize: 0.02, tilt: 0.7, send: 0.08, lowBoost: 1.0 },
  { id: 'capela', name: 'Capelă', rt60: 1.25, len: 2.0, pre: 0.012, early: 10, esize: 0.045, tilt: 0.6, send: 0.16, lowBoost: 1.15 },
  { id: 'biserica', name: 'Biserică', rt60: 2.5, len: 3.6, pre: 0.02, early: 14, esize: 0.075, tilt: 0.5, send: 0.22, lowBoost: 1.25 },
  { id: 'catedrala', name: 'Catedrală', rt60: 5.0, len: 6.5, pre: 0.032, early: 18, esize: 0.12, tilt: 0.42, send: 0.28, lowBoost: 1.35 },
  { id: 'sala', name: 'Sală', rt60: 1.8, len: 2.8, pre: 0.018, early: 12, esize: 0.06, tilt: 0.55, send: 0.18, lowBoost: 1.1 },
];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => { let u = 0; for (let i = 0; i < 4; i++) u += r(); return (u - 2) * 1.732; };
const onepole = (x, fc) => { const a = Math.exp(-2 * Math.PI * fc / SR); const y = new Float32Array(x.length); let z = 0; for (let i = 0; i < x.length; i++) { z = (1 - a) * x[i] + a * z; y[i] = z; } return y; };

function channel(sp, seed) {
  const r = rng(seed), n = Math.floor(sp.len * SR), pre = Math.floor(sp.pre * SR);
  const noise = new Float32Array(n); for (let i = 0; i < n; i++) noise[i] = gauss(r);
  const lp1 = onepole(noise, 700), lp2 = onepole(noise, 3500);
  const out = new Float32Array(n);
  const k = (rt) => 6.9078 / rt; // 60 dB
  const kL = k(sp.rt60 * sp.lowBoost), kM = k(sp.rt60), kH = k(sp.rt60 * sp.tilt);
  const fade = Math.floor(0.02 * SR);
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / SR, ramp = Math.min(1, (i - pre) / fade) ** 2;
    const lo = lp1[i], mid = lp2[i] - lp1[i], hi = noise[i] - lp2[i];
    out[i] = ramp * (lo * Math.exp(-kL * t) * 1.4 + mid * Math.exp(-kM * t) + hi * Math.exp(-kH * t) * 0.8) * 0.5;
  }
  // early reflections
  for (let e = 0; e < sp.early; e++) {
    const t = sp.pre + 0.003 + r() * sp.esize * 2.2; const idx = Math.floor(t * SR); const g = (0.6 / (1 + e * 0.35)) * (r() < 0.5 ? -1 : 1);
    for (let j = 0; j < 6 && idx + j < n; j++) out[idx + j] += g * Math.exp(-j * 0.7) * 6; // short smeared tap
  }
  const dir = Math.floor(sp.pre * SR); out[dir] += 1.0 * 12; // direct-ish impulse (tiny, convolution keeps dry separate)
  return out;
}

function wav16(chs) {
  const n = chs[0].length, buf = Buffer.alloc(44 + n * 4);
  let pk = 0; for (const c of chs) for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(c[i]));
  const g = 0.92 / pk;
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chs[c][i] * g * 32767))), 44 + (i * 2 + c) * 2);
  return buf;
}

const dir = path.join(OUT, 'ir'); fs.mkdirSync(dir, { recursive: true });
const list = [];
for (const [i, sp] of SPACES.entries()) {
  const file = `${sp.id}.wav`;
  const b = wav16([channel(sp, 1000 + i * 2), channel(sp, 1001 + i * 2)]);
  fs.writeFileSync(path.join(dir, file), b);
  list.push({ id: sp.id, name: sp.name, file, rt60: sp.rt60, preDelay: sp.pre, send: sp.send, bytes: b.length, license: 'CC0-1.0 (generated procedurally by scripts/instruments/ir.mjs)' });
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, sampleRate: SR, spaces: list, attribution: [] }, null, 1));
console.log(list.map((l) => `${l.id} ${(l.bytes / 1e6).toFixed(2)}MB`).join(' | '));
