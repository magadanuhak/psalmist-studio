// "Construiește din vocea completă" benchmark (called by song-from-vocal.mjs --full).
//   node scripts/song-from-vocal.mjs --full --vocal <full-song vocal wav> [--bpm N] [--sig 4/4] [--genre worship|pop|cantare] [--emotion inchinare] [--out <dir>] [--truth <chords.json>] [--grid <json>]
// --grid: bar times (array, or { bars: [...] }) that simulate a user's accurate taps; they replace the grid estimated from the vocal.
// One vocal in; the form (intro / strofă / refren / interlude / bridge / outro) is found on the ORIGINAL timeline, every vocal section is
// harmonized from its own notes, and the minus lines up 1:1 with the original. mix.wav = the original vocal + our minus (ffmpeg).
import puppeteer from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { soundAudit } from './lib/sound-audit.mjs';

const args = (() => {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
  return o;
})();
if (!args.vocal) { console.error('usage: node scripts/song-from-vocal.mjs --full --vocal <wav> [--bpm N] [--sig 4/4] [--genre worship] [--out <dir>] [--truth <json>]'); process.exit(2); }
const vocal = resolve(args.vocal);
const outDir = resolve(args.out ?? 'song-from-vocal-out');
const BASE = process.env.BASE ?? 'http://localhost:5174';
const genre = args.genre ?? 'worship', emotion = args.emotion ?? 'inchinare';
const beatsFile = args.beats ? JSON.parse(readFileSync(resolve(args.beats), 'utf8')) : null;
const gridFile = args.grid ? JSON.parse(readFileSync(resolve(args.grid), 'utf8')) : null;
const gridBars = gridFile ? (Array.isArray(gridFile) ? gridFile : gridFile.bars) : null;
const wantBpm = args.bpm ? Number(args.bpm) : null, wantSig = args.sig ?? '4/4';
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'psalmist-full-'));
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...a], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr); };
const timings = {};
const stage = async (name, fn) => { const t0 = Date.now(); const r = await fn(); timings[name] = Math.round((Date.now() - t0) / 100) / 10; console.log(`  ${name}: ${timings[name]} s`); return r; };
const sigOf = (id) => ({ '4/4': { num: 4, den: 4, grouping: [4] }, '3/4': { num: 3, den: 4, grouping: [3] }, '2/4': { num: 2, den: 4, grouping: [2] }, '6/8': { num: 6, den: 8, grouping: [3, 3] }, '12/8': { num: 12, den: 8, grouping: [3, 3, 3, 3] } }[id] ?? { num: 4, den: 4, grouping: [4] });
const parseChord = (c) => {
  const m = /^([A-G])([#b♭♯]?)(.*)$/.exec(c.replace('♭', 'b').replace('♯', '#'));
  if (!m) return null;
  const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const rest = m[3].split('/')[0];
  return { root: ((pc % 12) + 12) % 12, fam: /^dim|^m7b5|^ø/.test(rest) ? 'dim' : /^m(?!aj)/.test(rest) || /^min/.test(rest) ? 'min' : 'maj' };
};

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!CHROME) { console.error('no Chrome / Edge found'); process.exit(4); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1360, height: 900 }, protocolTimeout: 900000 });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('psalmist.onboarded.v1', '1'); } catch { /* ignore */ } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (fn, ...a) => page.evaluate(fn, ...a);
try {
  console.log(`full vocal ${vocal}\n  genre ${genre}, emotion ${emotion}`);
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 }).catch(() => { throw new Error(`the app is not running at ${BASE} (npm run dev -- --port 5174)`); });
  await app(() => indexedDB.deleteDatabase('psalmist-studio'));
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });

  // 1. analyze the whole vocal (pitch tracker) -> notes
  await app(() => { const i = document.createElement('input'); i.type = 'file'; i.id = '__full'; document.body.appendChild(i); });
  await (await page.$('#__full')).uploadFile(vocal);
  const total = await stage('decode + analyze the full vocal', () => app(async () => {
    const f = document.querySelector('#__full').files[0];
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await f.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
    const { analyze } = await import('/src/dsp/analyze.ts');
    const an = analyze(mono, buf.sampleRate, 90);
    window.__fullKey = an.keyEstimate ? { tonic: an.keyEstimate.tonic, mode: an.keyEstimate.mode } : null;
    window.__fullNotes = an.notes.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity, centsDev: n.centsDev, confidence: n.confidence }));
    return { sec: buf.length / buf.sampleRate, notes: an.notes.length };
  }));
  if (args['dump-notes']) writeFileSync(join(outDir, 'notes.json'), JSON.stringify(await app(() => window.__fullNotes)));
  console.log(`  ${total.notes} notes in ${total.sec.toFixed(1)} s, key ${JSON.stringify(await app(() => window.__fullKey))}`);

  // 2. tempo (X0b phrase periodicity), bar grid, form
  const plan = await stage('tempo + form', () => app(async (wantBpm, wantSig, SIGS, totalSec, gridBars, beatsDown, perBar) => {
    const { detectMeter } = await import('/src/dsp/meter.ts');
    const { formFromVocal, mainBlockNotes } = await import('/src/dsp/formFromVocal.ts');
    const notes = window.__fullNotes;
    const blockNotes = mainBlockNotes(notes);
    const r = detectMeter({ notes: blockNotes });
    if (!r) throw new Error('not enough notes for the tempo');
    const found = r.options.some((o) => `${o.sig.num}/${o.sig.den}` === wantSig);
    const triple = !found && SIGS[wantSig]?.num === 12 && r.options[0].sig.den === 4;
    const top = r.options.find((o) => `${o.sig.num}/${o.sig.den}` === wantSig) ?? { ...r.options[0], sig: SIGS[wantSig] ?? r.options[0].sig };
    let bpm = wantBpm ?? (triple ? top.bpm * 3 : top.bpm);
    const sig = top.sig;
    let bar = (60 / bpm) * sig.num;
    if (!wantBpm) {
      // the repeated 4-bar phrase of the whole song pins the tempo much more precisely than the detector alone
      const { phrasePeriod } = await import('/src/dsp/meter.ts');
      const { denseNotes } = await import('/src/dsp/formFromVocal.ts');
      const ph = phrasePeriod(denseNotes(notes));
      if (ph && Math.abs(ph.sec / 4 - bar) / bar < 0.08) { bar = ph.sec / 4; bpm = Math.round((60 * sig.num) / bar * 10) / 10; }
    }
    // ONE global bar grid (period + phase) fitted to the whole vocal
    const { fitBarGrid } = await import('/src/dsp/formFromVocal.ts');
    const g = fitBarGrid(notes, bar, sig.num === 12 ? 4 : sig.num);
    let t0 = top.firstDownbeatSec % bar;
    if (g) { bar = g.barSec; bpm = Math.round((60 * sig.num) / bar * 10) / 10; t0 = g.t0; }
    if (gridBars) {
      const { gridFromBars } = await import('/src/dsp/tapGrid.ts');
      const gg = gridFromBars(gridBars, sig.num);
      if (gg) { bar = gg.barSec; t0 = gg.t0; bpm = gg.bpm; }
    }
    const form = formFromVocal(notes, bar, t0, totalSec);
    // --beats: PIECEWISE bar lines from the tracker's downbeats (a live song drifts; one linear fit is wrong somewhere)
    let pbars = null;
    if (beatsDown) {
      const bm = await import('/src/dsp/beatMap.ts');
      pbars = bm.barsFromDownbeats(beatsDown, perBar, bm.bestParity(beatsDown, perBar, t0));
      bar = (pbars[pbars.length - 1] - pbars[0]) / (pbars.length - 1); t0 = pbars[0]; bpm = Math.round((60 * sig.num) / bar * 10) / 10;
      for (const sc of form.sections) { sc.startSec = pbars[Math.min(pbars.length - 1, sc.startBar)]; sc.endSec = pbars[Math.min(pbars.length - 1, sc.startBar + sc.bars)]; }
    }
    return { bpm, sig, bar, t0, form, pbars, meter: r.options.map((o) => ({ meter: `${o.sig.num}/${o.sig.den}`, bpm: o.bpm, confidence: Math.round(o.confidence * 100) / 100 })) };
  }, wantBpm, wantSig, { '4/4': sigOf('4/4'), '3/4': sigOf('3/4'), '2/4': sigOf('2/4'), '6/8': sigOf('6/8'), '12/8': sigOf('12/8') }, total.sec, gridBars, beatsFile ? beatsFile.downbeats : null, Number(args.perbar ?? 2)));
  let f = plan.form;
  // --sections strofa:16[,refren:8]: the user recorded the sections separately, so the form is KNOWN (detection is for the blind full-vocal mode only)
  if (args.sections) { let b = 0; plan.form = f = { ...f, sections: args.sections.split(',').map((x) => { const [type, n] = x.split(':'); const bars = Number(n); const sec = { type, startBar: b, bars, startSec: plan.t0 + b * plan.bar, endSec: plan.t0 + (b + bars) * plan.bar, vocal: true }; b += bars; return sec; }) }; }
  console.log(`  ${plan.bpm} BPM ${plan.sig.num}/${plan.sig.den}, bar ${plan.bar.toFixed(3)} s, bar line at ${plan.t0.toFixed(2)} s; meter options ${JSON.stringify(plan.meter)}`);
  console.log('  form: ' + f.sections.map((s) => `${s.type}(${s.bars}) @${s.startSec.toFixed(1)}s`).join(' | '));

  // 3. project with that form; each vocal section gets ITS OWN take (cut from the original vocal on the bar grid)
  const pid = await stage('project', () => app(async (genre, emotion, plan) => {
    const p = await window.__app.getState().createProject({ name: 'Din vocea completă', genre, emotion, timeSig: plan.sig, bpm: plan.bpm, structure: plan.form.sections.map((s) => ({ type: s.type, bars: s.bars })) });
    return p.id;
  }, genre, emotion, plan));
  if (gridBars) await app(() => window.__app.getState().patchProject({ gridExact: true }));
  await page.evaluate((i) => { location.hash = '#/p/' + i; }, pid);
  await page.waitForSelector('.rail-item', { timeout: 30000 });
  // the key of the WHOLE vocal (more notes than any section) - set once the project is open, or setKey is a no-op
  await app(() => { const st = window.__app.getState(); if (window.__fullKey) { st.setKey(window.__fullKey); st.setKeyLocked(true); } });
  // --style acustic|vesel|clasic: instrument palette (default: the genre's own; organ only in Clasic)
  if (args.style) await app((st) => window.__app.getState().setPalette(st), args.style);
  if (args['answers-on']) await app(() => window.__app.getState().toggleLayer('answers')); // opt-in answers (off by default in Acustic / Vesel)
  // --roomtone <sec>: the user's "stai 2 secunde in liniste" step - a noise profile from the first seconds of the recording
  if (args.roomtone) await app(async (sec) => { const file = document.querySelector('#__full').files[0]; const ctx = new AudioContext({ sampleRate: 44100 }); const buf = await ctx.decodeAudioData(await file.arrayBuffer()); const { buildNoiseProfile } = await import('/src/dsp/clean.ts'); window.__app.getState().setRoomTone(buildNoiseProfile(buf.getChannelData(0).slice(0, Math.floor(sec * buf.sampleRate)), buf.sampleRate)); }, Number(args.roomtone));
  if (plan.pbars) await app((m) => window.__app.getState().setTempoMap(m), plan.pbars.map((x) => x - plan.pbars[0])); // the piecewise map drives all scheduling (accompaniment + section placement)
  if (args.dbg) console.log('  key after set', JSON.stringify(await app(() => window.__app.getState().project.key)));
  const ids = await app(() => window.__app.getState().project.sections.map((s) => s.id));
  await stage('import, clean, analyze and correct every vocal section', async () => {
    for (let i = 0; i < f.sections.length; i++) {
      const s = f.sections[i];
      if (!s.vocal) continue;
      const file = join(tmp, `s${i}.wav`);
      ff('-ss', String(Math.max(0, s.startSec)), '-to', String(s.endSec), '-i', vocal, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', file);
      await app((id, a, b) => { window.__sections = window.__sections ?? {}; window.__sections[id] = { startSec: a, endSec: b }; const st = window.__app.getState(); st.startOverride(id); st.selectSection(id); }, ids[i], s.startSec, s.endSec);
      await page.waitForSelector('input[data-testid="import-input"]', { timeout: 20000 });
      await (await page.$('input[data-testid="import-input"]')).uploadFile(file);
      await page.waitForFunction((id) => window.__app.getState().project.sections.find((x) => x.id === id)?.takes.length > 0, { timeout: 60000 }, ids[i]);
      await app(async (id) => {
        const st = window.__app.getState();
        const sec = st.project.sections.find((x) => x.id === id);
        await window.__app.getState().runAll(id, sec.activeTakeId ?? sec.takes[0].id);
        window.__app.getState().harmonize(id);
      }, ids[i]);
    }
  });

  if (args.dbg) { const d = await app(() => { const p = window.__app.getState().project; const sec = p.sections.find((x) => x.type === 'strofa'); const tk = sec.takes[0]; return { bpm: p.bpm, sig: p.timeSig, bars: sec.bars, n: tk.notesCorrected.length, no: tk.notesOriginal.length, first: tk.notesCorrected.slice(0, 30).map((n) => n.midi + '@' + n.startSec.toFixed(2)).join(' '), orig: tk.notesOriginal.slice(0, 30).map((n) => n.midi + '@' + n.startSec.toFixed(2)).join(' '), dur: tk.durationSec }; }); console.log(JSON.stringify(d)); }
  // 4. summary + chords per bar
  const result = await app(async (starts) => {
    const { arrangementFor, songLayout } = await import('/src/store/arrangeInput.ts');
    const { chordName } = await import('/src/theory/harmony/chords.ts');
    const p = window.__app.getState().project;
    const arr = arrangementFor(p);
    const lay = songLayout(p);
    const perBar = (s) => {
      const h = s.harmony;
      if (!h) return null;
      const list = h.variants[h.active];
      const bars = [];
      for (let b = 0; b < s.bars; b++) {
        const names = h.slots.map((sl, i) => ({ sl, c: list[i] })).filter((x) => x.sl.bar === b || (x.sl.bar < b && x.sl.bar + Math.round(x.sl.beats / p.timeSig.num) > b)).map((x) => chordName(x.c, 'letter', p.key));
        bars.push(names.join(' / ') || (bars[bars.length - 1] ?? ''));
      }
      return bars;
    };
    return {
      key: p.key, bpm: p.bpm, meter: `${p.timeSig.num}/${p.timeSig.den}`, genre: p.genre, simplicity: p.simplicity ?? 'simplu',
      sections: p.sections.map((s, i) => ({ label: s.label, type: s.type, bars: s.bars, origStartSec: Math.round(starts[i] * 10) / 10, chordsPerBar: perBar(s) })),
      tracks: arr?.tracks.map((t) => ({ name: t.name, notes: t.notes.length })) ?? [], songSec: arr ? Math.round(arr.songSec * 10) / 10 : null, layoutTotal: lay.total,
    };
  }, f.sections.map((s) => s.startSec));

  // --dump-flute <inst>: every note of that instrument's tracks, with the sample the sampler would pick and why it may sound noisy
  if (args['dump-flute']) {
    const rows = await app(async (inst) => {
      const { arrangementFor } = await import('/src/store/arrangeInput.ts');
      const { CATALOG } = await import('/src/audio/instruments/catalog.ts');
      const p = window.__app.getState().project, arr = arrangementFor(p);
      const e = CATALOG.find((x) => x.id === inst);
      const man = await (await fetch('/instruments/' + e.source.id + '/manifest.json')).json();
      const out = [];
      for (const t of arr.tracks) if (t.inst === inst) for (const n of t.notes) {
        const art = n.art && man.articulations[n.art] ? n.art : Object.keys(man.articulations)[0];
        const smp = man.articulations[art].samples.reduce((b, x) => (Math.abs(x.key - n.midi) < Math.abs(b.key - n.midi) ? x : b));
        const why = [];
        if (n.durSec < 0.18) why.push('short');
        if (n.midi < e.range[0] || n.midi > e.range[1]) why.push('out of range');
        if (smp.clarity < 0.5) why.push('low clarity');
        if (Math.abs(smp.key - n.midi) > 3) why.push('transposed ' + (n.midi - smp.key));
        if (/^(stac|pizz|trill|flutter|key|air|fx)/.test(art)) why.push('articulation ' + art);
        out.push({ track: t.id, t: +n.startSec.toFixed(2), midi: n.midi, dur: +n.durSec.toFixed(2), art, file: smp.file, key: smp.key, clarity: smp.clarity, why: why.join(', ') });
      }
      return out;
    }, args['dump-flute']);
    writeFileSync(join(outDir, 'flute-notes.json'), JSON.stringify(rows, null, 1));
    const bad = rows.filter((r) => r.why);
    console.log(`  ${args['dump-flute']}: ${rows.length} notes, ${bad.length} flagged`);
    for (const r of bad.slice(0, 40)) console.log(`    ${r.track} ${r.t}s midi ${r.midi} dur ${r.dur} ${r.art}/${r.file} clarity ${r.clarity} : ${r.why}`);
  }
  // --anomalies: the A4 anomaly detector on the realized arrangement (0 expected)
  let anomalies = null;
  if (args.anomalies) {
    anomalies = await app(async () => {
      const { arrangementFor } = await import('/src/store/arrangeInput.ts');
      const { findAnomalies } = await import('/src/theory/arrange/anomaly.ts');
      const { effectiveSection } = await import('/src/model/sections.ts');
      const { CATALOG } = await import('/src/audio/instruments/catalog.ts');
      const p = window.__app.getState().project, arr = arrangementFor(p);
      const vocal = arr.plan.flatMap((s, i) => { const eff = effectiveSection(p, p.sections[i]); const tk = eff.takes.find((x) => x.id === eff.activeTakeId); return (tk?.notesCorrected ?? []).map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })); });
      const rangeOf = (id, inst) => CATALOG.find((x) => x.id === inst)?.range;
      return findAnomalies(arr, { key: p.key, vocal, rangeOf, beatSec: 60 / p.bpm, beatsPerBar: p.timeSig.num });
    });
    writeFileSync(join(outDir, 'anomalies.json'), JSON.stringify(anomalies, null, 1));
    const by = {}; for (const a of anomalies) by[a.kind] = (by[a.kind] ?? 0) + 1;
    console.log(`  anomalies: ${anomalies.length} ${JSON.stringify(by)}`);
    for (const a of anomalies.slice(0, 25)) console.log(`    ${a.kind} ${a.track} @${a.time.toFixed(1)}s midi ${a.midi} ${a.detail}`);
  }
  // 5. exports
  const grab = async (label, expr, file) => stage(label, async () => {
    const len = await app(async (e) => {
      const buf = await (new Function('return (async () => { ' + e + ' })()'))();
      const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
      window.__out = u8;
      return u8.length;
    }, expr);
    const chunks = [];
    for (let o = 0; o < len; o += 4_000_000) chunks.push(Buffer.from(await app((a, b) => { let s = ''; const u = window.__out.subarray(a, b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }, o, Math.min(len, o + 4_000_000)), 'base64'));
    writeFileSync(join(outDir, file), Buffer.concat(chunks));
  });
  const exp = `const { exportSong } = await import('/src/store/exportSong.ts'); const o = await exportSong(window.__app.getState().project, { kind: 'minus', rate: 44100, stems: false, guide: false, countIn: false, metronome: false }); window.__last = o; return o.wav;`;
  await grab('export minus', exp, 'minus.wav');
  const loud = await app(() => ({ lufs: window.__last.lufs, tp: window.__last.truePeakDb }));
  await app((t0) => { window.__t0 = t0; }, plan.t0);
  const sound = await stage('sound audits (Chordino, melodic pitch, export audit)', () => soundAudit({ app, outDir, minusPath: join(outDir, 'minus.wav') }));
  await grab('export MIDI', `const { fullSongMidi } = await import('/src/store/arrangeInput.ts'); return fullSongMidi(window.__app.getState().project);`, 'song.mid');
  await grab('export MusicXML', `const { sheetXml } = await import('/src/store/sheet.ts'); return sheetXml(window.__app.getState().project) ?? '';`, 'song.musicxml');
  // the project's bar 0 is the original's bar line t0: delay the minus by t0 so it lines up 1:1 with the original vocal
  await stage('mix = original vocal + our minus (ffmpeg)', async () => {
    const d = Math.round(plan.t0 * 1000);
    ff('-i', vocal, '-i', join(outDir, 'minus.wav'), '-filter_complex', `[1:a]adelay=${d}|${d}[m];[0:a]aformat=channel_layouts=stereo[v];[v][m]amix=inputs=2:weights=1 0.8:normalize=0:duration=longest[o]`, '-map', '[o]', '-c:a', 'pcm_s24le', join(outDir, 'mix.wav'));
  });

  // 6. chord agreement vs a reference chart on the original timeline (per bar, middle of the bar; root + major/minor family)
  let agreement = null;
  if (args.truth) {
    const ev = JSON.parse(readFileSync(resolve(args.truth), 'utf8')).map((x) => ({ t: x.t, c: parseChord(x.chord), name: x.chord })).sort((a, b) => a.t - b.t);
    const at = (t) => { let r = null; for (const e of ev) if (e.t <= t) r = e; return r; };
    agreement = {};
    for (const sec of result.sections) {
      if (!sec.chordsPerBar || !/^(Strofă|Refren)/.test(sec.label)) continue;
      let root = 0, full = 0, n = 0;
      const rows = [];
      sec.chordsPerBar.forEach((names, b) => {
        let t = sec.origStartSec + (b + 0.5) * plan.bar;
        if (plan.pbars) { let k0 = 0; for (let k = 1; k < plan.pbars.length; k++) if (Math.abs(plan.pbars[k] - sec.origStartSec) < Math.abs(plan.pbars[k0] - sec.origStartSec)) k0 = k; t = (plan.pbars[k0 + b] + (plan.pbars[k0 + b + 1] ?? plan.pbars[k0 + b] + plan.bar)) / 2; }
        const ref = at(t);
        if (!ref?.c || t > ev[ev.length - 1].t + 4 || t < ev[0].t) return;
        const mine = parseChord(names.split(' / ')[0]);
        if (!mine) return;
        n++;
        if (ref.c.root === mine.root) root++;
        if (ref.c.root === mine.root && ref.c.fam === mine.fam) full++;
        rows.push(`${ref.name}>${names.split(' / ')[0]}`);
      });
      if (n) agreement[sec.label] = { bars: n, rootAgreement: Math.round((100 * root) / n), rootAndFamilyAgreement: Math.round((100 * full) / n), referenceVsOurs: rows };
    }
  }
  if (args.shots) { // m8-taburi-*.png: every main tab of the finished project
    mkdirSync(resolve('screenshots'), { recursive: true });
    const pid2 = await app(() => window.__app.getState().project.id);
    for (const tab of ['voce', 'acorduri', 'aranjament', 'mix', 'export']) { await app((i, t) => { location.hash = `#/p/${i}/${t}`; }, pid2, tab); await sleep(2500); await page.screenshot({ path: resolve('screenshots', `m8-taburi-${tab}.png`) }); }
    await page.setViewport({ width: 375, height: 800 }); await app((i) => { location.hash = `#/p/${i}/voce`; }, pid2); await sleep(1500); await page.screenshot({ path: resolve('screenshots', 'm8-taburi-voce-mobil.png') });
  }
  const summary = { ...result, tempo: { bpm: plan.bpm, barSec: plan.bar, barLineSec: plan.t0, options: plan.meter }, form: f.sections, chordAgreement: agreement, soundAudit: sound, anomalies: anomalies ? anomalies.length : null, loudness: loud, timingsSec: timings, files: ['minus.wav', 'mix.wav', 'song.mid', 'song.musicxml', 'summary.json'] };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nkey ${JSON.stringify(result.key)}  ${result.bpm} BPM  ${result.meter}  genre ${genre}  simplicity ${result.simplicity}`);
  for (const s of result.sections) console.log(`  ${s.label.padEnd(10)} ${String(s.bars).padStart(2)} bars @${String(s.origStartSec).padStart(5)}s  ${s.chordsPerBar ? s.chordsPerBar.join(' | ') : '(generated)'}`);
  if (agreement) for (const [k, v] of Object.entries(agreement)) console.log(`  agreement ${k}: root ${v.rootAgreement}%, root+family ${v.rootAndFamilyAgreement}% (${v.bars} bars)  ${v.referenceVsOurs.join(' ')}`);
  console.log(`output: ${outDir}`);
} catch (e) {
  console.error('FAILED: ' + (e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
