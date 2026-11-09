// End-to-end smoke run with an installed Chromium browser (puppeteer-core): import -> clean -> analyze -> correct -> roll -> play -> MIDI.
// Usage: npm run dev (port 5174) in another terminal, then: node scripts/e2e.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import midiPkg from '@tonejs/midi';
const { Midi } = midiPkg;

const BASE = process.env.BASE ?? 'http://localhost:5174';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const SHOTS = resolve('screenshots');
const DL = resolve('test-audio/downloads');
mkdirSync(SHOTS, { recursive: true });
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  defaultViewport: { width: 1360, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('e2e-ob')) localStorage.setItem('psalmist.onboarded.v1', '1'); } catch {} });
page.on('workercreated', (w) => console.log('worker', w.url()));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('CONSOLE ERROR', m.text()); } });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const must = (cond, msg) => { if (!cond) { fails.push(msg); console.log('ASSERT FAILED:', msg); } };
const shot = async (name, full = false) => { await sleep(350); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); console.log('shot', name); };
const clickText = async (text, sel = 'button, a') => {
  const ok = await page.evaluate((text, sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().includes(text) && !e.disabled);
    if (el) { el.click(); return true; }
    return false;
  }, text, sel);
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
const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

// 1. empty state
await page.goto(`${BASE}/#/`);
await page.evaluate(() => indexedDB.deleteDatabase('psalmist-studio'));
await page.reload();
await waitText('Încă nu ai nicio cântare');
await shot('01-proiecte-gol');

// 2. new project
await clickText('Începe prima cântare');
await page.waitForSelector('#f-name');
await page.type('#f-name', 'Ești vrednic');
await page.evaluate(() => { const b = document.querySelector('#f-bpm'); b.focus(); });
await page.$eval('#f-bpm', (el) => { el.select(); });
await page.keyboard.type('90');
await shot('02-proiect-nou', true);
await clickText('Creează proiectul');
await waitText('Înregistrare');
await shot('03-studio-simplu-inregistrare');

// 3. import file as take
const input = await page.$('input[data-testid="import-input"]');
await input.uploadFile(resolve('test-audio/melody-do-major-90bpm.wav'));
await waitText('melody-do-major-90bpm');
await shot('04-studio-takes');

// 4. clean
await clickText('Curăță', '.step');
await waitText('Curăță înregistrarea');
await shot('05-simplu-curata');
await clickText('Curăță', '.big-actions button');
await waitText('Gata. Ascultă diferența', 60000);
await shot('06-simplu-curatat');

// 5. analyze
await clickText('Analizează', '.step');
await clickText('Analizează', '.big-actions button');
await page.waitForSelector('.facts', { timeout: 60000 });
await sleep(800);
await shot('07-simplu-analiza', true);

// 6. correct
await clickText('Corectează', '.step');
await sleep(500);
await shot('08-simplu-corectare', true);

// 6b. structure: copies and generated sections
await clickText('Strofă 2', '.rail-item');
await waitText('Generată din Strofă 1');
await shot('08b-sectiune-copie');
await clickText('Intro', '.rail-item');
await waitText('Se construiește din melodia cântării');
await shot('08c-sectiune-generata');
await clickText('Strofă 1', '.rail-item');
await sleep(400);
// 7. pro mode + play
await clickText('Pro', '.seg-mode button');
await sleep(800);
await shot('09-pro-pianoroll', true);
await page.click('.btn-play');
await sleep(2500);
await shot('10-pro-redare');
const playing = await page.evaluate(() => !!document.querySelector('.tbtn[aria-label="Pauză"]:not(:disabled)'));
console.log('playing state shown:', playing);
await page.click('.tbtn[aria-label="Pauză"]');

// 8. exports
await clickText('MIDI secțiune');
await sleep(800);
await clickText('MIDI întreaga cântare');
await clickText('WAV voce curățată');
await sleep(1200);
const files = readdirSync(DL);
console.log('downloads:', files);
for (const f of files.filter((x) => x.endsWith('.mid'))) {
  const midi = new Midi(readFileSync(`${DL}/${f}`));
  const notes = midi.tracks[0].notes;
  console.log(f, 'notes', notes.length, 'first', notes.slice(0, 5).map((n) => `${n.midi}@${n.time.toFixed(2)}`).join(' '));
}


// ===================== M3: chords, voicing, bass =====================
const readProject = () => page.evaluate(async () => new Promise((res) => {
  const r = indexedDB.open('psalmist-studio');
  r.onsuccess = () => { const g = r.result.transaction('projects').objectStore('projects').getAll(); g.onsuccess = () => res(JSON.parse(JSON.stringify(g.result[0], (k, v) => (v && v.length > 400 && typeof v !== 'string' ? undefined : v)))); };
}));
const harmonyOf = async () => (await readProject()).sections.find((x) => x.harmony)?.harmony;
const stripNames = () => page.$$eval('.chord-strip .cc-name', (e) => e.map((x) => x.textContent));

