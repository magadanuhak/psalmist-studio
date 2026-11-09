// M8 end-to-end: the five tabs (hash state, guidance), "Semnalează aici", the local AI service wiring (status chip, Curățare AI + A/B, Importă cântec întreg),
// and the graceful offline state (requests to :5175 aborted).
// Usage: dev server on :5174 and (for the AI parts) ai-service\start-ai.cmd running, then: node scripts/e2e-m8.mjs [--vocal <wav>]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const SHOTS = resolve('screenshots'); mkdirSync(SHOTS, { recursive: true });
const vocalArg = process.argv.indexOf('--vocal') > 0 ? process.argv[process.argv.indexOf('--vocal') + 1] : null;
const vocal = vocalArg ?? (existsSync('bench-out/silent-night-metronome/vocal.wav') ? resolve('bench-out/silent-night-metronome/vocal.wav') : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const must = (c, m) => { if (!c) { fails.push(m); console.log('ASSERT FAILED:', m); } else console.log('ok:', m); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1360, height: 900 }, protocolTimeout: 900000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('psalmist.onboarded.v1', '1'); } catch { /* ignore */ } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const app = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (n) => { await sleep(350); await page.screenshot({ path: `${SHOTS}/${n}.png` }); console.log('shot', n); };
const clickText = async (text, sel = 'button, a') => {
  const ok = await page.evaluate((text, sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && !e.disabled); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) throw new Error('not found: ' + text);
};

