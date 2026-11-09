// Sanity check: estimated f0 vs filename note label -> median octave offset per instrument (prints; does not write).
import { plan } from './plan.mjs';
import { cachePath, decode, pool } from './lib.mjs';
const SR = 22050;
function f0(x) {
  const n = Math.min(x.length, 4096 * 2); if (n < 3000) return null;
  const s = Math.floor(0.25 * SR), seg = x.subarray(s, s + 4096); if (seg.length < 4096) return null;
  const minL = Math.floor(SR / 2000), maxL = Math.floor(SR / 28); const r = new Float64Array(maxL + 2); let e0 = 0; for (let i = 0; i < seg.length; i++) e0 += seg[i] * seg[i];
  if (e0 < 1e-6) return null;
  for (let l = minL; l <= maxL; l++) { let a = 0, e1 = 0; for (let i = 0; i + l < seg.length; i++) { a += seg[i] * seg[i + l]; e1 += seg[i + l] * seg[i + l]; } r[l] = a / Math.sqrt(e0 * e1 + 1e-12); }
  let mx = 0; for (let l = minL; l <= maxL; l++) mx = Math.max(mx, r[l]);
  for (let l = minL + 1; l < maxL; l++) if (r[l] >= 0.9 * mx && r[l] >= r[l - 1] && r[l] >= r[l + 1]) return 69 + 12 * Math.log2(SR / l / 440);
  return null;
}
const pl = (await plan()).filter((i) => i.kind === 'pitched' && !i.spec.detectPitch && i.spec.family !== 'percussion');
for (const it of pl) {
  for (const [an, art] of Object.entries(it.arts)) { const ch = art.chosen.filter((c) => c.note != null);
  const pick = ch.filter((_, i) => i % Math.max(1, Math.floor(ch.length / 7)) === 0).slice(0, 7);
  const offs = [];
  await pool(pick, 4, async (c) => { const x = await decode(cachePath(it.spec.repo, c.f.p), SR, 1); const m = f0(x); if (m != null) offs.push(Math.round(m) - c.note); });
  offs.sort((a, b) => a - b);
  console.log((it.spec.id + '/' + an).padEnd(22), 'notes', ch[0].note + '-' + ch[ch.length - 1].note, 'offsets', offs.join(','));
}}
