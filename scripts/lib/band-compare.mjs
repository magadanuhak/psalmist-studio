// node scripts/lib/band-compare.mjs <our minus.wav> <reference instrumental.wav> <vocal.wav>
// Band deltas (ours minus reference) and the vocal-over-minus margin in 1-4 kHz. Reads files from absolute paths, writes nothing.
import { spawnSync } from 'node:child_process';
const [ours, ref, vocal] = process.argv.slice(2);
const BANDS = [[40, 120], [120, 300], [300, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
const rms = (f, lo, hi) => {
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', f, '-af', `highpass=f=${lo}:p=2,lowpass=f=${hi}:p=2,astats=measure_perchannel=none`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...(r.stderr ?? '').matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].pop();
  return m ? Number(m[1]) : NaN;
};
const out = {};
for (const [lo, hi] of BANDS) out[`${lo}-${hi}`] = +(rms(ours, lo, hi) - rms(ref, lo, hi)).toFixed(1);
console.log('band deltas ours - original instrumental (dB):', JSON.stringify(out));
if (vocal) { const v = rms(vocal, 1000, 4000), m = rms(ours, 1000, 4000); console.log(`1-4 kHz: vocal ${v.toFixed(1)} dB, minus ${m.toFixed(1)} dB, margin ${(v - m).toFixed(1)} dB`); }
