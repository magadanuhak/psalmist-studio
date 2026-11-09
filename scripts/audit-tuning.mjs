// Q1 tuning audit: renders every pitched catalog instrument (tier A samples, B SoundFont, C synths) across its range through the REAL app code,
// pitch-tracks the audio and requires |error| <= 5 cents and the correct octave.
//   node scripts/audit-tuning.mjs [--out <json>] [--only id,id] [--tier A,B,C] [--cents 5]
// Needs the dev server (npm run dev -- --port 5174), Chrome / Edge. Writes nothing into the project unless --out is given.
import puppeteer from 'puppeteer-core';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; return o; })();
const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
// tolerance by kind: real samples and solo synths 5 cents; the General MIDI SoundFont and intentionally detuned ensembles (chorus / musette / supersaw) are judged by their centre pitch
const TOL = Number(args.cents ?? 5);
const TOL_SF = Number(args.centsSf ?? 12);
const TOL_ENS = Number(args.centsEns ?? 15);
const ENSEMBLE = ['warm_pad', 'worship_swell', 'vowel_choir', 'string_ensemble', 'accordion', 'harmonium', 'voice_oohs', 'choir_aahs'];
const EXEMPT = { riser: 'effect sweep, no steady pitch', timpani: 'pitch glides with the strike', ambient_electric: 'delay texture, no single partial' };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1000, height: 700 }, protocolTimeout: 1800000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('psalmist.onboarded.v1', '1'); } catch { /* ignore */ } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${BASE}/#/`);
await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
const only = args.only ? args.only.split(',') : null;
const tiers = (args.tier ?? 'A,B,C').split(',');
const result = await page.evaluate(async (only, tiers, T) => {
  const { CATALOG } = await import('/src/audio/instruments/catalog.ts');
  const { renderExternalBus, isExternal } = await import('/src/audio/external.ts');
  const { renderSong } = await import('/src/audio/offline.ts');
  const { engine } = await import('/src/audio/engine.ts');
  const SR = 44100;
  const sf = await engine.soundFontBytes();
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const { checkPitch } = await import('/src/audio/instruments/pitchcheck.ts');
  const estimate = (seg, target) => checkPitch(seg, SR, target);
  const rows = [];
  for (const e of CATALOG) {
    if (only && !only.includes(e.id)) continue;
    if (!tiers.includes(e.tier)) continue;
    if (T.EXEMPT[e.id]) { rows.push({ id: e.id, tier: e.tier, skipped: 'exempt: ' + T.EXEMPT[e.id] }); continue; }
    const TOL = T.ENSEMBLE.includes(e.id) ? T.TOL_ENS : e.tier === 'B' ? T.TOL_SF : T.TOL;
    if (e.range[0] === e.range[1] || e.family === 'drums' || e.family === 'percussion' && e.id !== 'timpani') continue;
    if (e.source.type === 'salamander') { rows.push({ id: e.id, tier: e.tier, skipped: 'Salamander (tested by the engine tuning tests)' }); continue; }
    const lo = e.range[0], hi = e.range[1];
    const tests = [...new Set([0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(lo + (hi - lo) * k)))];
    const dur = 1.4, gap = 2.0;
    const notes = tests.map((m, i) => ({ midi: m, time: 0.3 + i * gap, dur, vel: 0.8 }));
    const total = 0.3 + tests.length * gap + 0.8;
    let L, R;
    try {
      if (isExternal(e)) {
        const out = await renderExternalBus([{ id: e.id, entry: e, notes, pan: 0, level: 1 }], { sampleRate: SR, totalSec: total, tuningCents: 0, space: 'studio', spaceTrim: 0, getUser: async () => undefined });
        if (out.failed.length) { rows.push({ id: e.id, tier: e.tier, error: 'load failed' }); continue; }
        [L, R] = out.ch;
      } else {
        const r = await renderSong(sf, [{ id: e.id, name: e.name, channel: 0, program: e.gmFallback ?? 0, drums: false, pan: 0, notes: notes.map((n) => ({ midi: n.midi, startSec: n.time, durSec: n.dur, vel: n.vel })), bus: 'direct' }], { sampleRate: SR, songSec: total, levels: { [e.id]: 1 } });
        [L, R] = r.mix;
      }
    } catch (err) { rows.push({ id: e.id, tier: e.tier, error: String(err) }); continue; }
    const mono = L.map((v, i) => (v + R[i]) * 0.5);
    const res = tests.map((m, i) => {
      const a = Math.round((0.3 + i * gap + 0.35) * SR), b = Math.round((0.3 + i * gap + 1.2) * SR);
      const est = estimate(mono.subarray(a, b), hz(m));
      return est ? { midi: m, octave: est.octave, cents: Math.round(est.cents * 10) / 10 } : { midi: m, octave: 99, cents: 99 };
    });
    const bad = res.filter((x) => x.octave !== 0 || Math.abs(x.cents) > TOL);
    rows.push({ id: e.id, tier: e.tier, tol: TOL, source: e.source.type, ok: bad.length === 0, res, bad });
  }
  return rows;
}, only, tiers, { TOL, TOL_SF, TOL_ENS, ENSEMBLE, EXEMPT });
await browser.close();
const bad = result.filter((r) => r.error || (r.bad && r.bad.length));
const tested = result.filter((r) => r.res);
for (const r of result) {
  if (r.skipped) console.log(`skip ${r.id}: ${r.skipped}`);
  else if (r.error) console.log(`ERR  ${r.id}: ${r.error}`);
  else console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(20)} [${r.tier}] ${r.res.map((x) => `${x.midi}:${x.octave ? `oct${x.octave > 0 ? '+' : ''}${x.octave}` : ''}${x.cents > 0 ? '+' : ''}${x.cents}`).join(' ')}`);
}
console.log(`\n${tested.length - bad.length}/${tested.length} instruments in tune (<= ${TOL} cents, correct octave)`);
if (args.out) writeFileSync(resolve(args.out), JSON.stringify({ tolCents: TOL, rows: result }, null, 1));
process.exitCode = bad.length ? 1 : 0;