await clickText('Pro', '.seg-mode button');
await sleep(500);
await clickText('Acorduri', '.view-tabs button'); await sleep(400);
await clickText('Generează acorduri');
await sleep(800); console.log('toasts:', await page.$$eval('.toast', (e) => e.map((x) => x.textContent)), '| panel:', (await page.$eval('#p-chords', (e) => e.closest('section').innerText)).slice(0, 300));
await page.waitForSelector('.chord-strip', { timeout: 15000 });
await sleep(900);
await shot('m3-pro-acorduri', true);
const names = {};
for (const [id, label] of [['A', 'Simplă'], ['B', 'Pop / Worship'], ['C', 'Bogată']]) {
  await clickText(label, '.variant-seg button');
  await sleep(250);
  names[id] = await stripNames();
}
console.log('variant A:', names.A.join(' '));
console.log('variant B:', names.B.join(' '));
console.log('variant C:', names.C.join(' '));
const diff = (a, b) => a.filter((x, i) => x !== b[i]).length / a.length;
console.log('variant differences A/B, A/C, B/C:', [diff(names.A, names.B), diff(names.A, names.C), diff(names.B, names.C)].map((d) => Math.round(d * 100) + '%').join(' '));

// slot popover from the chord lane (canvas click)
await clickText('Bogată', '.variant-seg button');
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(200);
const box = await (await page.$('.roll-canvas')).boundingBox();
console.log('canvas box', box);
await page.mouse.click(box.x + 62 + 150, box.y + 22 + 13);
await page.waitForSelector('.chord-pop', { timeout: 5000 });
await sleep(300);
await shot('m3-popover');
const altCount = await page.$$eval('.chord-pop .alts-list .alt', (e) => e.length);
const before = await stripNames();
await page.evaluate(() => document.querySelectorAll('.chord-pop .alts-list .alt')[1].click());
await sleep(500);
const after = await stripNames();
const changed = after.map((x, i) => (x !== before[i] ? i : -1)).filter((i) => i >= 0);
let hm = await harmonyOf();
console.log('popover alternatives listed:', altCount, '| edited slot:', changed, '| locks in variant C:', Object.keys(hm.locks.C));
// re-harmonize keeps the lock
const lockedIdx = Object.keys(hm.locks.C)[0];
const lockedChord = hm.variants.C[lockedIdx];
await page.keyboard.press('Escape');
await clickText('Reînarmonizează');
await sleep(500);
hm = await harmonyOf();
console.log('lock kept after re-harmonize:', hm.variants.C[lockedIdx].root === lockedChord.root && hm.variants.C[lockedIdx].quality === lockedChord.quality);
// undo / redo
const pre = await stripNames();
const ctrl = async (k) => { await page.keyboard.down('Control'); await page.keyboard.press(k); await page.keyboard.up('Control'); await sleep(250); };
await ctrl('z'); await ctrl('z'); // re-harmonize + slot edit
const undone = await stripNames();
await ctrl('y'); await ctrl('y');
const redone = await stripNames();
console.log('undo changes chords:', pre.join() !== undone.join(), '| redo restores:', pre.join() === redone.join());
// Romanian naming
await clickText('Do lam Sol', '.seg button');
await sleep(300);
console.log('Romanian naming sample:', (await stripNames()).slice(0, 6).join(' '));
await shot('m3-pro-acorduri-ro');
await clickText('C Am G', '.seg button');
// play all layers
await page.click('.btn-play');
await sleep(2500);
console.log('playing with chords+bass:', await page.evaluate(() => !!document.querySelector('.tbtn[aria-label="Pauză"]:not(:disabled)')));
await page.click('.tbtn[aria-label="Pauză"]');
// export: 3 tracks + markers
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
await clickText('MIDI întreaga cântare');
await sleep(900);
for (const f of readdirSync(DL).filter((x) => x.endsWith('.mid'))) {
  const midi = new Midi(readFileSync(`${DL}/${f}`));
  const markers = midi.header.meta.filter((m) => m.type === 'marker');
  console.log(f, 'tracks:', midi.tracks.map((t) => `${t.name}(${t.notes.length})`).join(', '), '| chord markers:', markers.length, markers.slice(0, 5).map((m) => m.text).join(' '));
  const bass = midi.tracks.find((t) => /^(Bas|Contrabas)/.test(t.name)); // the Acustic palette's bass is the arco contrabass
  console.log('bass range:', Math.min(...bass.notes.map((n) => n.midi)), '-', Math.max(...bass.notes.map((n) => n.midi)), '(E1=28, C3=48)');
}
// Simplu: chord step
await clickText('Simplu', '.seg-mode button');
await sleep(500);
await clickText('Acorduri', '.view-tabs button');
await page.waitForSelector('.chord-strip');
await sleep(600);
await shot('m3-simplu-acorduri', true);
// copy section inherits chords
await clickText('Strofă 2', '.rail-item');
await page.waitForSelector('.chord-strip');
await sleep(500);
await shot('m3-sectiune-copie-acorduri', true);
await clickText('Strofă 1', '.rail-item');
await clickText('Pro', '.seg-mode button');
await sleep(400);


