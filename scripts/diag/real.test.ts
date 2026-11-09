import { test } from 'vitest';
import { readFileSync } from 'fs';
import { trackPitch } from '../../src/dsp/pitch';
test('real voice diag', () => {
  const b = readFileSync('test-audio/real/strofa-curat.wav');
  // minimal WAV parse (PCM16 or float32), mono mixdown
  let p = 12, fmt: any = null, data: Buffer | null = null;
  while (p < b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { af: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + sz); p += 8 + sz + (sz & 1); }
  const bps = fmt.bits / 8, n = data!.length / bps / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) { const o = (i * fmt.ch + c) * bps; s += fmt.af === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; } x[i] = s / fmt.ch; }
  const pt = trackPitch(x, fmt.sr);
  const cents: number[] = []; const hist = new Array(12).fill(0); let lo = 1e9, hi = 0;
  for (let i = 0; i < pt.hz.length; i++) { const f = pt.hz[i]; if (!f || pt.voicedProb[i] < 0.5) continue; const m = 69 + 12 * Math.log2(f / 440); cents.push((m - Math.round(m)) * 100); hist[((Math.round(m) % 12) + 12) % 12]++; lo = Math.min(lo, f); hi = Math.max(hi, f); }
  // circular mean of cents offset
  let sx = 0, sy = 0; for (const c of cents) { const a = (c / 100) * 2 * Math.PI; sx += Math.cos(a); sy += Math.sin(a); }
  const off = (Math.atan2(sy, sx) / (2 * Math.PI)) * 100, R = Math.hypot(sx, sy) / cents.length;
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  console.log(JSON.stringify({ sr: fmt.sr, durSec: +(n / fmt.sr).toFixed(2), voicedFrames: cents.length, hzRange: [+lo.toFixed(1), +hi.toFixed(1)], tuningOffsetCents: +off.toFixed(1), concentration: +R.toFixed(2), pcHist: Object.fromEntries(names.map((k, i) => [k, hist[i]])) }));
});
