// Mic flow with Chrome fake media device: open mic -> level -> record (count-in + metronome) -> stop -> take saved.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
mkdirSync('screenshots', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'], // NOTE: no autoplay flag on purpose
  defaultViewport: { width: 1360, height: 900 },
});
const page = await browser.newPage();
const log = [];
page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) log.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) log.push(`HTTP ${r.status()} ${r.url()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text, sel = 'button, a') => {
  const ok = await page.evaluate((text, sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && !e.disabled);
    if (el) { el.click(); return true; } return false;
  }, text, sel);
  if (!ok) throw new Error('not found: ' + text);
};
const waitText = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

await page.goto(`${BASE}/#/`);
await page.evaluate(() => indexedDB.deleteDatabase('psalmist-studio'));
await page.reload();
await waitText('Încă nu ai nicio cântare');
await clickText('Începe prima cântare');
await page.waitForSelector('#f-name');
await page.type('#f-name', 'Test microfon');
await page.$eval('#f-bpm', (el) => el.select());
await page.keyboard.type('120');
await clickText('Creează proiectul');
await waitText('Înregistrare');
await clickText('Test microfon');
await page.waitForSelector('.meter', { timeout: 8000 });
await sleep(2500);
console.log('signal hint:', await page.$eval('.ok-line, .warn-line', (e) => e.textContent).catch(() => 'none'));
const label = () => page.$eval('.beat-label', (e) => e.textContent).catch(() => 'none');
await clickText('Înregistrează', '.btn-rec');
await sleep(1200);
console.log('1 count-in      :', await label());
await sleep(5200); // 2 s count-in + ~4 s = into bar 2
console.log('2 recording     :', await label());
await page.screenshot({ path: 'screenshots/mic-recording.png' });
await clickText('Pauză', '.rec-buttons button');
await sleep(1500);
console.log('3 after pause   :', await label(), '| buttons:', await page.$$eval('.rec-buttons button', (b) => b.map((x) => x.textContent.trim())));
await page.screenshot({ path: 'screenshots/mic-pauza.png' });
await page.keyboard.press('p'); // keyboard resume
await sleep(700);
console.log('4 after resume  :', await label());
await sleep(5000);
console.log('5 recording     :', await label());
await page.keyboard.press('r'); // keyboard stop
await page.waitForFunction(() => document.body.innerText.includes('Înregistrarea a fost salvată') || document.body.innerText.includes('prea scurtă') || document.body.innerText.includes('Ceva n-a mers'), { timeout: 15000 });
await sleep(900);
const take = await page.evaluate(async () => new Promise((res) => {
  const r = indexedDB.open('psalmist-studio');
  r.onsuccess = () => { const g = r.result.transaction('projects').objectStore('projects').getAll(); g.onsuccess = () => {
    const tk = g.result[0].sections.flatMap((s) => s.takes)[0]; res(tk ? { dur: +tk.durationSec.toFixed(2), source: tk.source } : null); }; };
}));
console.log('take saved:', take, '(expected ~ bar1+ pause bar kept + resumed part)');
const peak = await page.evaluate(async () => new Promise((res) => {
  const r = indexedDB.open('psalmist-studio');
  r.onsuccess = () => { const g = r.result.transaction('audio').objectStore('audio').getAll(); g.onsuccess = () => {
    const a = g.result[0]; let m = 0, nz = 0; for (const v of a.data) { m = Math.max(m, Math.abs(v)); if (Math.abs(v) > 300) nz++; } res({ peak: +(m / 32767).toFixed(2), loudSamples: nz }); }; };
}));
console.log('captured audio:', peak);
await page.screenshot({ path: 'screenshots/mic-saved.png' });
console.log('log:', log.length ? log : 'clean');
await browser.close();
