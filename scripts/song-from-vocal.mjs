// Headless benchmark: from an isolated vocal to an accompaniment, driving the real app (dev server) with puppeteer-core.
//   node scripts/song-from-vocal.mjs --vocal <wav> --strofa <start>-<end> --refren <start>-<end> [--bpm N] [--sig 4/4] [--genre cantare] [--emotion inchinare] [--out <dir>] [--truth <chords.json>] [--dump-notes]
//   node scripts/song-from-vocal.mjs --full --vocal <full-song vocal wav> [--bpm N] [--sig 4/4] [--genre worship|pop|cantare] [--out <dir>] [--truth <chords.json>]   (form found automatically)
// --truth: [{ "t": seconds in the vocal file, "chord": "Gm" }, ...] reference chords; reports exact chord-per-bar agreement (root + major/minor family) per section.
// Needs: `npm run dev -- --port 5174` running (override with BASE=http://host:port), ffmpeg on PATH, Chrome or Edge installed.
// Inputs are read from absolute paths and are never copied into the project; segments are cut into the OS temp folder.
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
if (args.full) { await import('./song-from-vocal-full.mjs'); process.exit(process.exitCode ?? 0); }
const need = (k) => { if (!args[k]) { console.error(`missing --${k}\nusage: node scripts/song-from-vocal.mjs --vocal <wav> --strofa <start>-<end> --refren <start>-<end> [--bpm N] [--sig 4/4] [--genre cantare] [--emotion inchinare] [--out <dir>]`); process.exit(2); } return args[k]; };
const vocal = resolve(need('vocal'));
const range = (k) => { const m = /^([\d.]+)-([\d.]+)$/.exec(need(k)); if (!m) { console.error(`--${k} must look like 24.8-47.0`); process.exit(2); } return [Number(m[1]), Number(m[2])]; };
const strofa = range('strofa'), refren = range('refren');
const outDir = resolve(args.out ?? 'song-from-vocal-out');
const BASE = process.env.BASE ?? 'http://localhost:5174';
const genre = args.genre ?? 'cantare', emotion = args.emotion ?? 'inchinare';
const wantBpm = args.bpm ? Number(args.bpm) : null;
const wantSig = args.sig ?? null;
if (!existsSync(vocal)) { console.error('vocal not found: ' + vocal); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'psalmist-sfv-'));
const cut = (name, [s, e]) => {
  const f = join(tmp, name);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(s), '-to', String(e), '-i', vocal, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', f], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('ffmpeg failed: ' + r.stderr); process.exit(3); }
  return f;
};
const parseChord = (c) => {
  const m = /^([A-G])([#b♭♯]?)(.*)$/.exec(c.replace('♭', 'b').replace('♯', '#'));
  if (!m) return null;
  const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const rest = m[3].split('/')[0];
  const fam = /^dim|^m7b5|^ø/.test(rest) ? 'dim' : /^m(?!aj)/.test(rest) || /^min/.test(rest) ? 'min' : 'maj';
  return { root: ((pc % 12) + 12) % 12, fam };
};
/** exact chord-per-bar agreement: the reference chord at the middle of each bar vs the first chord we put in that bar */
function scoreTruth(truth, result, origT0, bar) {
  const ev = truth.map((x) => ({ t: x.t, c: parseChord(x.chord), name: x.chord })).sort((a, b) => a.t - b.t);
  const at = (t) => { let r = null; for (const e of ev) if (e.t <= t) r = e; return r; };
  const out = {};
  for (const sec of result.sections) {
    if (!(sec.label in origT0) || !sec.chordsPerBar) continue;
    let root = 0, full = 0, n = 0;
    const rows = [];
    sec.chordsPerBar.forEach((names, b) => {
      const ref = at(origT0[sec.label] + (b + 0.5) * bar);
      const mine = parseChord(names.split(' / ')[0]);
      if (!ref?.c || !mine) return;
      n++;
      if (ref.c.root === mine.root) root++;
      if (ref.c.root === mine.root && ref.c.fam === mine.fam) full++;
      rows.push(`${ref.name}>${names.split(' / ')[0]}`);
    });
    out[sec.label] = { bars: n, rootAgreement: n ? Math.round((100 * root) / n) : 0, rootAndFamilyAgreement: n ? Math.round((100 * full) / n) : 0, referenceVsOurs: rows };
  }
  return out;
}
const timings = {};
const stage = async (name, fn) => { const t0 = Date.now(); const r = await fn(); timings[name] = Math.round((Date.now() - t0) / 100) / 10; console.log(`  ${name}: ${timings[name]} s`); return r; };

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!CHROME) { console.error('no Chrome / Edge found'); process.exit(4); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'], defaultViewport: { width: 1360, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('psalmist.onboarded.v1', '1'); } catch { /* ignore */ } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (fn, ...a) => page.evaluate(fn, ...a);
try {
  console.log(`vocal ${vocal}\n  strofa ${strofa.join('-')} s, refren ${refren.join('-')} s, genre ${genre}, emotion ${emotion}`);
  const strofaWav = cut('strofa.wav', strofa), refrenWav = cut('refren.wav', refren);
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => !!window.__app, { timeout: 30000 }).catch(() => { throw new Error(`the app is not running at ${BASE} (start it with: npm run dev -- --port 5174)`); });
  await app(() => indexedDB.deleteDatabase('psalmist-studio'));
  await page.reload();
  await page.waitForFunction(() => window.__app?.getState().ready, { timeout: 30000 });

  // project with the "Formă rapidă" structure
  const sigOf = (id) => ({ '4/4': { num: 4, den: 4, grouping: [4] }, '3/4': { num: 3, den: 4, grouping: [3] }, '2/4': { num: 2, den: 4, grouping: [2] }, '6/8': { num: 6, den: 8, grouping: [3, 3] } }[id] ?? { num: 4, den: 4, grouping: [4] });
  const id = await stage('project', async () => {
    const pid = await app(async (genre, emotion, bpm, sig) => {
      const { DEFAULT_QUICK, buildQuickForm, quickBars } = await import('/src/model/presets.ts');
      const q = { ...DEFAULT_QUICK, introBars: bpm < 100 ? 8 : 4, bridgeBars: bpm < 100 ? 8 : 4, outroBars: 4 };
      const types = buildQuickForm(q);
      const bars = quickBars(types, q, bpm);
      const p = await window.__app.getState().createProject({ name: 'Din vocal', genre, emotion, timeSig: sig, bpm, structure: types.map((type, i) => ({ type, bars: bars[i] })) });
      return p.id;
    }, genre, emotion, wantBpm ?? 90, sigOf(wantSig ?? '4/4'));
    await page.evaluate((i) => { location.hash = '#/p/' + i; }, pid);
    await page.waitForSelector('input[data-testid="import-input"]', { timeout: 30000 });
    return pid;
  });

  const sectionIdOf = (label) => app((l) => window.__app.getState().project.sections.find((s) => s.label === l)?.id, label);
  const importTake = async (label, file) => {
    const sid = await sectionIdOf(label);
    await app((s) => window.__app.getState().selectSection(s), sid);
    await page.evaluate((l) => { const el = [...document.querySelectorAll('.rail-item')].find((e) => e.textContent.includes(l)); el?.click(); }, label);
    await sleep(400);
    const input = await page.$('input[data-testid="import-input"]');
    await input.uploadFile(file);
    await page.waitForFunction((s) => window.__app.getState().project.sections.find((x) => x.id === s)?.takes.length > 0, { timeout: 60000 }, sid);
    return sid;
  };
  const takeOf = (sid) => app((s) => { const x = window.__app.getState().project.sections.find((y) => y.id === s); return x.takes.find((t) => t.id === x.activeTakeId)?.id ?? x.takes[0].id; }, sid);
  const runAll = (sid, tid) => app(async (s, t) => { await window.__app.getState().runAll(s, t); }, sid, tid);

  // strofa: import -> clean -> analyze -> correct, then tempo & meter
  const sid1 = await importTake('Strofă 1', strofaWav);
  const tid1 = await takeOf(sid1);
  await stage('strofa clean+analyze+correct', () => runAll(sid1, tid1));
  const meter = await stage('tempo & meter (X0b)', async () => app(async (sid, tid, wantBpm, wantSig, SIGS) => {
    const { detectMeter } = await import('/src/dsp/meter.ts');
    const st = window.__app.getState();
    const take = st.project.sections.find((s) => s.id === sid).takes.find((t) => t.id === tid);
    const r = detectMeter({ notes: take.notesOriginal.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity })) });
    if (!r) return null;
    const top = r.options[0];
    // a requested meter is honoured even when the detector ranks it lower (the top-2 are still reported)
    const opt = (wantSig && (r.options.find((o) => `${o.sig.num}/${o.sig.den}` === wantSig) ?? { ...top, sig: SIGS[wantSig] ?? top.sig })) || top;
    return { options: r.options.map((o) => ({ meter: `${o.sig.num}/${o.sig.den}`, bpm: o.bpm, bars: o.bars, confidence: Math.round(o.confidence * 100) / 100, firstDownbeatSec: Math.round(o.firstDownbeatSec * 100) / 100, pickupSec: Math.round(o.pickupSec * 100) / 100, why: o.explanation })), chosen: { ...opt, bpm: wantBpm ?? opt.bpm } };
  }, sid1, tid1, wantBpm, wantSig, { '4/4': sigOf('4/4'), '3/4': sigOf('3/4'), '2/4': sigOf('2/4'), '6/8': sigOf('6/8') }));
  if (!meter) throw new Error('not enough notes to detect the tempo; pass --bpm and --sig');
  const ch = meter.chosen;
  const bar = (60 / ch.bpm) * ch.sig.num;
  const shift1 = (ch.pickupSec > 0 ? bar : 0) - ch.firstDownbeatSec;
  await stage('apply tempo / meter / pickup to the strofa', () => app(async (sid, tid, o) => {
    await window.__app.getState().applyMeter({ bpm: o.bpm, sig: o.sig, bars: o.bars, sectionId: sid, takeId: tid, shiftSec: (o.pickupSec > 0 ? (60 / o.bpm) * o.sig.num : 0) - o.firstDownbeatSec });
  }, sid1, tid1, ch));
  const fitBars = (label) => app(async (l, bar) => {
    const st = window.__app.getState();
    const sec = st.project.sections.find((s) => s.label === l);
    const tk = sec.takes.find((t) => t.id === sec.activeTakeId) ?? sec.takes[0];
    st.patchSection(sec.id, { bars: Math.max(2, Math.ceil(tk.durationSec / bar - 0.2)) });
  }, label, bar);
  await fitBars('Strofă 1');

  // refren: import -> clean -> analyze -> correct, pickup aligned to a bar line with the project tempo
  const sid2 = await importTake('Refren 1', refrenWav);
  const tid2 = await takeOf(sid2);
  await stage('refren clean+analyze+correct', () => runAll(sid2, tid2));
  const shift2 = await stage('align the refren (pickup)', () => app(async (sid, tid) => {
    const { detectMeter } = await import('/src/dsp/meter.ts');
    const st = window.__app.getState();
    const p = st.project;
    const take = p.sections.find((s) => s.id === sid).takes.find((t) => t.id === tid);
    const r = detectMeter({ notes: take.notesOriginal.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity })) });
    const o = r?.options.find((x) => x.sig.num === p.timeSig.num && x.sig.den === p.timeSig.den);
    if (!o) return 0;
    const barLen = (60 / p.bpm) * p.timeSig.num;
    await st.applyMeter({ bpm: p.bpm, sig: p.timeSig, bars: o.bars, sectionId: sid, takeId: tid, shiftSec: (o.pickupSec > 0 ? barLen : 0) - o.firstDownbeatSec });
    return (o.pickupSec > 0 ? barLen : 0) - o.firstDownbeatSec;
  }, sid2, tid2));
  await fitBars('Refren 1');

  // copies of a recorded section follow its length
  await app(() => { const st = window.__app.getState(); for (const s of st.project.sections) { const src = st.project.sections.find((x) => x.id === s.sourceSectionId); if (src && src.bars !== s.bars) st.patchSection(s.id, { bars: src.bars }); } });

  // chords (Simplu) for both recorded sections; the other sections are copies or generated
  await stage('chords (Simplu)', () => app(async (a, b) => { const st = window.__app.getState(); st.harmonize(a); st.harmonize(b); }, sid1, sid2));

  // arrangement + melodic layers + exports
  await app(() => { const st = window.__app.getState(); const sec = st.project.sections.find((x) => x.label === 'Strofă 1'); const tk = sec.takes[0]; window.__rawNotes = tk.notesOriginal.map((n) => [Math.round(n.startSec * 1000) / 1000, Math.round(n.durSec * 1000) / 1000, n.midi, Math.round((n.velocity ?? 0.7) * 100) / 100]); });
  const result = await stage('arrangement + summary', () => app(async () => {
    const { arrangementFor, songLayout } = await import('/src/store/arrangeInput.ts');
    const { chordName } = await import('/src/theory/harmony/chords.ts');
    const { analyzeVoice, recommendKey, VOICE_LABEL } = await import('/src/dsp/voiceReport.ts');
    const { effectiveSection } = await import('/src/model/sections.ts');
    const p = window.__app.getState().project;
    const arr = arrangementFor(p);
    const lay = songLayout(p);
    const perBar = (s) => {
      const src = s.harmony ? s : p.sections.find((x) => x.id === s.sourceSectionId);
      const h = src?.harmony;
      if (!h) return null;
      const list = h.variants[h.active];
      const bars = [];
      for (let b = 0; b < s.bars; b++) {
        const names = h.slots.map((sl, i) => ({ sl, c: list[i] })).filter((x) => x.sl.bar === b || (x.sl.bar < b && x.sl.bar + Math.round(x.sl.beats / p.timeSig.num) > b)).map((x) => chordName(x.c, 'letter', p.key));
        bars.push(names.join(' / ') || (bars[bars.length - 1] ?? ''));
      }
      return bars;
    };
    const src = p.sections.find((s) => s.takes.length);
    const take = src.takes.find((t) => t.id === src.activeTakeId) ?? src.takes[0];
    const notes = p.sections.filter((s) => s.takes.length).flatMap((s) => (s.takes.find((t) => t.id === s.activeTakeId) ?? s.takes[0]).notesOriginal);
    const rep = analyzeVoice({ notes, analysis: take.analysis ?? null, bpm: p.bpm });
    const adv = recommendKey(rep, p.key);
    return {
      key: p.key, bpm: p.bpm, meter: `${p.timeSig.num}/${p.timeSig.den}`, genre: p.genre, emotion: p.emotion, simplicity: p.simplicity ?? 'simplu',
      sections: p.sections.map((s, i) => ({ label: s.label, type: s.type, bars: s.bars, startSec: Math.round(lay.sections[i].startSec * 10) / 10, chordsPerBar: perBar(s) })),
      tracks: arr?.tracks.map((t) => ({ name: t.name, notes: t.notes.length })) ?? [], songSec: arr ? Math.round(arr.songSec * 10) / 10 : null,
      voiceReport: { voiceType: rep.voiceType && VOICE_LABEL[rep.voiceType], range: rep.range, tessitura: rep.tessitura, noteCount: rep.noteCount, intonation: rep.intonation, timing: rep.timing, breath: rep.breath, dynamics: rep.dynamics, recommendedKey: adv.newKey, recommendedSemitones: adv.semitones },
      effective: p.sections.map((s) => effectiveSection(p, s).takes.length > 0),
    };
  }));

  const grab = async (label, expr, file) => stage(label, async () => {
    const len = await app(async (e) => {
      const buf = await (async () => { const f = new Function('return (async () => { ' + e + ' })()'); return f(); })();
      const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
      window.__out = u8;
      return u8.length;
    }, expr);
    const chunks = [];
    for (let o = 0; o < len; o += 4_000_000) chunks.push(Buffer.from(await app((a, b) => { let s = ''; const u = window.__out.subarray(a, b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }, o, Math.min(len, o + 4_000_000)), 'base64'));
    writeFileSync(join(outDir, file), Buffer.concat(chunks));
    return len;
  });
  const exp = (kind) => `const { exportSong } = await import('/src/store/exportSong.ts'); const o = await exportSong(window.__app.getState().project, { kind: '${kind}', rate: 44100, stems: false, guide: false, countIn: false, metronome: false }); window.__last = o; return o.wav;`;
  await grab('export minus', exp('minus'), 'minus.wav');
  const minusInfo = await app(() => ({ lufs: window.__last.lufs, tp: window.__last.truePeakDb }));
  const sound = await stage('sound audits (Chordino, melodic pitch, export audit)', () => soundAudit({ app, outDir, minusPath: join(outDir, 'minus.wav') }));
  await grab('export mix (vocal + minus)', exp('mix'), 'mix.wav');
  const mixInfo = await app(() => ({ lufs: window.__last.lufs, tp: window.__last.truePeakDb }));
  await grab('export MIDI', `const { fullSongMidi } = await import('/src/store/arrangeInput.ts'); return fullSongMidi(window.__app.getState().project);`, 'song.mid');
  await grab('export MusicXML', `const { sheetXml } = await import('/src/store/sheet.ts'); return sheetXml(window.__app.getState().project) ?? '';`, 'song.musicxml');

  if (args['dump-notes']) writeFileSync(join(outDir, 'strofa-notes.json'), JSON.stringify(await app(() => window.__rawNotes)));
  const agreement = args.truth ? scoreTruth(JSON.parse(readFileSync(resolve(args.truth), 'utf8')), result, { 'Strofă 1': strofa[0] - shift1, 'Refren 1': refren[0] - shift2 }, bar) : null;
  const summary = { ...result, meterDetection: meter.options, chordAgreement: agreement, soundAudit: sound, loudness: { minus: minusInfo, mix: mixInfo }, timingsSec: timings, files: ['minus.wav', 'mix.wav', 'song.mid', 'song.musicxml', 'summary.json'] };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nkey ${JSON.stringify(summary.key)}  ${summary.bpm} BPM  ${summary.meter}  simplicity ${summary.simplicity}`);
  for (const s of summary.sections) console.log(`  ${s.label.padEnd(10)} ${String(s.bars).padStart(2)} bars  ${s.chordsPerBar ? s.chordsPerBar.join(' | ') : '(generated)'}`);
  if (agreement) for (const [k, v] of Object.entries(agreement)) console.log(`  agreement ${k}: root ${v.rootAgreement}%, root+family ${v.rootAndFamilyAgreement}% (${v.bars} bars)  ${v.referenceVsOurs.join(' ')}`);
  console.log(`output: ${outDir}`);
} catch (e) {
  console.error('FAILED: ' + (e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
