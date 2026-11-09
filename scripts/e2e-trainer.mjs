// Vocal trainer e2e: fake microphone (Chrome) for the live path, injected pitch frames for deterministic scoring, desktop and 375 px.
// Usage: dev server on :5174, then: node scripts/e2e-trainer.mjs
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
const tr = (fn, arg) => page.evaluate(fn, arg);
/** screenshot of the trainer panel alone (the fixed transport bar would cover it) */
const shotPanel = async (name) => {
  await page.evaluate(() => { const tp = document.querySelector('.transport'); if (tp) tp.style.visibility = 'hidden'; document.querySelector('[data-testid="trainer-view"]')?.scrollIntoView({ block: 'start' }); });
  await sleep(250);
  const el = await page.$('[data-testid="trainer-view"]');
  await el.screenshot({ path: 'screenshots/' + name + '.png' });
  await page.evaluate(() => { const tp = document.querySelector('.transport'); if (tp) tp.style.visibility = ''; });
};

/** feed ideal singing (offset in cents) of the running exercise into the trainer until it is done */
async function singThrough(offCents) {
  await tr((off) => {
    const T = window.__trainer;
    T.setState({ external: true });
    window.__feed = setInterval(() => {
      const st = T.getState();
      if (st.status !== 'running') return;
      const t = (performance.now() - st.t0) / 1000;
      const tg = st.exercise.targets.find((x) => t >= x.startSec && t < x.startSec + x.durSec);
      st.pushFrame(t, tg ? tg.midi + off / 100 : null);
    }, 20);
  }, offCents);
  await click('[data-testid="tr-start"]');
  await page.waitForSelector('[data-testid="tr-result"]', { timeout: 40000 });
  await tr(() => clearInterval(window.__feed));
  return Number(await page.$eval('[data-testid="tr-score"]', (e) => e.textContent));
}

try {
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 });
  await page.evaluate(() => { indexedDB.deleteDatabase('psalmist-studio'); localStorage.setItem('psalmist.onboarded.v1', '1'); });
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });
  const pid = await page.evaluate(async () => {
    const p = await window.__app.getState().createProject({ name: 'Antrenament test', genre: 'worship', emotion: 'inchinare', timeSig: { num: 4, den: 4, grouping: [4] }, bpm: 90, structure: [{ type: 'strofa', bars: 4 }] });
    window.__app.getState().setKey({ tonic: 7, mode: 'major' });
    return p.id;
  });
  await page.evaluate((i) => { location.hash = '#/p/' + i + '/voce/practice'; }, pid);
  await page.waitForSelector('[data-testid="trainer-view"]', { timeout: 20000 });
  must(await page.$$eval('[data-testid^="tr-kind-"]', (b) => b.length === 4), 'four exercises: hold, scale, intervals, my song');
  await sleep(500);
  await shotPanel('m8-antrenament-1');

  // live path with the fake microphone: the mic opens, the count-in runs, the canvas paints, the exercise finishes with a score
  await click('[data-testid="tr-start"]');
  await page.waitForFunction(() => ['countdown', 'running'].includes(window.__trainer.getState().status), { timeout: 15000 });
  must(true, 'the fake microphone opens and the exercise starts');
  await sleep(4200);
  const painted = await page.$eval('[data-testid="trainer-canvas"]', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n > 500; });
  must(painted, 'the stage canvas is drawn (lanes, target bar)');
  await shotPanel('m8-antrenament-2');
  const live = await tr(() => ({ trail: window.__trainer.getState().trail.length, voiced: window.__trainer.getState().trail.filter((x) => x.midi != null).length }));
  console.log('fake mic frames:', JSON.stringify(live));
  must(live.trail > 20, 'live pitch frames are collected from the microphone (' + live.trail + ')');
  await click('[data-testid="tr-stop"]');

  // deterministic scoring through the injected frames
  const good = await singThrough(0);
  console.log('perfect hold score', good);
  must(good >= 90, 'singing the held note on pitch scores >= 90');
  await shotPanel('m8-antrenament-3');
  const bad = await singThrough(-80);
  console.log('80 cents flat hold score', bad);
  must(bad <= 15, 'singing 80 cents flat scores <= 15');

  // scale exercise: 15 notes, interval exercise exists
  await click('[data-testid="tr-kind-scale"]');
  const nScale = await tr(() => window.__trainer.getState().build().targets.length);
  must(nScale === 15, 'the G major scale exercise has 15 notes (' + nScale + ')');
  await click('[data-testid="tr-kind-interval"]');
  await page.select('[data-testid="tr-interval"]', '4');
  const iv = await tr(() => { const e = window.__trainer.getState().build(); return e.targets[1].midi - e.targets[0].midi; });
  must(iv === 7, 'the interval exercise asks for a fifth (' + iv + ')');
  await click('[data-testid="tr-kind-song"]');
  must(!!(await page.$('[data-testid="tr-song-empty"]')), 'the song exercise explains that a melody is needed first');

  // mobile 375 px
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  await click('[data-testid="tr-kind-hold"]');
  await sleep(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  must(!overflow, 'no horizontal scroll at 375 px');
  await tr(() => { window.__trainer.setState({ external: true }); });
  await click('[data-testid="tr-start"]');
  await sleep(3800);
  await shotPanel('m8-antrenament-mobil');
  await click('[data-testid="tr-stop"]');
  must(errors.length === 0, 'no page errors ' + errors.join('|'));
} catch (e) { console.log('E2E TRAINER FAILED:', e.message); fails.push(e.message); }
await browser.close();
console.log(fails.length ? 'E2E TRAINER FAILED' : 'E2E TRAINER OK');
process.exit(fails.length ? 1 : 0);
