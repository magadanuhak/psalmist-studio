// Convert cached CC0 sources into trimmed / levelled / looped mp3 sample sets + manifest.json per instrument.
// usage: node scripts/instruments/build.mjs [id ...]
import fs from 'node:fs';
import path from 'node:path';
import { plan } from './plan.mjs';
import { CACHE, OUT, REPOS, cachePath, decode, encodeMp3, pool } from './lib.mjs';

const SR = 44100;
const LAYER_BOUNDS = { 1: [1], 2: [0.62, 1], 3: [0.4, 0.75, 1] };
const only = process.argv.slice(2);
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

function peakOf(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
function rmsOf(a, n) { let s = 0; const e = Math.min(a.length, n); for (let i = 0; i < e; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, e)); }

function trimStart(a, ch) {
  const pk = peakOf(a); const thr = Math.max(pk * 0.0056, 1e-5);
  let i = 0; for (; i < a.length; i += ch) { let m = 0; for (let c = 0; c < ch; c++) m = Math.max(m, Math.abs(a[i + c])); if (m > thr) break; }
  const s = Math.max(0, Math.floor(i / ch) - Math.round(0.008 * SR)) * ch;
  return a.subarray(s);
}

function monoSeg(a, ch, t0, t1) {
  const s = Math.floor(t0 * SR), e = Math.min(Math.floor(t1 * SR), a.length / ch); const o = new Float32Array(Math.max(0, e - s));
  for (let i = 0; i < o.length; i++) { let v = 0; for (let c = 0; c < ch; c++) v += a[(s + i) * ch + c]; o[i] = v / ch; }
  return o;
}

