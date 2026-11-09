// Share of spectral energy above 4 kHz in the first 0.6 s of the notes of an instrument (steel strings: much more than nylon).
import fs from 'node:fs';
import path from 'node:path';
import { OUT, decode } from './lib.mjs';
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(ang * k), wi = Math.sin(ang * k); const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } }
}
function hiRatio(x, sr) {
  const N = 4096; let hi = 0, tot = 0;
  for (let s0 = 0; s0 + N <= Math.min(x.length, Math.floor(0.6 * sr)); s0 += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; tot += p; if ((k * sr) / N > 4000) hi += p; }
  }
  return hi / Math.max(tot, 1e-12);
}
for (const id of process.argv.slice(2)) {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, id, 'manifest.json'), 'utf8'));
  const r = [];
  for (const a of Object.values(m.articulations)) for (const s of a.samples.filter((x) => x.key >= 48 && x.key <= 72).slice(0, 8)) r.push(hiRatio(await decode(path.join(OUT, id, s.file), 44100, 1), 44100));
  console.log(id.padEnd(14), 'energy above 4 kHz:', (10 * Math.log10(r.reduce((a, b) => a + b, 0) / r.length)).toFixed(1) + ' dB re total', `(${r.length} notes)`);
}