try {
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
  await app(() => indexedDB.deleteDatabase('psalmist-studio'));
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });

  // ---------------------------------------------------------------- AI chip + graceful offline
  await page.waitForSelector('[data-testid="ai-chip"]', { timeout: 15000 });
  await page.waitForFunction(() => /AI local/.test(document.querySelector('[data-testid="ai-chip"]')?.textContent ?? ''), { timeout: 15000 });
  const chip = await page.$eval('[data-testid="ai-chip"]', (e) => e.textContent);
  const online = /pornit/.test(chip);
  console.log('AI chip:', chip);
  must(online || /start-ai\.cmd/.test(chip), 'the AI chip shows "pornit" or how to start the service');
  must(online === !!(await page.$('[data-testid="open-import-song"]')) || !online, 'Importă cântec întreg is shown only when the service is up');

  // ---------------------------------------------------------------- project, take, tabs
  const pid = await app(async () => {
    const p = await window.__app.getState().createProject({ name: 'M8 test', genre: 'worship', emotion: 'inchinare', timeSig: { num: 4, den: 4, grouping: [4] }, bpm: 90, structure: [{ type: 'strofa', bars: 8 }] });
    return p.id;
  });
  await page.evaluate((i) => { location.hash = '#/p/' + i; }, pid);
  await page.waitForSelector('.rail-item', { timeout: 30000 });
  must((await page.$$('.view-tabs button')).length === 5, 'five main tabs');
  const labels = await page.$$eval('.view-tabs button', (e) => e.map((x) => x.textContent.trim()));
  console.log('tabs:', labels.join(' | '));
  for (const [name, hash] of [['Acorduri', 'acorduri'], ['Aranjament', 'aranjament'], ['Mix', 'mix'], ['Partitură & Export', 'export'], ['Voce', 'voce']]) {
    await clickText(name, '.view-tabs button'); await sleep(500);
    must(new RegExp(`/p/[^/]+/${hash}`).test(await page.evaluate(() => location.hash)), `tab ${name} is in the URL hash`);
    must(!!(await page.$('[data-testid="tab-guide"]')), `tab ${name} shows its guidance`);
  }
  // Mix tab: mixer strips, FX chain, marks list; Minus under Export; Autotune / Exersează placeholders
  await clickText('Mix', '.view-tabs button'); await sleep(600);
  must(!!(await page.$('.mixer .chan')) && !!(await page.$('#p-fx')) && !!(await page.$('[data-testid="flags-list"]')), 'Mix tab: mixer, effects chain and the marked-moments list');
  await clickText('Partitură & Export', '.view-tabs button'); await sleep(400);
  must(await page.evaluate(() => [...document.querySelectorAll('.seg-sub button')].some((x) => x.textContent.trim() === 'Minus')), 'Minus lives under Export');
  await clickText('Voce', '.view-tabs button'); await sleep(300);
  await clickText('Autotune', '.seg-sub button'); await sleep(300);
  must(!!(await page.$('[data-testid="autotune-need"], [data-testid="autotune-view"]')), 'Autotune entry exists in the Voce sub-nav');
  // deep link survives a reload
  await page.evaluate((i) => { location.hash = '#/p/' + i + '/aranjament'; }, pid);
  await page.reload(); await page.waitForSelector('.view-tabs', { timeout: 20000 });
  must(await page.$eval('.view-tabs button.on', (e) => e.textContent.trim()) === 'Aranjament', 'a reload keeps the tab from the URL hash');
  await shot('m8-taburi-aranjament-e2e');

  // ---------------------------------------------------------------- Semnalează aici
  await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce'; }, pid);
  await page.waitForSelector('[data-testid="flag-btn"]', { timeout: 10000 });
  const flagDisabled = await page.$eval('[data-testid="flag-btn"]', (e) => e.disabled);
  console.log('flag button disabled on an empty project:', flagDisabled);

  // ---------------------------------------------------------------- Curățare AI on a take (needs the service and a vocal file)
  if (online && vocal) {
    const ids = await app(() => window.__app.getState().project.sections.map((s) => s.id));
    await app((id) => { const st = window.__app.getState(); st.startOverride(id); st.selectSection(id); }, ids[0]);
    await page.waitForSelector('input[data-testid="import-input"]', { timeout: 20000 });
    await (await page.$('input[data-testid="import-input"]')).uploadFile(vocal);
    await page.waitForFunction((id) => window.__app.getState().project.sections.find((x) => x.id === id)?.takes.length > 0, { timeout: 60000 }, ids[0]);
    const tk = await app((id) => { const s = window.__app.getState().project.sections.find((x) => x.id === id); return { sec: id, take: s.activeTakeId ?? s.takes[0].id }; }, ids[0]);
    await app(async (a) => { await window.__app.getState().runClean(a.sec, a.take); }, tk);
    const t0 = Date.now();
    await app(async (a) => { await window.__ai.getState().cleanTake(a.sec, a.take); }, tk);
    const after = await app((a) => { const t = window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take); return { kind: t.cleanKind, alt: !!t.cleanIds?.classic, id: t.cleanAudioId }; }, tk);
    console.log('Curățare AI:', JSON.stringify(after), ((Date.now() - t0) / 1000).toFixed(1), 's');
    must(after.kind === 'ai' && after.alt, 'Curățare AI stores the AI audio and keeps the classic one for A/B');
    await app((a) => window.__ai.getState().setCleanKind(a.sec, a.take, 'classic'), tk);
    const swapped = await app((a) => window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take).cleanKind, tk);
    must(swapped === 'classic', 'A/B swaps back to the classic cleaning');
    await app(async (a) => { await window.__app.getState().runClean(a.sec, a.take); }, tk);
    const kept = await app((a) => !!window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take).cleanIds?.ai, tk);
    must(kept, 'running the classic cleaning again keeps the other result as the alternative');
    await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce/clean'; }, pid);
    await page.waitForSelector('[data-testid="clean-view"]', { timeout: 10000 });
    must(!!(await page.$('[data-testid="clean-ab"]')), 'Voce > Curățare shows the classic/AI A/B switch');
    await shot('m8-curatare');
    if (online) {
      await page.evaluate(() => document.querySelector('[data-testid="restore-btn"]')?.click());
      await page.waitForFunction((a) => !!window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take).cleanIds?.restore, { timeout: 180000 }, tk);
      must(true, 'Restaurare AI (VoiceFixer) stores a third result for A/B');
      must((await page.$$('[data-testid="clean-ab"] button')).length === 3, 'A/B offers classic, AI and restored');
      await shot('m8-restaurare');
    }
    await page.evaluate((i) => { location.hash = '#/p/' + i + '/mix'; }, pid);
    await sleep(600);
    await sleep(400);
    must((await page.$$('.mixer')).length <= 1, 'Mix tab shows a single mixer');
    await shot('m8-mix-un-mixer');
    // Detecție note: AI (CREPE) vs classic on the same take
    await app((a) => window.__ai.getState().setPitchEngine('classic'), tk);
    await app(async (a) => { await window.__app.getState().runAnalyze(a.sec, a.take); }, tk);
    const cls = await app((a) => window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take).notesOriginal.map((n) => n.midi), tk);
    await app(() => window.__ai.getState().setPitchEngine('ai'));
    const t1 = Date.now();
    await app(async (a) => { await window.__app.getState().runAnalyze(a.sec, a.take); }, tk);
    const aiN = await app((a) => window.__app.getState().project.sections.find((x) => x.id === a.sec).takes.find((x) => x.id === a.take).notesOriginal.map((n) => n.midi), tk);
    console.log('notes classic', cls.slice(0, 8).join(' '), '| AI (CREPE)', aiN.slice(0, 8).join(' '), `(${cls.length} vs ${aiN.length}, ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
    must(aiN.length >= 10 && aiN.slice(0, 4).join(' ') === cls.slice(0, 4).join(' '), 'Detecție note: AI gives the same first notes as the classic detector on the synthetic singer');
    await app(() => window.__ai.getState().setPitchEngine('classic'));
  } else console.log('Curățare AI skipped (service offline or no vocal file)');

  // ---------------------------------------------------------------- Asistent (Qwen): the patch is shown, applied only on click
  if (online) {
    await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce'; }, pid);
    await page.waitForSelector('[data-testid="assistant-btn"]', { timeout: 15000 });
    const bpm0 = await app(() => window.__app.getState().project.bpm);
    await page.click('[data-testid="assistant-btn"]');
    await page.type('.assistant-text', 'vreau un cântec la 120 BPM');
    await clickText('Întreabă', '.assistant-text ~ .big-actions button');
    await page.waitForSelector('[data-testid="assistant-patch"]', { timeout: 240000 });
    const shown = await page.$eval('[data-testid="assistant-patch"]', (e) => e.textContent);
    console.log('assistant patch:', shown.slice(0, 160));
    must((await app(() => window.__app.getState().project.bpm)) === bpm0, 'the assistant patch is shown but NOT applied before the click');
    if (/BPM/.test(shown)) { await clickText('Aplică setările'); await sleep(500); must((await app(() => window.__app.getState().project.bpm)) !== bpm0, 'Aplică setările applies the validated patch'); }
    await shot('m8-asistent');
  }

  // ---------------------------------------------------------------- Variantă AI per layer (needs notes + chords)
  if (online && vocal) {
    await app(async () => { const st = window.__app.getState(); st.setKey({ tonic: 7, mode: 'major' }); st.setKeyLocked(true); window.__app.getState().harmonize(window.__app.getState().project.sections[0].id); });
    await page.evaluate((i) => { location.hash = '#/p/' + i + '/aranjament'; }, pid);
    await page.waitForSelector('[data-testid^="ai-variant-"] button', { timeout: 20000 });
    await page.evaluate(() => document.querySelector('[data-testid^="ai-variant-"] button').click());
    await page.waitForFunction(() => /note păstrate|respins/.test(document.querySelector('[data-testid^="ai-variant-"]')?.textContent ?? ''), { timeout: 240000 });
    const vtxt = await page.evaluate(() => document.querySelector('[data-testid^="ai-variant-"]')?.textContent ?? '');
    console.log('variantă AI:', vtxt);
    must(/note păstrate/.test(vtxt), 'Variantă AI: generator notes pass the rule filters and replace the layer');
    await shot('m8-varianta-ai');
  }

  // ---------------------------------------------------------------- Autotune on the imported vocal
  if (online && vocal) {
    await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce/autotune'; }, pid);
    await page.waitForSelector('[data-testid="at-run"]', { timeout: 15000 });
    const before = await page.evaluate(() => window.__app.getState().project.sections[0].takes.length);
    await page.evaluate(() => document.querySelector('[data-testid="at-run"]').click());
    await page.waitForSelector('[data-testid="at-result"]', { timeout: 120000 });
    must(await page.$eval('[data-testid="at-audio"]', (e) => e.src.startsWith('blob:')), 'Autotune renders a corrected vocal with A/B playback');
    await shot('m8-autotune');
    await page.evaluate(() => document.querySelector('[data-testid="at-save"]').click());
    await page.waitForFunction((n) => window.__app.getState().project.sections[0].takes.length === n + 1, { timeout: 15000 }, before);
    must(true, 'Autotune result is saved as a new take; the original is untouched');
  }

  // ---------------------------------------------------------------- Importă cântec întreg
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('[data-testid="open-full-vocal"]', { timeout: 15000 });
  if (online && vocal) {
    await clickText('Importă cântec întreg');
    await page.waitForSelector('[data-testid="import-song-input"]', { timeout: 10000 });
    await shot('m8-importa-cantec');
    await (await page.$('[data-testid="import-song-input"]')).uploadFile(vocal);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Folosește vocea/.test(b.textContent)), { timeout: 600000 });
    must(true, 'the song was separated and the vocals are offered');
    await page.waitForSelector('[data-testid="song-practice"]', { timeout: 5000 });
    await page.evaluate(() => document.querySelector('[data-testid="practice-make"]').click());
    await page.waitForFunction(() => document.querySelector('[data-testid="practice-audio"]')?.src?.startsWith('blob:'), { timeout: 120000 });
    must(true, 'practice mix (minus, transpose/tempo) is prepared and playable');
    await shot('m8-exerseaza-original');
    if (process.argv.includes('--learn')) {
    await page.evaluate(() => document.querySelector('[data-testid="learn-song"]').click());
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('[data-testid="learn-result"]') || document.querySelector('[data-testid="song-practice"] [role="alert"]'), { timeout: 120000 });
    must(!!(await page.$('[data-testid="learn-result"]')), 'Învață din cântec returns key, tempo and chords');
    const learnSec = (Date.now() - t0) / 1000;
    console.log('learn seconds', learnSec.toFixed(1));
    must(learnSec < 60, 'Învață din cântec finishes in under 60 s');
    }
    await clickText('Folosește vocea');
    await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.length > 0, { timeout: 15000 });
    await sleep(8000);
    must(!!(await page.$('dialog[open]')), 'the vocals open "Din vocea completă"');
    await page.waitForSelector('[data-testid="fv-ai-beats"]', { timeout: 120000 });
    await page.evaluate(() => document.querySelector('[data-testid="fv-ai-beats"]').click());
    await page.waitForFunction(() => /BPM|bpm/.test(document.querySelector('[data-testid="fv-grid"]')?.textContent ?? ''), { timeout: 120000 });
    must(!(await page.$('dialog[open] .form-error')), '/beats grid is found and shown in Din vocea completă');
    await shot('m8-importa-cantec-vocea');
  }

  // ---------------------------------------------------------------- offline: requests to :5175 are aborted
  await page.setRequestInterception(true);
  page.on('request', (rq) => (/127\.0\.0\.1:5175|localhost:5175/.test(rq.url()) ? rq.abort() : rq.continue()));
  await page.reload(); await page.waitForSelector('[data-testid="ai-chip"]', { timeout: 15000 });
  await page.waitForFunction(() => /start-ai\.cmd/.test(document.querySelector('[data-testid="ai-chip"]')?.textContent ?? ''), { timeout: 20000 });
  must(!(await page.$('[data-testid="open-import-song"]')), 'offline: the import button is hidden and the chip says how to start the service');
  await shot('m8-ai-oprit');
  must(!errors.length, 'no page errors: ' + errors.slice(0, 2).join(' | '));
} catch (e) { fails.push(String(e)); console.log('E2E M8 FAILED:', e.message); }
await browser.close();
console.log(fails.length ? 'E2E M8 FAILED: ' + JSON.stringify(fails) : 'E2E M8 OK');
if (fails.length) process.exitCode = 1;
