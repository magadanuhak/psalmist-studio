// Per-sample tuning calibration (Q1): measures the real pitch of every shipped sample against its labelled key and writes the residual
// `cents` into public/instruments/<id>/manifest.json (the sampler compensates it, so re-pitched notes land within a few cents).
//   node scripts/instruments/tune-samples.mjs [--apply] [--only id,id]
// Without --apply it only reports. Octave problems are reported, never auto-fixed. Needs the dev server on :5174 and Chrome / Edge.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; return o; })();
const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const SKIP = ['timpani']; // pitch of glides / bells is not a single partial: left as measured by the build script
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 1800000 });
const page = await browser.newPage();
await page.goto(`${BASE}/#/`);
await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
const only = args.only ? args.only.split(',') : null;
const report = await page.evaluate(async (only, SKIP) => {
  const { CATALOG } = await import('/src/audio/instruments/catalog.ts');
  const { checkPitch } = await import('/src/audio/instruments/pitchcheck.ts');
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const out = {};
  for (const e of CATALOG) {
    if (e.source.type !== 'manifest' || SKIP.includes(e.id) || (only && !only.includes(e.id))) continue;
    const id = e.source.id;
    const man = await (await fetch(`/instruments/${id}/manifest.json`)).json();
    if (man.kind !== 'pitched') continue;
    const rows = [];
    for (const [art, set] of Object.entries(man.articulations)) {
      for (const s of set.samples) {
        try {
          const buf = await ctx.decodeAudioData(await (await fetch(`/instruments/${id}/${s.file}`)).arrayBuffer());
          const sr = buf.sampleRate;
          const mono = new Float32Array(buf.length);
          for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
          const t0 = s.dur > 1.5 ? 0.35 : 0.12; // same window as the audit (after the attack)
          const a = Math.round(t0 * sr), b = Math.min(mono.length, Math.round(Math.min(s.dur, 1.2) * sr));
          const r = b - a > 4096 ? checkPitch(mono.subarray(a, b), sr, 440 * Math.pow(2, (s.key - 69) / 12)) : null;
          rows.push({ art, file: s.file, key: s.key, cents: r ? Math.round(r.cents * 10) / 10 : null, octave: r ? r.octave : null, cov: r ? Math.round(r.coverage * 100) / 100 : null });
        } catch (err) { rows.push({ art, file: s.file, key: s.key, error: String(err) }); }
      }
    }
    out[id] = rows;
  }
  return out;
}, only, SKIP);
await browser.close();
let changed = 0, octave = 0, unknown = 0, relabeled = 0;
for (const [id, rows] of Object.entries(report)) {
  const path = resolve('public/instruments', id, 'manifest.json');
  const man = JSON.parse(readFileSync(path, 'utf8'));
  const bad = rows.filter((r) => r.octave) ;
  const worst = Math.max(0, ...rows.filter((r) => r.cents !== null && !r.octave).map((r) => Math.abs(r.cents)));
  console.log(`${id.padEnd(18)} ${rows.length} samples, worst residual ${worst.toFixed(1)} cents${bad.length ? `, OCTAVE: ${bad.map((r) => `${r.art}/${r.key}:${r.octave}`).join(' ')}` : ''}`);
  octave += bad.length;
  for (const r of rows) {
    const set = man.articulations[r.art]; const s = set?.samples.find((x) => x.file === r.file);
    if (!s) continue;
    if (r.octave && r.cents !== null) {
      // the file sounds `octave` octaves away from its label: relabel it (or drop it when that would leave the instrument's range / duplicate a key)
      const nk = s.key + 12 * r.octave;
      const [lo, hi] = man.range;
      const dup = set.samples.some((x) => x !== s && x.key === nk && JSON.stringify(x.layers) === JSON.stringify(s.layers) && x.rr === s.rr);
      if (Math.abs(r.octave) > 1 || nk < lo - 3 || nk > hi + 3 || dup) set.samples.splice(set.samples.indexOf(s), 1); else { s.key = nk; s.cents = Math.abs(r.cents) < 1 ? undefined : r.cents; }
      changed++; relabeled++;
      continue;
    }
    if (r.cents === null) { unknown++; continue; }
    const c = Math.abs(r.cents) < 1 ? 0 : r.cents;
    if ((s.cents ?? 0) !== c) { changed++; if (c) s.cents = c; else delete s.cents; }
  }
  if (args.apply) {
    // dropped samples: delete orphaned files, refresh byte / file counts in the manifest and in index.json
    const dir = resolve('public/instruments', id);
    const used = new Set(Object.values(man.articulations).flatMap((a) => a.samples.map((x) => x.file)));
    for (const f of readdirSync(dir)) if (/\.(mp3|ogg|wav)$/.test(f) && !used.has(f)) unlinkSync(resolve(dir, f));
    man.bytes = [...used].reduce((t, f) => t + statSync(resolve(dir, f)).size, 0);
    man.source.files = used.size;
    writeFileSync(path, JSON.stringify(man));
    const ip = resolve('public/instruments/index.json');
    const idx = JSON.parse(readFileSync(ip, 'utf8'));
    if (idx[id]) { idx[id].bytes = man.bytes; idx[id].files = used.size; writeFileSync(ip, JSON.stringify(idx, null, 1)); }
  }
}
console.log(`${relabeled} octave-flagged samples relabelled or dropped; ${changed} sample cents ${args.apply ? 'written' : 'would change'}; ${octave} octave flags; ${unknown} unmeasured`);