// ===================== M4: arrangement, instruments, song transport =====================
console.log('--- M4 ---');
{
await clickText('Pro', '.seg-mode button');
await sleep(500);
await page.evaluate(() => window.scrollTo(0, 0));
const timeText = () => page.$eval('.time-main', (e) => e.textContent);
const secs = (s) => { const [m, r] = s.split('/')[0].trim().split(':').map(Number); return m * 60 + r; };
// first visit: empty Cache Storage so the lazy SoundFont download (with progress) is exercised
await page.evaluate(() => caches.delete('psalmist-soundfont-v1'));
await page.reload();
await page.waitForSelector('.roll-canvas', { timeout: 20000 });
await sleep(600);
await clickText('Tot cântecul', '.transport .seg button');
await sleep(400);
const segCount = await page.$$eval('.tl-seg', (e) => e.length);
console.log('timeline sections:', segCount, '| song length', (await timeText()));
await shot('m4-transport-mixer');
console.log('transport box:', await page.evaluate(() => { const r = document.querySelector('.transport').getBoundingClientRect(); const anc = []; for (let e = document.querySelector('.transport').parentElement; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.transform !== 'none') anc.push(e.className + ' ' + c.transform); } return JSON.stringify({ top: r.top, bottom: r.bottom, ih: innerHeight, anc }); }));
// play the whole song: SoundFont lazy-loads with progress
await clickText('Strofă 1', '.rail-item');
await sleep(300);
const bpb = await (await page.$('.btn-play')).boundingBox();
console.log('play button box', JSON.stringify(bpb));
must(await page.$eval('.btn-play', (b) => !b.disabled), 'play button is disabled although the section has a recording');
if (process.env.E2E_PROFILE) console.log('PROFILE', await page.evaluate(async () => { const o = {}; let t = performance.now(); const b = await window.__build('song', 0); o.build = ((performance.now() - t) / 1000).toFixed(1) + 's tracks=' + b.req.tracks.length + ' clips=' + b.req.clips.length; t = performance.now(); await window.__engine.loadInstruments(); o.sf = ((performance.now() - t) / 1000).toFixed(1); t = performance.now(); try { await Promise.race([window.__engine.play({ ...b.req, from: 0 }), new Promise((r) => setTimeout(r, 30000))]); } catch (e) { o.err = e.message; } o.play = ((performance.now() - t) / 1000).toFixed(1); o.playing = window.__engine.playing; window.__engine.stop(); return JSON.stringify(o); }));
await page.mouse.click(bpb.x + bpb.width / 2, bpb.y + bpb.height / 2);
const t0 = Date.now();
// the SoundFont / drum-kit / MIDI-channel checks below test the Clasic palette (the default Acustic palette has no SoundFont voices or drums)
await page.evaluate(() => window.__app.getState().setPalette('clasic'));
await sleep(400);
let sawProgress = false;
for (let i = 0; i < 480; i++) {
  const st = await page.evaluate(() => ({ sf: window.__engine.sfState, p: window.__engine.sfProgress, playing: window.__engine.playing }));
  if (st.sf === 'loading' && !sawProgress) { sawProgress = true; await shot('m4-incarcare-instrumente'); console.log('loading UI text:', await page.$$eval('.status-dot', (e) => e.map((x) => x.textContent).join(' | '))); }
  if (st.playing) break;
  if (i % 40 === 39) console.log('  ... waiting', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'sf', st.sf, 'progress', st.p, await page.evaluate(() => JSON.stringify({ sample: window.__engine.sampleState, ctx: window.__engine.rawContext?.state, t: window.__engine.rawContext?.currentTime, fail: window.__engine.failure, hidden: document.hidden, vis: document.visibilityState })));
  await sleep(250);
}
const coldSf = (Date.now() - t0) / 1000;
console.log('SoundFont load + start:', coldSf.toFixed(1) + 's', '| progress UI seen:', sawProgress, '| state:', await page.evaluate(() => window.__engine.sfState));
must(coldSf < 30, `cold SoundFont load + start took ${coldSf.toFixed(1)} s (limit 30 s)`);
must(await page.evaluate(() => window.__engine.sfState === 'ready'), 'SoundFont not ready');
await sleep(3500);
const p1 = secs(await timeText());
const voices1 = await page.evaluate(() => window.__engine.sfVoices);
console.log('whole-song playing, position advanced to', p1, 's | SoundFont voices sounding:', voices1);
// most tracks are tier-A samplers (not SoundFont voices) and the first seconds may be a pause: the voice count is informational, playback + position are asserted below
must(await page.evaluate(() => window.__engine.playing), 'not playing after start');
must(p1 > 0, 'position did not advance');
await shot('m4-redare-tot-cantecul');
// mute / solo live
const lv = () => page.evaluate(() => window.__engine.currentLevels);
const before = await lv();
const stripBtn = (name, which) => page.evaluate((name, which) => {
  const s = [...document.querySelectorAll('.chan')].find((x) => x.getAttribute('aria-label') === name);
  const b = [...s.querySelectorAll('.ms')].find((x) => x.textContent === which);
  b.click();
}, name, which);
const names = await page.$$eval('.chan', (e) => e.map((x) => x.getAttribute('aria-label')));
console.log('mixer tracks:', names.join(', '));
const acc = names.find((n) => !['Voce', 'Melodie', 'Metronom'].includes(n));
const tm = Date.now();
await stripBtn(acc, 'M');
const after = await lv();
const stillMute = await page.evaluate(() => window.__engine.playing);
console.log('mute applied live in', Date.now() - tm, 'ms (incl. e2e round trip) | levels changed:', JSON.stringify(before) !== JSON.stringify(after), '| still playing:', stillMute);
must(stillMute, 'playback stopped after mute');
must(JSON.stringify(before) !== JSON.stringify(after), 'mute did not change the levels');
await stripBtn(acc, 'M');
await stripBtn('Voce', 'S');
const solo = await lv();
console.log('solo voice -> other levels zero:', Object.entries(solo).filter(([k]) => k !== 'voce' && k !== 'metro').every(([, v]) => v === 0));
await stripBtn('Voce', 'S');
// presets
await clickText('Doar vocea', '.mixer-head .seg button');
const onlyVoice = await lv();
await clickText('Doar acompaniamentul', '.mixer-head .seg button');
const onlyAcc = await lv();
await clickText('Tot', '.mixer-head .seg button');
const all = await lv();
console.log('presets: doar vocea ->', onlyVoice.voce > 0 && Object.entries(onlyVoice).filter(([k]) => !['voce', 'metro'].includes(k)).every(([, v]) => v === 0),
  '| doar acompaniamentul ->', onlyAcc.voce === 0 && onlyAcc.melodie === 0 && Object.entries(onlyAcc).some(([k, v]) => !['voce', 'melodie', 'metro'].includes(k) && v > 0),
  '| tot ->', Object.entries(all).filter(([k]) => k !== 'metro').every(([, v]) => v > 0));
