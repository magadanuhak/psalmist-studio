// M7 + Q end-to-end: swap an instrument and play, a user instrument from synthetic notes, a reverb change, the tap-along grid, export audit.
// Usage: dev server on :5174, then: node scripts/e2e-m7.mjs   (also imported at the end of scripts/e2e.mjs)
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const SHOTS = resolve('screenshots');
mkdirSync(SHOTS, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'psalmist-m7-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const must = (c, m) => { if (!c) { fails.push(m); console.log('ASSERT FAILED:', m); } else console.log('ok:', m); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1360, height: 900 }, protocolTimeout: 600000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('psalmist.onboarded.v1', '1'); } catch { /* ignore */ } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warn' && /psalmist/.test(m.text())) console.log('WARN', m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const app = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (n) => { await sleep(350); await page.screenshot({ path: `${SHOTS}/${n}.png` }); console.log('shot', n); };
const clickText = async (text, sel = 'button, a') => {
  const ok = await page.evaluate((text, sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && !e.disabled); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) throw new Error('not found: ' + text);
};

// views moved into the five tabs (Voce / Acorduri / Aranjament / Mix / Partitură & Export): old view names -> tab + sub-view
const goView = async (name) => {
  const MAP = { 'Compune': ['Voce', 'Înregistrare, curățare, note'], 'Raport voce': ['Voce', 'Raport voce'], 'Înregistrare finală': ['Voce', 'Înregistrare finală'], 'Minus': ['Partitură & Export', 'Minus'], 'Partitură': ['Partitură & Export', 'Partitură'], 'Exportă': ['Partitură & Export', 'Exportă'] };
  const [tabName, sub] = MAP[name] ?? [name, null];
  await clickText(tabName, '.view-tabs button');
  await new Promise((r) => setTimeout(r, 300));
  if (sub) await clickText(sub, '.seg-sub button');
};
const waitText = (t, timeout = 30000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

/** a plucked / bowed-like test tone: harmonics with a decay */
function noteWav(midi, sec = 1.4, sr = 44100) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const n = Math.round(sec * sr);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 1.2);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * env * 0.4)) * 32767), 44 + i * 2);
  }
  return b;
}

async function health(label, { expectExt = true } = {}) {
  await app(() => window.__player.getState().setScope('song'));
  const t0 = Date.now();
  await app(() => { window.__player.getState().toggle(); });
  await page.waitForFunction(() => window.__engine.playing, { timeout: 90000 });
  const startMs = Date.now() - t0;
  await sleep(3000);
  const h = await app(() => ({ pos: window.__engine.position(), playing: window.__engine.playing, fb: window.__engine.fallbackNames, ext: [...window.__engine.ext.keys()], space: window.__engine.spaceId }));
  await app(() => window.__engine.stop());
  console.log(label, JSON.stringify(h), 'start', startMs, 'ms');
  must(h.playing && h.pos > 1.5, `${label}: playing and the position advances (${h.pos.toFixed(2)} s)`);
  must(!h.fb.length, `${label}: no GM fallback needed`);
  if (expectExt) must(h.ext.length > 0, `${label}: sampled / synth tracks are live (${h.ext.join(',')})`);
  return { ...h, startMs };
}