// Autocorrelation pitch estimate (timpani fundamentals, 50-300 Hz).
function estimateMidi(a, ch) {
  const x = monoSeg(a, ch, 0.15, 0.65); if (x.length < 8000) return null;
  const minL = Math.floor(SR / 300), maxL = Math.floor(SR / 50); let best = -1, bl = 0; const r = new Float64Array(maxL + 2);
  for (let l = minL - 1; l <= maxL + 1; l++) { let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; r[l] = s; }
  for (let l = minL; l <= maxL; l++) if (r[l] > best && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { best = r[l]; bl = l; }
  if (!bl) return null;
  const d = (r[bl - 1] - r[bl + 1]) / (2 * (r[bl - 1] - 2 * r[bl] + r[bl + 1]) || 1);
  const f = SR / (bl + d); return Math.round(69 + 12 * Math.log2(f / 440));
}

/** Cut to maxSec, fade, optionally bake a crossfaded loop. Returns { data, dur, loopStart?, loopEnd? }. */
function shape(a, ch, { maxSec, loop }) {
  let n = Math.min(a.length / ch, Math.floor(maxSec * SR));
  const truncated = n < a.length / ch;
  let out = Float32Array.from(a.subarray(0, n * ch));
  const dur = n / SR; let res = { data: out, dur };
  if (loop && dur >= 1.7) {
    const ls = Math.max(0.9, dur * 0.42); const xf = Math.min(0.3, (dur - ls) * 0.45, ls * 0.5);
    const xn = Math.floor(xf * SR), lsn = Math.floor(ls * SR);
    for (let i = 0; i < xn; i++) {
      const w = (i + 1) / xn; const d = (n - xn + i) * ch, s = (lsn - xn + i) * ch;
      for (let c = 0; c < ch; c++) out[d + c] = out[d + c] * (1 - w) + out[s + c] * w;
    }
    res = { data: out, dur, loopStart: +ls.toFixed(4), loopEnd: +dur.toFixed(4) };
  } else {
    const fn = Math.min(n, Math.floor((truncated ? 0.18 : 0.05) * SR));
    for (let i = 0; i < fn; i++) { const g = 1 - (i + 1) / fn; for (let c = 0; c < ch; c++) out[(n - fn + i) * ch + c] *= g * g; }
  }
  return res;
}

async function buildInstrument(it) {
  const s = it.spec; const ch = it.kind === 'pitched' ? (s.stereo ? 2 : 1) : 1;
  const kbps = ch === 2 ? 160 : 96;
  const dir = path.join(OUT, s.id); fs.rmSync(dir, { recursive: true, force: true });
  const jobs = []; // {art, key, layers, rr, src, shapeOpts}
  const artMeta = {};
  if (it.kind === 'pitched') {
    for (const [an, a] of Object.entries(it.arts)) {
      artMeta[an] = { loop: !!a.loop, nLayers: a.nLayers, samples: [] };
      for (const c of a.chosen) jobs.push({ art: an, key: c.note, layers: c.layers, drum: c.f.drum, src: c.f.p, opts: { maxSec: a.maxSec, loop: a.loop }, level: true });
    }
  } else {
    for (const [hn, h] of Object.entries(it.hits)) {
      artMeta[hn] = { loop: false, nLayers: h.nLayers, samples: [] };
      const cnt = {};
      for (const c of h.chosen) { const k = c.layer; cnt[k] = (cnt[k] || 0) + 1; jobs.push({ art: hn, key: 60, layers: [c.layer], rr: cnt[k], src: c.f.p, opts: { maxSec: hn === 'shake' || s.id === 'cymbal' || s.id === 'concert_bass_drum' ? 4.5 : 2.6, loop: false } }); }
    }
  }
  // decode + shape
  await pool(jobs, 4, async (j) => {
    const raw = await decode(cachePath(s.repo, j.src), SR, ch);
    const t = trimStart(raw, ch);
    if (s.detectPitch) j.key = estimateMidi(t, ch);
    j.shaped = shape(t, ch, j.opts); j.rms = rmsOf(j.shaped.data, SR * 1.5);
  });
  if (s.detectPitch) { // one pitch per drum (median over its files)
    const by = {}; for (const j of jobs) if (j.key != null) (by[j.drum] ||= []).push(j.key);
    for (const j of jobs) { const k = (by[j.drum] || []).sort((a, b) => a - b); j.key = k.length ? k[Math.floor(k.length / 2)] : null; }
  }
  const jobsOk = jobs.filter((j) => j.key != null);
  // level within each (art, layer) group (pitched only), then instrument-wide gain
  if (it.kind === 'pitched') {
    const groups = {};
    for (const j of jobsOk) for (const l of j.layers.slice(0, 1)) (groups[j.art + ':' + l] ||= []).push(j);
    for (const g of Object.values(groups)) {
      const med = g.map((j) => j.rms).sort((a, b) => a - b)[Math.floor(g.length / 2)];
      for (const j of g) j.g = Math.min(1.58, Math.max(0.63, med / Math.max(j.rms, 1e-6)));
    }
  }
  let topRms = [], peak = 0;
  for (const j of jobsOk) { j.g ||= 1; peak = Math.max(peak, peakOf(j.shaped.data) * j.g); topRms.push(j.rms * j.g); }
  topRms.sort((a, b) => a - b);
  const medR = topRms[Math.floor(topRms.length / 2)] || 0.05;
  const G = Math.min(0.89 / Math.max(peak, 1e-6), 0.126 / medR); // peak <= -1 dBFS, median rms about -18 dBFS
  let bytes = 0;
  const files = [];
  await pool(jobsOk, 4, async (j) => {
    const d = j.shaped.data; const g = j.g * G; for (let i = 0; i < d.length; i++) d[i] *= g;
    const name = j.rr ? `${j.art}/L${j.layers[0]}_r${j.rr}.mp3` : `${j.art}/${j.key}_${j.layers.join('')}.mp3`;
    const sz = await encodeMp3(d, SR, ch, path.join(dir, name), kbps);
    bytes += sz; files.push(name);
    const e = { key: j.key, layers: j.layers, file: name, dur: +j.shaped.dur.toFixed(3) };
    if (j.rr) e.rr = j.rr;
    if (j.shaped.loopStart != null) { e.loopStart = j.shaped.loopStart; e.loopEnd = j.shaped.loopEnd; }
    artMeta[j.art].samples.push(e);
  });
  for (const a of Object.values(artMeta)) a.samples.sort((x, y) => x.key - y.key || x.layers[0] - y.layers[0] || (x.rr || 0) - (y.rr || 0));
  const keys = jobsOk.map((j) => j.key);
  const nL = Math.max(...Object.values(artMeta).map((a) => a.nLayers));
  const sourceFiles = [...new Set(jobsOk.map((j) => j.src))];
  const manifest = {
    id: s.id, name: s.name, family: it.kind === 'hits' ? 'percussion' : s.family, kind: it.kind, tier: 'A', version: 1,
    genres: s.genres, license: 'CC0-1.0', attribution: null,
    source: { library: REPOS[s.repo].name, url: `https://github.com/${REPOS[s.repo].slug}`, files: sourceFiles.length },
    stereo: ch === 2, sampleRate: SR, range: [Math.min(...keys), Math.max(...keys)], release: s.release ?? 0.2,
    layers: LAYER_BOUNDS[nL], defaultArticulation: s.def || Object.keys(artMeta)[0], articulations: artMeta, bytes,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  console.log(s.id.padEnd(18), String(files.length).padStart(4), 'files', (bytes / 1e6).toFixed(1).padStart(6), 'MB');
  return { id: s.id, bytes, files: files.length + 1 };
}

const all = await plan();
const sel = all.filter((it) => !only.length || only.includes(it.spec.id));
const idxFile = path.join(OUT, 'index.json');
let index = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
fs.mkdirSync(OUT, { recursive: true });
for (const it of sel) {
  const r = await buildInstrument(it);
  index[r.id] = { manifest: `${r.id}/manifest.json`, bytes: r.bytes, files: r.files };
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));
}
const total = Object.values(index).reduce((s, x) => s + x.bytes, 0);
console.log('TOTAL sampled', (total / 1e6).toFixed(1), 'MB', Object.keys(index).length, 'instruments');