// seek
const tl = await (await page.$('.timeline')).boundingBox();
await page.mouse.click(tl.x + tl.width * 0.55, tl.y + tl.height / 2);
await sleep(1500);
const p2 = secs(await timeText());
const stillSeek = await page.evaluate(() => window.__engine.playing);
console.log('seek to ~55%: position', p2, 's (was', p1 + ')', '| still playing:', stillSeek);
must(stillSeek, 'playback stopped after seek');
await sleep(1200);
must(secs(await timeText()) >= p2, 'position does not advance after seek');
await shot('m4-seek');
// pause / play / stop
await page.click('.tbtn[aria-label="Pauză"]');
await sleep(300);
const pPause = secs(await timeText());
await sleep(600);
console.log('pause holds position:', secs(await timeText()) === pPause);
if (process.env.E2E_QUICK) { console.log('E2E_QUICK stop', fails); await browser.close(); process.exit(fails.length ? 1 : 0); }
await page.keyboard.press('Space');
await sleep(1500);
console.log('Space resumes:', await page.evaluate(() => window.__engine.playing));
await page.keyboard.press('Escape');
await sleep(400);
console.log('Esc stops and rewinds:', await page.evaluate(() => !window.__engine.playing), (await timeText()));
await page.mouse.click(tl.x + tl.width * 0.4, tl.y + tl.height / 2);
await sleep(300);
await page.keyboard.press('Home');
await sleep(300);
console.log('Home rewinds:', await timeText());
// M key on a focused strip
await page.evaluate((n) => [...document.querySelectorAll('.chan')].find((x) => x.getAttribute('aria-label') === n).focus(), acc);
await page.keyboard.press('m');
console.log('M key mutes focused track:', await page.evaluate((n) => [...document.querySelectorAll('.chan')].find((x) => x.getAttribute('aria-label') === n).classList.contains('is-muted'), acc));
await page.keyboard.press('m');
// section scope
await clickText('Secțiune', '.transport .seg button');
await page.click('.btn-play');
await sleep(2500);
console.log('section scope playing:', await page.evaluate(() => window.__engine.playing), (await timeText()));
await page.click('.tbtn[aria-label="Oprește"]');
await clickText('Intro', '.rail-item');
await sleep(600);
await shot('m4-aranjament-intro-generat', true);
await page.click('.btn-play');
await sleep(2200);
console.log('generated Intro plays by itself:', await page.evaluate(() => window.__engine.playing));
await page.click('.tbtn[aria-label="Oprește"]');
await clickText('Strofă 1', '.rail-item');
await sleep(500);
await clickText('Aranjament', '.view-tabs button'); await sleep(500);
console.log('arrangement panel instruments:', await page.$$eval('.inst-list li', (e) => e.map((x) => x.textContent).join(', ')));
await page.evaluate(() => document.querySelector('.arrange').scrollIntoView({ block: 'center' }));
await shot('m4-aranjament-panou');
// ===================== M5: melodic layers =====================
console.log('--- M5 ---');
await clickText('Tot cântecul', '.transport .seg button');
await sleep(300);
const mnames = await page.$$eval('.chan', (e) => e.map((x) => x.getAttribute('aria-label')));
const melodic = ['Temă (hook)', 'Răspunsuri', 'Contra-melodie'].filter((n) => mnames.includes(n));
console.log('melodic mixer tracks:', melodic.join(', '));
await page.click('.btn-play');
await page.waitForFunction(() => window.__engine.playing, { timeout: 60000 });
await sleep(800);
const lvM = await page.evaluate(() => window.__engine.currentLevels);
console.log('melodic levels audible:', JSON.stringify({ hook: lvM.hook, answers: lvM.answers, counter: lvM.counter }));
await shot('m5-mixer-straturi');
if (melodic.length) {
  await stripBtn(melodic[0], 'M');
  const lm = await page.evaluate(() => window.__engine.currentLevels);
  const mid = { 'Temă (hook)': 'hook', 'Răspunsuri': 'answers', 'Contra-melodie': 'counter' }[melodic[0]];
  console.log('Mute on', melodic[0], ': level before', lvM[mid], '-> after', lm[mid], '| verified:', lvM[mid] > 0 && lm[mid] === 0);
  await stripBtn(melodic[0], 'M');
  await stripBtn(melodic[0], 'S');
  const ls = await page.evaluate(() => window.__engine.currentLevels);
  console.log('S on', melodic[0], '-> only it audible:', Object.entries(ls).filter(([k, v]) => v > 0 && k !== 'metro').length === 1);
  await stripBtn(melodic[0], 'S');
}
await page.click('.tbtn[aria-label="Oprește"]');
await page.evaluate(() => document.querySelector('.layer-row').scrollIntoView({ block: 'center' }));
console.log('per-section notes:', await page.$$eval('.gen-note', (e) => e.map((x) => x.textContent).join(' / ')));
await shot('m5-aranjament-straturi');
const seedOf = () => page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('psalmist-studio'); r.onsuccess = () => { const g = r.result.transaction('projects').objectStore('projects').getAll(); g.onsuccess = () => res(g.result[0].arrangement?.seed ?? null); }; }));
const seed0 = await seedOf();
await clickText('Regenerează');
await sleep(900);
console.log('Regenerează changes the seed:', seed0, '->', await seedOf());
await clickText('Contra-melodie:', '.layer-btn');
await sleep(400);
console.log('counter toggled off in mixer:', !(await page.$$eval('.chan', (e) => e.map((x) => x.getAttribute('aria-label')))).includes('Contra-melodie'));
await clickText('Contra-melodie:', '.layer-btn');
await sleep(800);
// cache: reload and load again from Cache Storage
await page.reload();
await page.waitForSelector('.view-tabs', { timeout: 20000 });
await clickText('Acorduri', '.view-tabs button');
await page.waitForSelector('.roll-canvas', { timeout: 20000 });
const tc = Date.now();
await page.evaluate(() => window.__engine.loadInstruments());
const cacheSf = (Date.now() - tc) / 1000;
must(cacheSf < 10, `SoundFont from cache took ${cacheSf.toFixed(1)} s (limit 10 s)`);
console.log('SoundFont from cache after reload:', cacheSf.toFixed(1) + 's', '| cached bytes:', await page.evaluate(async () => (await (await (await caches.open('psalmist-soundfont-v1')).match(new URL('soundfonts/MuseScore_General.sf3', location.href))).arrayBuffer()).byteLength));
// MIDI export with GM programs + drums channel 10
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
await clickText('MIDI întreaga cântare');
await sleep(900);
for (const f of readdirSync(DL).filter((x) => x.endsWith('.mid'))) {
  const midi = new Midi(readFileSync(`${DL}/${f}`));
  console.log(f, midi.tracks.map((t) => `${t.name}[ch${t.channel + 1} gm${t.instrument.number}${t.instrument.percussion ? ' drums' : ''} n${t.notes.length}]`).join(', '));
  const byCh = new Map();
  for (const t of midi.tracks.filter((x) => x.notes.length && !x.instrument.percussion)) { const set = byCh.get(t.channel) ?? new Set(); set.add(t.instrument.number); byCh.set(t.channel, set); }
  must([...byCh.values()].every((v) => v.size === 1), 'MIDI: no channel carries two programs (' + [...byCh].map(([c, v]) => c + ':' + [...v]).join(' ') + ')');
  const drums = midi.tracks.find((t) => t.instrument.percussion);
  console.log('drums on channel 10:', !!drums && drums.channel === 9, '| programs set:', midi.tracks.filter((t) => !t.instrument.percussion && t.name !== 'Melodie').every((t) => Number.isInteger(t.instrument.number)), '| markers:', midi.header.meta.filter((m) => m.type === 'marker').length);
}

}
// 9. read back detected notes against ground truth
const gt = JSON.parse(readFileSync('test-audio/melody-do-major-90bpm.json', 'utf8')).notes;
const detected = await page.evaluate(async () => {
  const req = indexedDB.open('psalmist-studio');
  return await new Promise((res) => {
    req.onsuccess = () => {
      const tx = req.result.transaction('projects').objectStore('projects').getAll();
      tx.onsuccess = () => {
        const p = tx.result[0];
        const tk = p.sections.flatMap((s) => s.takes)[0];
        res({ original: tk.notesOriginal.map((n) => [n.midi, n.startSec]), corrected: tk.notesCorrected.map((n) => [n.midi, n.startSec, n.durSec]), key: p.key, bpm: p.bpm });
      };
    };
  });
});
let ok = 0;
for (const g of gt) if (detected.original.some(([m, s]) => m === g.midi && Math.abs(s - g.start) <= 0.05)) ok++;
console.log(`file test: ${ok}/${gt.length} notes (pitch + onset +-50 ms), key`, detected.key);
const g = 60 / detected.bpm / 2;
const offGrid = detected.corrected.filter(([, s]) => Math.abs(s / g - Math.round(s / g)) > 0.35).length;
console.log(`corrected notes: ${detected.corrected.length}, clearly off the 1/8 grid: ${offGrid}`);

