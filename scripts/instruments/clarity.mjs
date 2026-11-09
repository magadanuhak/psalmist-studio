// Pitch clarity of every shipped pitched sample: share of voiced frames (pYIN) near the labelled pitch, and spectral flatness (noise-ness).
//   node scripts/instruments/clarity.mjs [--apply] [--min 0.6] [--only id,id]
// --apply writes `clarity` into the manifests and DROPS samples below --min (air-only, flutter, key clicks, effects), pruning their files.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const args = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; return o; })();
const MIN = Number(args.min ?? 0.6);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 1800000 });
const p = await b.newPage();
await p.goto('http://localhost:5174/#/');
await p.waitForFunction(() => !!window.__app, { timeout: 30000 });
const only = args.only ? args.only.split(',') : null;
const rep = await p.evaluate(async (only) => {
  const { CATALOG } = await import('/src/audio/instruments/catalog.ts');
  const { measureClarity } = await import('/src/audio/instruments/clarity.ts');
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const out = {};
  for (const e of CATALOG) {
    if (e.source.type !== 'manifest' || (only && !only.includes(e.id))) continue;
    const m = await (await fetch(`/instruments/${e.source.id}/manifest.json`)).json();
    if (m.kind !== 'pitched') continue;
    const rows = [];
    for (const [art, set] of Object.entries(m.articulations)) for (const s of set.samples) {
      const buf = await ctx.decodeAudioData(await (await fetch(`/instruments/${m.id}/${s.file}`)).arrayBuffer());
      const x = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] += ch[i] / buf.numberOfChannels; }
      rows.push({ art, file: s.file, key: s.key, ...measureClarity(x, buf.sampleRate, s.key + (s.cents ?? 0) / 100) });
    }
    out[m.id] = rows;
  }
  return out;
}, only);
await b.close();
let dropped = 0, total = 0;
for (const [id, rows] of Object.entries(rep)) {
  const path = resolve('public/instruments', id, 'manifest.json');
  const man = JSON.parse(readFileSync(path, 'utf8'));
  const SHORT = /^(stac|pizz|spic|pluck|pick)/, PERC = /^(hit|trem|mute|soft|hard|bow|full)/; const bad = rows.filter((r) => r.clarity < (SHORT.test(r.art) ? 0.25 : PERC.test(r.art) ? 0.05 : MIN));
  total += rows.length;
  const mean = rows.reduce((s, r) => s + r.clarity, 0) / rows.length;
  console.log(`${id.padEnd(16)} ${rows.length} samples, mean clarity ${mean.toFixed(2)}, below ${MIN}: ${bad.length}${bad.length ? ' [' + bad.slice(0, 8).map((r) => `${r.art}/${r.key}:${r.clarity.toFixed(2)}`).join(' ') + ']' : ''}`);
  for (const r of rows) { const s = man.articulations[r.art]?.samples.find((x) => x.file === r.file); if (s) s.clarity = Math.round(r.clarity * 100) / 100; }
  if (args.apply) {
    for (const r of bad) { const set = man.articulations[r.art]; const i = set.samples.findIndex((x) => x.file === r.file); // keep at least 4 samples per articulation
      if (i >= 0 && set.samples.length > 4) { set.samples.splice(i, 1); dropped++; } }
    const dir = resolve('public/instruments', id);
    const used = new Set(Object.values(man.articulations).flatMap((a) => a.samples.map((x) => x.file)));
    for (const a of Object.keys(man.articulations)) { const d = resolve(dir, a); if (existsSync(d)) for (const f of readdirSync(d)) if (!used.has(a + '/' + f)) unlinkSync(resolve(d, f)); }
    man.bytes = [...used].reduce((t, f) => t + (existsSync(resolve(dir, f)) ? statSync(resolve(dir, f)).size : 0), 0);
    man.source.files = used.size;
    writeFileSync(path, JSON.stringify(man));
    const ip = resolve('public/instruments/index.json'); const idx = JSON.parse(readFileSync(ip, 'utf8'));
    if (idx[id]) { idx[id].bytes = man.bytes; idx[id].files = used.size; writeFileSync(ip, JSON.stringify(idx, null, 1)); }
  }
}
console.log(`${total} samples measured; ${args.apply ? dropped + ' dropped' : 'dry run'}`);
