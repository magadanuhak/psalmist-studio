// Real CC0 instruments added after the VSCO / VCSL set (raw sources are extracted by hand into <INSTR_CACHE>/new, outside the project):
//   accordion   FreePats "Button Accordion HN"          https://freepats.zenvoid.org/Organ/accordion.html           (CC0 1.0)
//   nylon_guitar FreePats "Spanish Classical Guitar"    https://freepats.zenvoid.org/Guitar/acoustic-guitar.html    (CC0 1.0)
//   emily_guitar Karoryfer "Emilyguitar"                https://github.com/sfzinstruments/karoryfer.emilyguitar     (CC0-1.0)
//   bigcat_cello Karoryfer x bigcat cello               https://github.com/sfzinstruments/karoryfer-bigcat.cello    (CC0-1.0)
// usage: node scripts/instruments/build-extra.mjs [id ...]   (trim, level, loop, encode to mp3 + manifest.json; then run tune-samples / clarity)
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, OUT, decode, encodeMp3, pool } from './lib.mjs';

const SR = 44100;
const NEW = path.join(CACHE, 'new');
const only = process.argv.slice(2);
const PCS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const noteOf = (s) => { const m = /^([a-g])([#b]?)(-?\d)$/i.exec(s); return m ? (+m[3] + 1) * 12 + PCS[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null; };
const rmsOf = (a, n) => { let s = 0; const e = Math.min(a.length, n); for (let i = 0; i < e; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, e)); };
const peakOf = (a) => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
const ls = (d, re) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => re.test(f)) : []);

function trimStart(a) {
  const thr = Math.max(peakOf(a) * 0.0056, 1e-5); let i = 0;
  for (; i < a.length; i++) if (Math.abs(a[i]) > thr) break;
  return a.subarray(Math.max(0, i - Math.round(0.008 * SR)));
}
/** cut to maxSec (or to the source's own loop end), fade; with a loop: crossfade the end into the loop start */
function shape(a, { maxSec, loop }) {
  let n = Math.min(a.length, Math.floor(maxSec * SR));
  let out = Float32Array.from(a.subarray(0, n)); let res;
  if (loop) {
    n = Math.min(n, Math.floor(loop[1] * SR));
    let lsn = Math.floor(loop[0] * SR);
    if (lsn > n - Math.floor(0.4 * SR) || lsn < 0) lsn = Math.floor(Math.max(0.5, n / SR * 0.4) * SR); // the source's own loop point does not fit the trimmed sample: loop its second half
    out = out.subarray(0, n);
    const xn = Math.min(Math.floor(0.2 * SR), Math.floor((n - lsn) * 0.45), Math.floor(lsn * 0.5));
    for (let i = 0; i < xn; i++) { const w = (i + 1) / xn; out[n - xn + i] = out[n - xn + i] * (1 - w) + out[lsn - xn + i] * w; }
    res = { data: out, dur: n / SR, loopStart: +(lsn / SR).toFixed(4), loopEnd: +(n / SR).toFixed(4) };
  } else {
    const fn = Math.min(n, Math.floor(0.25 * SR));
    for (let i = 0; i < fn; i++) { const g = 1 - (i + 1) / fn; out[n - fn + i] *= g * g; }
    res = { data: out, dur: n / SR };
  }
  return res;
}

/** parse "<region> sample=... pitch_keycenter=N tune=T loop_start=a loop_end=b" lines of the accordion preset */
function accordionItems() {
  const dir = path.join(NEW, 'x-accordion', fs.readdirSync(path.join(NEW, 'x-accordion'))[0]);
  const txt = fs.readFileSync(path.join(dir, 'PRESET Button Accordion HN tuned.sfz'), 'utf8').replace(/\r/g, '').split('\n');
  const items = [];
  for (let i = 0; i < txt.length; i++) {
    const m = /<region>\s+sample=(.+?\.wav)\s+pitch_keycenter=(\d+)/.exec(txt[i]); if (!m) continue;
    if (/_rel.wav/i.test(m[1])) continue; // release noises
    const lp = /loop_start=(\d+)\s+loop_end=(\d+)/.exec(txt[i] + ' ' + (txt[i + 1] ?? ''));
    items.push({ key: +m[2], layer: 0, src: path.join(dir, m[1]), loopSamples: lp ? [+lp[1], +lp[2]] : null });
  }
  return items;
}