// 10. persistence
await page.reload();
await page.waitForSelector('.roll-canvas', { timeout: 15000 });
await sleep(800);
const restored = await page.evaluate(() => document.body.innerText.includes('melody-do-major-90bpm') && document.body.innerText.includes('Ești vrednic'));
console.log('restored after reload:', restored);
await shot('11-dupa-reincarcare');

// 11. projects list + about
await page.goto(`${BASE}/#/`);
await waitText('Proiectele tale');
await shot('12-proiecte-lista');
await page.goto(`${BASE}/#/about`);
await waitText('Salamander');
await shot('13-despre-licente', true);

// ===== tuning a440 with non-zero offset starts without errors =====
{
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await waitText('Proiectele tale');
  const r = await page.evaluate(async () => {
    const e = window.__engine;
    e.setTuningCents(30, 'a440');
    try {
      await e.play({ from: 0, to: 1, loop: false, clips: [{ data: new Float32Array(44100), sr: 44100, startSec: 0, durSec: 1 }], tracks: [], bpm: 90, sig: { num: 4, den: 4, grouping: [4] }, metronome: false, levels: { voce: 0.9 } });
      const ok = e.playing; e.stop(); return ok ? 'ok' : 'not playing';
    } catch (err) { return 'ERR ' + err.message; }
  });
  console.log('a440 with +30 cents plays:', r);
}
// ===== M6: report, tempo assistant, minus, final recording, sheet, export, help, onboarding, undo depth =====
{
  await page.goto(`${BASE}/#/`);
  await page.reload();
  await waitText('Proiectele tale');
  await waitText('Deschide');
  await clickText('Deschide');
  await page.waitForSelector('.roll-canvas', { timeout: 20000 });
  await sleep(600);
  const tab = async (name) => { await goView(name); await sleep(500); };
  const wavInfo = (f) => { const b = readFileSync(`${DL}/${f}`); return { riff: b.toString('ascii', 0, 4), bits: b.readUInt16LE(34), sr: b.readUInt32LE(24), ch: b.readUInt16LE(22), bytes: b.length }; };
  const waitFile = async (re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = readdirSync(DL).find((x) => re.test(x) && !x.endsWith('.crdownload')); if (f) { await sleep(300); return f; } await sleep(300); } throw new Error('download missing ' + re); };

  // X0: voice report
  await tab('Raport voce');
  await waitText('Raportul vocii tale');
  console.log('report: intonation roll', !!(await page.$('.into-roll svg')), '| key advice', await page.evaluate(() => document.body.innerText.includes('Tonalitatea potrivită')), '| tips', (await page.$$('.tips li')).length);
  await shot('m6-raport-voce', true);

  // X0b: tempo & meter assistant (taps are optional)
  await clickText('Nu știu tempoul', '.view-nav button');
  await page.waitForSelector('dialog[open] .meter-card', { timeout: 15000 });
  console.log('meter options:', await page.$$eval('.meter-card', (c) => c.map((x) => x.querySelector('strong').textContent + ' ' + x.querySelector('.meter-nums').textContent)));
  await shot('m6-asistent-tempo');
  await clickText('Închide', 'dialog[open] .dialog-actions button');
  await sleep(300);

  // X0: minus export (WAV 24-bit)
  await tab('Minus');
  await waitText('Minusul tău');
  await shot('m6-minus');
  await clickText('Descarcă minusul');
  const minus = await waitFile(/-minus\.wav$/);
  console.log('minus wav:', minus, wavInfo(minus));

  // X0: final recording over the minus (fake mic)
  await tab('Înregistrare finală');
  await waitText('Începe înregistrarea');
  await page.$eval('.final-setup input[type=range]', (el) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '120'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await clickText('Începe înregistrarea', '.btn-rec');
  await waitText('Numărătoare', 20000);
  await shot('m6-inregistrare-numaratoare');
  await page.waitForFunction(() => document.body.innerText.includes('Înregistrez'), { timeout: 30000 });
  await sleep(4500);
  await shot('m6-inregistrare-finala');
  await clickText('Pauză', '.final-controls button');
  await waitText('În pauză');
  await clickText('Continuă', '.final-controls button');
  await waitText('Înregistrez');
  await sleep(2500);
  await clickText('Oprește și salvează', '.final-controls button');
  await waitText('Varianta 1', 30000);
  const takeRows = await page.$$eval('.take-list li', (l) => l.map((x) => x.textContent.trim().slice(0, 60)));
  console.log('final takes:', takeRows);
  must(takeRows.some((r) => r.includes('120 ms')), 'final take did not keep the 120 ms latency compensation');
  await shot('m6-variante-comping', true);

  // X3: sheet music
  await tab('Partitură');
  await page.waitForSelector('.sheet-host svg', { timeout: 60000 });
  console.log('sheet svg drawn:', await page.$$eval('.sheet-host svg', (s) => s.length), '| print button enabled:', await page.$eval('.sheet-view .btn-primary', (b) => !b.disabled));
  await shot('m6-partitura', true);

  // X3: export dialog (mix WAV, stems ZIP, MIDI, MusicXML)
  await tab('Exportă');
  await waitText('Piste separate');
  await shot('m6-exporta');
  // cancel an export mid-render: no file is written and the progress bar goes away
  await clickText('ZIP', '.export-list li:nth-child(2) button');
  await page.waitForSelector('.export-run', { timeout: 10000 });
  await clickText('Anulează', '.export-run button');
  await page.waitForFunction(() => !document.querySelector('.export-run'), { timeout: 30000 });
  await sleep(1500);
  must(!readdirSync(DL).some((f) => /piste\.zip$/.test(f)), 'a cancelled export still wrote a file');
  console.log('export cancel: progress closed, no file written');
  await clickText('WAV', '.export-list li:nth-child(1) button');
  await page.waitForSelector('.export-run', { timeout: 10000 });
  await shot('m6-exporta-progres');
  const mix = await waitFile(/^(?!.*minus).*\.wav$/);
  console.log('mix wav:', mix, wavInfo(mix));
  await clickText('ZIP', '.export-list li:nth-child(2) button');
  const zip = await waitFile(/piste\.zip$/);
  console.log('stems zip bytes:', readFileSync(`${DL}/${zip}`).length);
  await clickText('MusicXML', '.export-list li button');
  const xml = await waitFile(/\.musicxml$/);
  console.log('musicxml:', readFileSync(`${DL}/${xml}`, 'utf8').slice(0, 60).replace(/\n/g, ' '));

  // X4: help sheet, undo depth, piano-roll frame rate with 500 notes
  await tab('Compune');
  await page.keyboard.press('?');
  await waitText('Scurtături de la tastatură');
  await shot('m6-ajutor');
  await page.keyboard.press('Escape');
  await sleep(300);
  const perf = await page.evaluate(async () => {
    const app = window.__app;
    const st = () => app.getState();
    const sec = st().project.sections.find((s) => s.takes.length);
    const tk = sec.takes[0];
    const base = tk.notesCorrected;
    const notes = Array.from({ length: 500 }, (_, i) => ({ id: 'perf' + i, midi: 48 + (i % 24), startSec: i * 0.04, durSec: 0.12, velocity: 0.7, centsDev: 0, confidence: 1 }));
    const before = st().past.length;
    for (let i = 0; i < 55; i++) st().editNotes(sec.id, tk.id, i === 54 ? notes : base.concat([{ ...base[0], id: 'u' + i, startSec: 30 + i }]));
    const depth = st().past.length - before;
    for (let i = 0; i < 50; i++) st().undo();
    const undone = st().past.length;
    st().editNotes(sec.id, tk.id, notes);
    await new Promise((r) => setTimeout(r, 600));
    const cv = document.querySelector('.roll-canvas');
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { frames++; if (cv) cv.dispatchEvent(new WheelEvent('wheel', { deltaX: frames % 2 ? 40 : -40, shiftKey: true, bubbles: true })); if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { depth, undone, fps: Math.round(frames / ((performance.now() - t0) / 1000)) };
  });
  console.log('undo depth >= 50:', perf.depth >= 50, perf, '| roll fps with 500 notes (rAF + scroll):', perf.fps);
  await shot('m6-pianoroll-500');
  await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__app.getState().undo(); });

  // rename / delete confirmation
  await page.goto(`${BASE}/#/`);
  await waitText('Proiectele tale');
  await page.click('button[aria-label^="Șterge:"]');
  await waitText('Ștergi proiectul?');
  await shot('m6-confirmare-stergere');
  await clickText('Anulează', 'dialog[open] button');
  await sleep(300);
  console.log('delete confirm shown and cancelable: true');

  // rename a project
  await page.goto(`${BASE}/#/`);
  await waitText('Deschide');
  await page.click('button[aria-label^="Redenumește:"]');
  await page.waitForSelector('input[aria-label="Redenumește"]');
  await page.$eval('input[aria-label="Redenumește"]', (el) => el.select());
  await page.keyboard.type('Ești vrednic (nou)');
  await page.keyboard.press('Enter');
  await waitText('Ești vrednic (nou)');
  console.log('rename project: ok');

  // onboarding (first run)
  await page.evaluate(() => { sessionStorage.setItem('e2e-ob', '1'); localStorage.removeItem('psalmist.onboarded.v1'); });
  await page.reload();
  await waitText('Deschide');
  await clickText('Deschide');
  await page.waitForSelector('dialog.onboarding[open]', { timeout: 15000 });
  await shot('m6-onboarding');
  await clickText('Înainte', 'dialog.onboarding button');
  await clickText('Înainte', 'dialog.onboarding button');
  await clickText('Gata, să începem', 'dialog.onboarding button');
  await sleep(300);
  console.log('onboarding closed:', !(await page.$('dialog.onboarding[open]')));
  await page.evaluate(() => { sessionStorage.removeItem('e2e-ob'); localStorage.setItem('psalmist.onboarded.v1', '1'); });
}
// ===== robustness: Salamander samples unavailable -> GM piano fallback, non-blocking notice =====
{
  await page.goto(`${BASE}/#/`);
  await page.setRequestInterception(true);
  const block = (rq) => (/\/samples\/.*\.mp3/.test(rq.url()) ? rq.abort() : rq.continue());
  page.on('request', block);
  await page.reload();
  await waitText('Proiectele tale');
  await waitText('Deschide', 60000);
  await clickText('Deschide');
  await page.waitForSelector('.roll-canvas', { timeout: 20000 });
  await clickText('Strofă 1', '.rail-item');
  await sleep(400);
  await page.evaluate(() => document.querySelector('.btn-play').click());
  try { await page.waitForFunction(() => window.__engine.playing, { timeout: 90000 }); } catch (e) { console.log('BLOCKED-DIAG', await page.evaluate(() => JSON.stringify({ sf: window.__engine.sfState, sample: window.__engine.sampleState, failure: window.__engine.failure, toasts: [...document.querySelectorAll('[role=status],[role=alert]')].map((x) => x.textContent).join('|') }))); throw e; }
  await sleep(500);
  console.log('piano samples blocked -> still plays via SoundFont:', await page.evaluate(() => window.__engine.playing), '| notice:', await page.$$eval('.status-dot.error', (e) => e.map((x) => x.textContent).join('|')));
  await shot('m5-fallback-pian');
  await page.click('.tbtn[aria-label="Oprește"]');
  page.off('request', block);
  await page.setRequestInterception(false);
}

