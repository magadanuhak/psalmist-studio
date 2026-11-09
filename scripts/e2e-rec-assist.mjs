// Recording assistant e2e with Chrome's fake microphone: tap tempo -> meter by ear -> record with the metronome -> bleed check result.
// Usage: dev server on :5174, then: node scripts/e2e-rec-assist.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('screenshots', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1360, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const must = (c, m) => { if (c) console.log('ok:', m); else { console.log('ASSERT FAILED:', m); fails.push(m); } };
const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
try {
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
  await page.evaluate(() => indexedDB.deleteDatabase('psalmist-studio'));
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });
  const pid = await page.evaluate(async () => (await window.__app.getState().createProject({ name: 'Asistent test', genre: 'worship', emotion: 'inchinare', timeSig: { num: 4, den: 4, grouping: [4] }, bpm: 90, structure: [{ type: 'strofa', bars: 2 }] })).id);
  await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce'; }, pid);
  await page.waitForSelector('[data-testid="rec-assist-btn"]', { timeout: 20000 });
  await click('[data-testid="rec-assist-btn"]');
  await page.waitForSelector('[data-testid="rec-assistant"][open]', { timeout: 5000 });

  // 1. tap tempo: taps 0.5 s apart = 120 BPM
  for (let i = 0; i < 6; i++) { await click('[data-testid="ra-tap"]'); await sleep(500); }
  const label = await page.$eval('[data-testid="ra-tap"]', (e) => e.textContent);
  must(/1[0-3][0-9] BPM/.test(label), 'tap tempo shows ~120 BPM (' + label.replace('Bate aici', '') + ')');
  await click('[data-testid="ra-use-tempo"]');
  must((await page.evaluate(() => window.__app.getState().project.bpm)) >= 110, 'the tapped tempo is applied to the project');
  await page.screenshot({ path: 'screenshots/m8-asistent-inreg-1.png' });

  // 2. meter by ear
  await click('[data-testid="ra-meter-3-4"]');
  await click('[data-testid="ra-listen"]');
  await sleep(300);
  must(await page.$eval('[data-testid="ra-listen"]', (e) => e.getAttribute('aria-busy') === 'true'), 'the accented-"1" preview plays');
  await page.screenshot({ path: 'screenshots/m8-asistent-inreg-2.png' });
  await click('[data-testid="ra-use-meter"]');
  must((await page.evaluate(() => window.__app.getState().project.timeSig.num)) === 3, 'the chosen meter (3/4) is applied');

  // 3. record with the metronome: eighth subdivision, rim sound
  await click('[data-testid="ra-sub-2"]');
  await page.select('[data-testid="ra-sound"]', 'rim');
  must((await page.$$('[data-testid="ra-beats"] .beat-dot')).length === 3, 'the big beat indicator shows 3 beats for 3/4');
  await click('[data-testid="ra-record"]');
  await page.waitForFunction(() => /Numărătoare|Se înregistrează/.test(document.querySelector('[data-testid="ra-status"]')?.textContent ?? ''), { timeout: 15000 });
  let sawLit = false;
  for (let i = 0; i < 40 && !sawLit; i++) { sawLit = !!(await page.$('[data-testid="ra-beats"] .beat-dot.lit')); if (!sawLit) await sleep(100); }
  must(sawLit, 'a beat light is lit while the metronome runs');
  await page.screenshot({ path: 'screenshots/m8-asistent-inreg-3.png' });
  await sleep(3500);
  await click('[data-testid="ra-stop"]');
  await page.waitForFunction(() => !!window.__rec?.getState().bleed || document.querySelector('[data-testid="ra-bleed"]'), { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('[data-testid="ra-bleed"]', { timeout: 30000 });
  const takes = await page.evaluate(() => window.__app.getState().project.sections[0].takes.length);
  must(takes >= 1, 'the recording is saved as a take (' + takes + ')');
  const txt = await page.$eval('[data-testid="ra-bleed"]', (e) => e.textContent);
  console.log('bleed message:', txt.trim().slice(0, 90));
  must(txt.length > 10, 'the headphone bleed check reports a result');
  await page.screenshot({ path: 'screenshots/m8-asistent-inreg-4.png' });
  if (await page.$('[data-testid="ra-reduce"]')) {
    await click('[data-testid="ra-reduce"]');
    await sleep(1500);
    must((await page.evaluate(() => window.__app.getState().project.sections[0].takes.length)) === takes + 1, 'Scoate clicul saves a new take');
  }
  must(errors.length === 0, 'no page errors ' + errors.join('|'));
} catch (e) { console.log('E2E REC ASSIST FAILED:', e.message); fails.push(e.message); }
await browser.close();
console.log(fails.length ? 'E2E REC ASSIST FAILED' : 'E2E REC ASSIST OK');
process.exit(fails.length ? 1 : 0);