try {
  // ---------------------------------------------------------------- project with chords
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
  await app(() => indexedDB.deleteDatabase('psalmist-studio'));
  await app(() => indexedDB.deleteDatabase('psalmist-user-instruments'));
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });
  const pid = await app(async () => {
    const p = await window.__app.getState().createProject({ name: 'M7 test', genre: 'worship', emotion: 'inchinare', timeSig: { num: 4, den: 4, grouping: [4] }, bpm: 90, structure: [{ type: 'intro', bars: 4 }, { type: 'strofa', bars: 8 }, { type: 'refren', bars: 8 }, { type: 'outro', bars: 4 }] });
    return p.id;
  });
  await page.evaluate((i) => { location.hash = '#/p/' + i; }, pid);
  await page.waitForSelector('.rail-item', { timeout: 30000 });
  await app(() => { const st = window.__app.getState(); st.setKey({ tonic: 0, mode: 'major' }); st.setKeyLocked(true); });
  const wav = resolve('test-audio/melody-do-major-90bpm.wav');
  for (const type of ['strofa', 'refren']) {
    const { sid, label } = await app((ty) => { const s = window.__app.getState().project.sections.find((x) => x.type === ty); return { sid: s.id, label: s.label }; }, type);
    await app((s) => window.__app.getState().selectSection(s), sid);
    await page.evaluate((l) => [...document.querySelectorAll('.rail-item')].find((e) => e.textContent.includes(l))?.click(), label);
    await sleep(400);
    await (await page.$('input[data-testid="import-input"]')).uploadFile(wav);
    await page.waitForFunction((s) => window.__app.getState().project.sections.find((x) => x.id === s)?.takes.length > 0, { timeout: 60000 }, sid);
    await app(async (s) => { const st = window.__app.getState(); const sec = st.project.sections.find((x) => x.id === s); await st.runAll(s, sec.activeTakeId ?? sec.takes[0].id); window.__app.getState().harmonize(s); }, sid);
  }
  await goView('Aranjament'); // the instrument panel lives in the Aranjament tab
  await waitText('Aranjament');
  await page.waitForSelector('.inst-pick li', { timeout: 20000 });
  const names = await page.$$eval('.inst-pick li', (l) => l.map((x) => x.textContent.trim()));
  console.log('instruments:', names.join(' | '));
  must(names.length >= 3, `worship palette has ${names.length} instruments`);
  await shot('m7-aranjament-instrumente');

  // ---------------------------------------------------------------- default palette plays
  const base = await health('default palette');
  must(base.startMs < 12000, `first play of the default palette starts in ${base.startMs} ms`);

  // ---------------------------------------------------------------- swap an instrument (picker: search, preview, pick) and play
  await app(() => document.querySelector('[data-testid="change-pian"]').click());
  await page.waitForSelector('dialog[data-testid="instrument-picker"][open]');
  await page.type('[data-testid="picker-search"]', 'vibraf');
  await sleep(300);
  const rows = await page.$$eval('.picker-row', (l) => l.map((x) => x.dataset.inst));
  must(rows.includes('vibraphone') && rows.length <= 2, `picker search finds the vibraphone (${rows.join(',')})`);
  await shot('m7-selector-instrument');
  await app(() => document.querySelector('.picker-row[data-inst="vibraphone"] .btn-ghost').click());
  await sleep(1500);
  await app(() => document.querySelector('[data-testid="pick-vibraphone"]').click());
  await sleep(500);
  const picked = await app(() => ({ ins: window.__app.getState().project.arrangement?.instruments, open: !!document.querySelector('dialog[data-testid="instrument-picker"][open]') }));
  must(picked.ins?.pian === 'vibraphone' && !picked.open, 'the choice is saved on the project and the picker closes');
  const swapped = await health('vibraphone instead of piano');
  must(swapped.ext.includes('pian'), 'the swapped track is played by the sampler host');
  await shot('m7-vibrafon-in-loc-de-pian');

  // ---------------------------------------------------------------- reverb space change
  await page.select('[data-testid="space-select"]', 'catedrala');
  await sleep(400);
  const spaceSaved = await app(() => window.__app.getState().project.arrangement?.space);
  must(spaceSaved === 'catedrala', 'the reverb space is saved on the project');
  const rv = await health('cathedral reverb');
  must(rv.space === 'catedrala', `the engine loaded the cathedral impulse (${rv.space})`);
  await shot('m7-reverb-catedrala');

  // ---------------------------------------------------------------- a user instrument from synthetic notes
  await app(() => document.querySelector('[data-testid="change-cello"]').click());
  await page.waitForSelector('dialog[data-testid="instrument-picker"][open]');
  await app(() => document.querySelector('[data-testid="open-yours"]').click());
  await page.waitForSelector('dialog[data-testid="yours-dialog"][open]');
  const files = [55, 59, 62, 67, 71, 74].map((m) => { const f = join(tmp, `n${m}.wav`); writeFileSync(f, noteWav(m)); return f; });
  await (await page.$('input[data-testid="yours-import"]')).uploadFile(...files);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="yours-notes"] li').length >= 6, { timeout: 30000 });
  const labels = await page.$$eval('[data-testid="yours-notes"] li', (l) => l.map((x) => x.textContent.trim()));
  console.log('recognised notes:', labels.join(' | '));
  must(labels.every((x) => x !== '–'), 'every synthetic note was recognised');
  await page.$eval('[data-testid="yours-name"]', (e) => { e.select(); });
  await page.keyboard.type('Chitara mea');
  await shot('m7-instrumentul-tau');
  await app(() => document.querySelector('[data-testid="yours-save"]').click());
  await page.waitForFunction(() => !document.querySelector('dialog[data-testid="yours-dialog"][open]'), { timeout: 20000 });
  await sleep(600);
  const mineSaved = await app(() => window.__app.getState().project.arrangement?.instruments?.cello);
  must(typeof mineSaved === 'string' && mineSaved.startsWith('user:'), `the user's instrument is assigned to the track (${mineSaved})`);
  const yours = await health('user instrument');
  must(yours.ext.includes('cello'), 'the cello track is played by the user-built sampler');
  await shot('m7-instrumentul-tau-aranjament');

  // ---------------------------------------------------------------- export + audits (Q4)
  await goView('Exportă');
  await waitText('Piste separate');
  await clickText('WAV', '.export-list li:nth-child(3) button');
  await page.waitForSelector('[data-testid="audit"]', { timeout: 240000 });
  const aud = await app(() => document.querySelector('[data-testid="audit"]').innerText);
  console.log('audit panel:', aud.replace(/\n/g, ' | '));
  must(aud.includes('Verificarea sunetului'), 'the export shows the audit panel');
  await shot('q-export-audit');
  const audit = await app(async () => {
    const { exportSong } = await import('/src/store/exportSong.ts');
    const o = await exportSong(window.__app.getState().project, { kind: 'minus', rate: 44100, stems: false, guide: false, countIn: false, metronome: false });
    const v = new DataView(o.wav);
    let peak = 0, nan = 0;
    for (let i = 44; i + 2 < v.byteLength; i += 3 * 500) { const s = (v.getUint8(i) | (v.getUint8(i + 1) << 8) | (v.getInt8(i + 2) << 16)) / 0x800000; if (!Number.isFinite(s)) nan++; peak = Math.max(peak, Math.abs(s)); }
    return { lufs: o.lufs, tp: o.truePeakDb, peak, nan, warnings: o.audit.warnings.map((w) => w.id), clipped: o.audit.clipped, maxSim: o.audit.taste.maxSimultaneous, fallbacks: o.fallbacks };
  });
  console.log('minus audit:', JSON.stringify(audit));
  must(audit.nan === 0 && audit.peak > 0.05 && audit.clipped === 0, 'the rendered minus is audible, finite and not clipped');
  must(audit.maxSim <= 5, `at most 5 tracks sound together (${audit.maxSim})`);
  must(!audit.fallbacks?.length, 'no instrument fell back to the SoundFont during export');

  // ---------------------------------------------------------------- tap-along grid on the full-vocal import
  await page.goto(`${BASE}/#/`);
  await waitText('Proiectele tale');
  await app(() => document.querySelector('[data-testid="open-full-vocal"]').click());
  await page.waitForSelector('dialog[data-testid="full-vocal"][open]');
  await (await page.$('input[data-testid="full-vocal-input"]')).uploadFile(wav);
  await page.waitForSelector('[data-testid="fv-listen"]', { timeout: 60000 });
  await shot('m7-vocea-completa-tact');
  await app(() => document.querySelector('[data-testid="fv-listen"]').click());
  await page.waitForFunction(() => !document.querySelector('[data-testid="fv-pad"]').disabled, { timeout: 15000 });
  const beat = 60 / 90;
  const tStart = Date.now();
  for (let i = 0; i < 12; i++) {
    const wait = tStart + (i * beat + 0.15) * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    await app((down) => document.querySelector(down ? '[data-testid="fv-one"]' : '[data-testid="fv-pad"]').click(), i % 4 === 0);
  }
  const gridText = await app(() => document.querySelector('[data-testid="fv-grid"]').innerText);
  console.log('grid:', gridText);
  const bpmTapped = Number(/([\d.]+) BPM/.exec(gridText)?.[1] ?? 0);
  must(bpmTapped > 80 && bpmTapped < 100, `the tapped grid is about 90 BPM (${bpmTapped})`);
  await shot('m7-tact-bataile');
  await app(() => document.querySelector('[data-testid="fv-use"]').click());
  await page.waitForFunction(() => /#\/p\//.test(location.hash) && window.__app.getState().project?.name !== 'M7 test', { timeout: 120000 });
  const built = await app(() => { const p = window.__app.getState().project; return { exact: !!p.gridExact, bpm: p.bpm, sections: p.sections.length, chords: p.sections.filter((s) => s.harmony).length }; });
  console.log('built from the full vocal:', JSON.stringify(built));
  must(built.exact, 'the tapped grid overrides the estimate (gridExact)');
  must(Math.abs(built.bpm - 90) < 6, `project tempo follows the taps (${built.bpm})`);
  must(built.chords >= 1, 'chords were written for the vocal sections');
  await shot('m7-din-vocea-completa');
} catch (e) {
  console.error('E2E M7 FAILED:', e instanceof Error ? e.message : e);
  fails.push(String(e));
  await page.screenshot({ path: `${SHOTS}/m7-eroare.png` }).catch(() => undefined);
}
const real = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
console.log('console errors:', real.length ? real : 'none');
if (real.length) fails.push('console errors: ' + real.slice(0, 3).join(' || '));
await browser.close();
rmSync(tmp, { recursive: true, force: true });
if (fails.length) { console.log('E2E M7 FAILED:', fails); process.exitCode = 1; } else console.log('E2E M7 OK');