// 12. mobile 375
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${BASE}/#/`);
await sleep(600);
await shot('14-mobil-proiecte');
await clickText('Deschide');
await page.waitForSelector('.roll-canvas');
await sleep(900);
await shot('15-mobil-studio-pro', true);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('horizontal page overflow at 375px:', overflow);
await clickText('Simplu', '.seg-mode button');
await sleep(500);
await shot('16-mobil-studio-simplu', true);

await clickText('Pro', '.seg-mode button');
await sleep(700);
await shot('m3-mobil-pro', true);
await page.$eval('.roll-canvas', (e) => e.scrollIntoView({ block: 'center' }));
await sleep(300);
const mbox = await (await page.$('.roll-canvas')).boundingBox();
await page.touchscreen.tap(mbox.x + 46 + 60, mbox.y + 22 + 13);
await sleep(500);
await shot('m3-mobil-popover');
await page.keyboard.press('Escape');
const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('horizontal page overflow at 375px (M3 views):', overflow2);
await clickText('Simplu', '.seg-mode button');
await clickText('Acorduri', '.view-tabs button');
await sleep(600);
await shot('m3-mobil-simplu-acorduri', true);

await clickText('Pro', '.seg-mode button');
await sleep(600);
await shot('m4-mobil-pro', true);
const overflow3 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('horizontal page overflow at 375px (M4 views):', overflow3);
await page.screenshot({ path: `${SHOTS}/m4-mobil-transport.png` });

for (const [tabName, file] of [['Raport voce', 'm6-mobil-raport'], ['Minus', 'm6-mobil-minus'], ['Înregistrare finală', 'm6-mobil-inregistrare'], ['Partitură', 'm6-mobil-partitura'], ['Exportă', 'm6-mobil-exporta']]) {
  await goView(tabName);
  await sleep(tabName === 'Partitură' ? 4000 : 700);
  await shot(file, true);
  console.log(`horizontal page overflow at 375px (${tabName}):`, await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
}
if (fails.length) { console.log('E2E FAILED:', fails); process.exitCode = 1; }
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();

// M7 + Q: instruments, picker, user instrument, reverb space, tap-along grid, export audit (own browser run)
await import("./e2e-m7.mjs");