const SPECS = {
  accordion: () => ({
    id: 'accordion', name: 'Acordeon (butoane)', family: 'folk', genres: ['popular', 'cantare', 'pop', 'worship'], stereo: false,
    source: { library: 'FreePats Button Accordion HN (Hohner, recorded by Jeff Stauffer 2023)', url: 'https://freepats.zenvoid.org/Organ/accordion.html' },
    def: 'sus', release: 0.25,
    arts: { sus: { loop: true, nLayers: 1, maxSec: 6, items: accordionItems() } },
  }),
  nylon_guitar: () => {
    const d = path.join(NEW, 'x-nylon', 'samples');
    return {
      id: 'nylon_guitar', name: 'Chitară clasică', family: 'guitars', genres: ['cantare', 'popular', 'worship', 'pop'], stereo: false,
      source: { library: 'FreePats Spanish Classical Guitar (roberto@zenvoid.org, 2008)', url: 'https://freepats.zenvoid.org/Guitar/acoustic-guitar.html' },
      def: 'pick', release: 0.5,
      arts: { pick: { loop: false, nLayers: 1, maxSec: 6, items: ls(d, /\.flac$/).map((f) => ({ key: noteOf(f.replace('.flac', '')), layer: 0, src: path.join(d, f) })) } },
    };
  },
  emily_guitar: () => {
    const d = path.join(NEW, 'x-emilyguitar', 'Emilyguitar', 'notes');
    const L = { p: 0, mf: 1, f: 2 }; // p / mp / mf / f -> 3 layers (mp skipped)
    const items = [];
    for (const f of ls(d, /_rr1\.wav$/)) { const m = /^([a-g][b#]?\d)_(p|mp|mf|f)_rr1\.wav$/.exec(f); if (m && m[2] in L) items.push({ key: noteOf(m[1]), layer: L[m[2]], src: path.join(d, f) }); }
    return {
      id: 'emily_guitar', name: 'Chitară acustică, ton cald (Emily)', family: 'guitars', genres: ['worship', 'pop', 'cantare', 'popular'], stereo: false,
      source: { library: 'Karoryfer Samples Emilyguitar (2014)', url: 'https://github.com/sfzinstruments/karoryfer.emilyguitar' },
      def: 'pick', release: 0.35, arts: { pick: { loop: false, nLayers: 3, maxSec: 4, items } },
    };
  },
  bigcat_cello: () => {
    const base = path.join(NEW, 'x-bigcat-cello', 'Karoryfer_Bigcat_cello', 'Samples');
    const L = { p: 0, mf: 1, f: 2 };
    const art = (dir, re, loop, maxSec) => {
      const items = [];
      for (const f of ls(path.join(base, dir), /\.wav$/)) { const m = re.exec(f); if (m && m[2] in L) items.push({ key: noteOf(m[1]) + 12, layer: L[m[2]], src: path.join(base, dir, f) }); } // the library labels its cello an octave low (audit: every sample sounds +1 octave)
      return { loop, nLayers: 3, maxSec, items };
    };
    return {
      id: 'bigcat_cello', name: 'Violoncel solo (Bigcat)', family: 'strings', genres: ['worship', 'pop', 'cantare', 'popular', 'imn'], stereo: false,
      source: { library: 'Karoryfer x bigcat cello (2014)', url: 'https://github.com/sfzinstruments/karoryfer-bigcat.cello' },
      def: 'sus', release: 0.3,
      arts: { sus: art('sus', /^([A-Ga-g][b#]?\d)_(p|mp|mf|f)_d\.wav$/, true, 5), stac: art('staccato', /^([A-Ga-g][b#]?\d)_(p|mp|mf|f)_1\.wav$/, false, 1.2), pizz: { loop: false, nLayers: 1, maxSec: 2.5, items: ls(path.join(base, 'pizzcato'), /_1\.wav$/).map((f) => ({ key: noteOf(f.split('_')[0]) + 12, layer: 0, src: path.join(base, 'pizzcato', f) })) } },
    };
  },
};

async function build(s) {
  const dir = path.join(OUT, s.id); fs.rmSync(dir, { recursive: true, force: true });
  const ch = 1, kbps = 96; const jobs = [];
  for (const [an, a] of Object.entries(s.arts)) for (const it of a.items) if (it.key != null) jobs.push({ an, a, ...it });
  await pool(jobs, 4, async (j) => {
    const raw = await decode(j.src, SR, ch);
    // loop points of the source are in its own sample rate; the decode resamples to 44.1 k
    const info = j.loopSamples ? j.loopSamples.map((x) => x / 44100) : null;
    const t = trimStart(raw);
    const shift = (raw.length - t.length) / SR;
    j.shaped = shape(t, { maxSec: j.a.maxSec, loop: j.a.loop && info ? [info[0] - shift, info[1] - shift] : j.a.loop && t.length / SR >= 1.7 ? [Math.max(0.9, (t.length / SR) * 0.42), Math.min(j.a.maxSec, t.length / SR)] : null });
    j.rms = rmsOf(j.shaped.data, SR * 1.5);
  });
  const groups = {};
  for (const j of jobs) (groups[j.an + ':' + j.layer] ||= []).push(j);
  for (const g of Object.values(groups)) { const med = g.map((j) => j.rms).sort((a, b) => a - b)[Math.floor(g.length / 2)]; for (const j of g) j.g = Math.min(1.58, Math.max(0.63, med / Math.max(j.rms, 1e-6))); }
  let peak = 0; const rr = [];
  for (const j of jobs) { peak = Math.max(peak, peakOf(j.shaped.data) * j.g); rr.push(j.rms * j.g); }
  rr.sort((a, b) => a - b);
  const G = Math.min(0.89 / Math.max(peak, 1e-6), 0.126 / (rr[Math.floor(rr.length / 2)] || 0.05));
  const meta = {}; for (const [an, a] of Object.entries(s.arts)) meta[an] = { loop: !!a.loop, nLayers: a.nLayers, samples: [] };
  let bytes = 0;
  await pool(jobs, 4, async (j) => {
    const d = j.shaped.data, g = j.g * G; for (let i = 0; i < d.length; i++) d[i] *= g;
    const name = `${j.an}/${j.key}_${j.layer}.mp3`;
    bytes += await encodeMp3(d, SR, ch, path.join(dir, name), kbps);
    const e = { key: j.key, layers: [j.layer], file: name, dur: +j.shaped.dur.toFixed(4) };
    if (j.shaped.loopStart != null) { e.loopStart = j.shaped.loopStart; e.loopEnd = j.shaped.loopEnd; }
    meta[j.an].samples.push(e);
  });
  for (const a of Object.values(meta)) a.samples.sort((x, y) => x.key - y.key || x.layers[0] - y.layers[0]);
  const keys = jobs.map((j) => j.key); const nL = Math.max(...Object.values(s.arts).map((a) => a.nLayers));
  const BOUNDS = { 1: [1], 2: [0.62, 1], 3: [0.4, 0.75, 1] };
  const files = new Set(jobs.map((j) => j.src)).size;
  const manifest = { id: s.id, name: s.name, family: s.family, kind: 'pitched', tier: 'A', version: 1, genres: s.genres, license: 'CC0-1.0', attribution: null,
    source: { library: s.source.library, url: s.source.url, files }, stereo: false, sampleRate: SR, range: [Math.min(...keys), Math.max(...keys)], release: s.release,
    layers: BOUNDS[nL], defaultArticulation: s.def, articulations: meta, bytes };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const idxFile = path.join(OUT, 'index.json'); const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  index[s.id] = { manifest: `${s.id}/manifest.json`, bytes, files: jobs.length + 1 };
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));
  console.log(s.id.padEnd(14), String(jobs.length).padStart(4), 'samples', (bytes / 1e6).toFixed(1).padStart(5), 'MB, keys', Math.min(...keys), '-', Math.max(...keys));
}

for (const id of Object.keys(SPECS)) if (!only.length || only.includes(id)) await build(SPECS[id]());
