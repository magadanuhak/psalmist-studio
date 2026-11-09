// Sample realism audit: renders every default-preset instrument solo for 8 bars (sustained and short notes, several velocities) and looks for
// audible clicks (sample-level discontinuities) and hard note cut-offs (level drops >20 dB within 10 ms of a note end).
//   node scripts/audit-realism.mjs [--out json]
import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';
const args = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; return o; })();
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 1800000 });
const p = await b.newPage();
await p.goto('http://localhost:5174/#/');
await p.waitForFunction(() => !!window.__app, { timeout: 30000 });
const rows = await p.evaluate(async () => {
  const { GENRE_PRESETS } = await import('/src/theory/arrange/presets.ts');
  const { LAYER_INST } = await import('/src/theory/arrange/realize.ts');
  const { CATALOG_BY_ID } = await import('/src/audio/instruments/catalog.ts');
  const { renderExternalBus, isExternal } = await import('/src/audio/external.ts');
  const { renderSong } = await import('/src/audio/offline.ts');
  const { engine } = await import('/src/audio/engine.ts');
  const ids = new Set();
  for (const g of Object.values(GENRE_PRESETS)) for (const t of g.tracks) if (t.inst && t.role !== 'drums') ids.add(t.inst);
  for (const g of Object.values(LAYER_INST)) for (const v of Object.values(g)) ids.add(v);
  const SR = 44100, bpm = 90, bar = 4 * 60 / bpm, total = 8 * bar + 2;
  const sf = await engine.soundFontBytes();
  const out = [];
  for (const id of ids) {
    const e = CATALOG_BY_ID[id];
    if (!e || e.source.type === 'salamander') continue;
    const mid = Math.round((e.range[0] + e.range[1]) / 2);
    const notes = [];
    for (let k = 0; k < 8; k++) {
      if (k % 2 === 0) notes.push({ midi: mid + (k % 4 ? 3 : 0), time: k * bar, dur: bar * 0.95, vel: 0.45 + 0.1 * (k % 4) });
      else for (let q = 0; q < 4; q++) notes.push({ midi: mid + [0, 4, 7, 4][q], time: k * bar + q * (bar / 4), dur: bar / 4 * 0.8, vel: 0.5 + 0.12 * q });
    }
    let L, R;
    if (isExternal(e)) { const r = await renderExternalBus([{ id, entry: e, notes, pan: 0, level: 1 }], { sampleRate: SR, totalSec: total, tuningCents: 0, space: 'studio', spaceTrim: 0, getUser: async () => undefined }); [L, R] = r.ch; }
    else { const r = await renderSong(sf, [{ id, name: id, channel: 0, program: e.gmFallback ?? 0, drums: false, pan: 0, notes: notes.map((n) => ({ midi: n.midi, startSec: n.time, durSec: n.dur, vel: n.vel })), bus: 'direct' }], { sampleRate: SR, songSec: total, levels: { [id]: 1 } }); [L, R] = r.mix; }
    const x = L.map((v, i) => (v + R[i]) * 0.5);
    const rms = (a, c) => { let s = 0; a = Math.max(0, a); c = Math.min(x.length, c); for (let i = a; i < c; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, c - a)); };
    // clicks: second difference spikes far above the local level
    let clicks = 0;
    const w = Math.round(0.01 * SR);
    for (let i = w; i < x.length - w; i += 1) {
      const d2 = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]);
      if (d2 > 0.04) { const loc = rms(i - w, i + w) + 1e-6; if (d2 > 14 * loc) { clicks++; i += w; } }
    }
    let cuts = 0, ends = 0;
    for (const n of notes) {
      const te = Math.round((n.time + n.dur) * SR), a = rms(te - Math.round(0.01 * SR), te), c = rms(te, te + Math.round(0.01 * SR));
      if (a > 0.01) { ends++; if (c < a * 0.1) cuts++; }
    }
    out.push({ id, tier: e.tier, clicks, cuts, ends, peak: x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) });
  }
  return out;
});
await b.close();
for (const r of rows) console.log(`${r.clicks || r.cuts ? 'WARN' : 'ok  '} ${r.id.padEnd(18)} [${r.tier}] clicks ${r.clicks}, hard cut-offs ${r.cuts}/${r.ends}, peak ${r.peak.toFixed(2)}`);
console.log(`${rows.filter((r) => !r.clicks && !r.cuts).length}/${rows.length} clean`);
if (args.out) writeFileSync(args.out, JSON.stringify(rows, null, 1));
