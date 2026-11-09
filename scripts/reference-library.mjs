#!/usr/bin/env node
// Reference library (local tool, NOT shipped). Runs Sonic Annotator on a folder of the user's songs
// (Chordino simplechord, QM key detector, QM bar & beat tracker) and writes ONLY aggregate statistics:
// key-relative chord progressions, harmonic rhythm, form (phrase) lengths, tempo / meter histograms.
// No audio is copied anywhere and no file names, titles or per-song records are written.
//
// usage: node scripts/reference-library.mjs <folder> [out.json]
//   default out.json: src/theory/harmony/reference-stats.json  (the file that feeds the bias tables)
// env:   SONIC_ANNOTATOR=<path to sonic-annotator.exe> (default: C:\Users\Admin\tools\sonic-annotator\sonic-annotator-win64\sonic-annotator.exe)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SA = process.env.SONIC_ANNOTATOR || 'C:\\Users\\Admin\\tools\\sonic-annotator\\sonic-annotator-win64\\sonic-annotator.exe';
const T_CHORD = 'vamp:nnls-chroma:chordino:simplechord';
const T_KEY = 'vamp:qm-vamp-plugins:qm-keydetector:key';
const T_BEATS = 'vamp:qm-vamp-plugins:qm-barbeattracker:beats';
const NATIVE = new Set(['.wav', '.flac', '.ogg', '.aiff', '.aif']);
const AUDIO = new Set([...NATIVE, '.mp3', '.m4a', '.aac', '.wma', '.opus']);

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

export function parsePc(s) { const m = /^([A-G])([#b]?)/.exec(s); if (!m) return null; return (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12; }

/** Chordino label -> { pc, q } with q in maj|min|dim|aug|sus|dom7, or null for "N" (no chord). */
export function parseChord(label) {
  if (!label || label === 'N') return null;
  const m = /^([A-G][#b]?)([^/]*)(?:\/.*)?$/.exec(label.trim()); if (!m) return null;
  const q = m[2]; let k = 'maj';
  if (/dim|m7b5/.test(q)) k = 'dim'; else if (/aug|\+/.test(q)) k = 'aug'; else if (/^m(?!aj)/.test(q)) k = 'min'; else if (/sus/.test(q)) k = 'sus'; else if (/^(7|9|11|13)/.test(q)) k = 'dom7';
  return { pc: parsePc(m[1]), q: k };
}

/** Key label ("C major", "A minor", or numeric 1..24 like the QM detector) -> { tonic, mode } */
export function parseKey(s) {
  const m = /^([A-G][#b]?)\s*(major|minor|maj|min)?/i.exec(String(s).trim());
  if (m) return { tonic: parsePc(m[1]), mode: /^min/i.test(m[2] || '') ? 'minor' : 'major' };
  const n = parseInt(s, 10); if (n >= 1 && n <= 24) return n <= 12 ? { tonic: (n - 1) * 1 % 12, mode: 'major' } : { tonic: (n - 13) % 12, mode: 'minor' };
  return null;
}

export function csvRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur); rows.push(cells.slice(1)); // drop the file-name column: never kept
  }
  return rows;
}

function run(transform, file) {
  return execFileSync(SA, ['-d', transform, file, '-w', 'csv', '--csv-stdout'], { encoding: 'utf8', maxBuffer: 1 << 27, stdio: ['ignore', 'pipe', 'ignore'] });
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else if (AUDIO.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

/** Analyse one file's annotation rows into a compact record (kept in memory only, never written). */
export function summarize(chordRows, keyRows, beatRows) {
  const keyDur = {};
  const endT = Math.max(0, ...[...chordRows, ...beatRows].map((r) => parseFloat(r[0])).filter(Number.isFinite));
  for (let i = 0; i < keyRows.length; i++) {
    const t = parseFloat(keyRows[i][0]); const next = i + 1 < keyRows.length ? parseFloat(keyRows[i + 1][0]) : Math.max(t + 1, endT);
    const lab = keyRows[i][keyRows[i].length - 1] || keyRows[i][1]; const k = parseKey(lab);
    if (k) bump(keyDur, `${k.tonic}|${k.mode}`, Math.max(0.1, next - t));
  }
  const bestKey = Object.entries(keyDur).sort((a, b) => b[1] - a[1])[0]; if (!bestKey) return null;
  const [tonic, mode] = bestKey[0].split('|'); const tn = +tonic;
  // beats -> tempo, meter, bar starts
  const beats = beatRows.map((r) => ({ t: parseFloat(r[0]), n: parseInt(r[r.length - 1], 10) || parseInt(r[1], 10) || 0 })).filter((b) => Number.isFinite(b.t));
  if (beats.length < 8) return null;
  const ibi = []; for (let i = 1; i < beats.length; i++) ibi.push(beats[i].t - beats[i - 1].t);
  ibi.sort((a, b) => a - b); const bpm = 60 / ibi[Math.floor(ibi.length / 2)];
  const maxCount = Math.max(...beats.map((b) => b.n));
  const meter = maxCount === 3 ? '3/4' : maxCount === 6 ? '6/8' : maxCount === 2 ? '2/4' : '4/4';
  const barStarts = beats.filter((b) => b.n === 1).map((b) => b.t);
  // chord sequence (collapse repeats, drop N)
  const ch = []; let lastKey = '';
  for (const r of chordRows) {
    const c = parseChord(r[r.length - 1]); if (!c) continue;
    const rel = (c.pc - tn + 12) % 12; const k = `${rel}${c.q}`;
    if (k !== lastKey) { ch.push({ t: parseFloat(r[0]), rel, q: c.q, k }); lastKey = k; }
  }
  if (ch.length < 4) return null;
  // chord duration in bars
  const barLen = barStarts.length > 1 ? (barStarts[barStarts.length - 1] - barStarts[0]) / (barStarts.length - 1) : (60 / bpm) * 4;
  const durBars = []; for (let i = 0; i + 1 < ch.length; i++) durBars.push((ch[i + 1].t - ch[i].t) / barLen);
  // per-bar dominant chord for phrase length estimation
  const perBar = [];
  for (let b = 0; b + 1 < barStarts.length; b++) { const hit = ch.filter((c) => c.t >= barStarts[b] - 0.2 && c.t < barStarts[b + 1] - 0.2)[0]; perBar.push(hit ? hit.k : perBar[perBar.length - 1] ?? ''); }
  let phrase = 0, bestScore = 0.55;
  for (const lag of [2, 4, 6, 8, 12, 16]) {
    if (perBar.length < lag * 2) continue; let m = 0, n = 0; for (let i = lag; i < perBar.length; i++) { n++; if (perBar[i] === perBar[i - lag]) m++; }
    if (n && m / n > bestScore) { bestScore = m / n; phrase = lag; }
  }
  return { mode, ch, durBars, bpm, meter, bars: barStarts.length, phrase };
}

function aggregate(recs) {
  const A = { songs: recs.length, progressions: { major: { bigram: {}, trigram: {}, start: {} }, minor: { bigram: {}, trigram: {}, start: {} } }, harmonicRhythm: { chordLengthBars: {}, changesPerBarMean: 0 }, form: { totalBars: {}, phraseBars: {} }, tempo: { bpm: {}, meter: {} }, modes: {} };
  let cpbSum = 0;
  const rom = (c) => `${ROMAN[c.rel]}${c.q === 'min' ? 'm' : c.q === 'dim' ? 'o' : c.q === 'aug' ? '+' : c.q === 'sus' ? 'sus' : c.q === 'dom7' ? '7' : ''}`;
  for (const r of recs) {
    const P = A.progressions[r.mode]; bump(A.modes, r.mode);
    bump(P.start, rom(r.ch[0]));
    for (let i = 0; i + 1 < r.ch.length; i++) bump(P.bigram, `${rom(r.ch[i])}>${rom(r.ch[i + 1])}`);
    for (let i = 0; i + 2 < r.ch.length; i++) bump(P.trigram, `${rom(r.ch[i])}>${rom(r.ch[i + 1])}>${rom(r.ch[i + 2])}`);
    for (const d of r.durBars) bump(A.harmonicRhythm.chordLengthBars, d < 0.75 ? '0.5' : d < 1.5 ? '1' : d < 3 ? '2' : d < 6 ? '4' : '8+');
    cpbSum += r.ch.length / Math.max(1, r.bars);
    bump(A.form.totalBars, String(Math.round(r.bars / 8) * 8)); if (r.phrase) bump(A.form.phraseBars, String(r.phrase));
    bump(A.tempo.bpm, String(Math.round(r.bpm / 5) * 5)); bump(A.tempo.meter, r.meter);
  }
  A.harmonicRhythm.changesPerBarMean = +(cpbSum / Math.max(1, recs.length)).toFixed(3);
  for (const m of ['major', 'minor']) {
    const P = A.progressions[m];
    const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
    P.bigram = top(P.bigram, 60); P.trigram = top(P.trigram, 60);
    const tot = Object.values(P.bigram).reduce((a, b) => a + b, 0) || 1;
    P.bigramProb = Object.fromEntries(Object.entries(P.bigram).map(([k, v]) => [k, +(v / tot).toFixed(4)]));
  }
  return A;
}

function main() {
  const [dir, outArg] = process.argv.slice(2);
  if (!dir) { console.error('usage: node scripts/reference-library.mjs <folder> [out.json]'); process.exit(2); }
  if (!fs.existsSync(SA)) { console.error('Sonic Annotator not found: ' + SA); process.exit(2); }
  const out = path.resolve(outArg || 'src/theory/harmony/reference-stats.json');
  const files = walk(path.resolve(dir)); const recs = []; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refstats-'));
  let n = 0;
  for (const f of files) {
    n++; let src = f; let made = false;
    try {
      if (!NATIVE.has(path.extname(f).toLowerCase())) { src = path.join(tmp, `t${n}.wav`); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-ac', '1', '-ar', '44100', src], { stdio: 'ignore' }); made = true; }
      const rec = summarize(csvRows(run(T_CHORD, src)), csvRows(run(T_KEY, src)), csvRows(run(T_BEATS, src)));
      if (rec) recs.push(rec); else console.error(`[${n}/${files.length}] skipped (not enough musical information)`);
    } catch (e) { console.error(`[${n}/${files.length}] failed: ${String(e.message).split('\n')[0]}`); }
    finally { if (made) fs.rmSync(src, { force: true }); }
    process.stdout.write(`\r${n}/${files.length}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const stats = { version: 1, generatedBy: 'scripts/reference-library.mjs', ...aggregate(recs) };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(stats, null, 1));
  console.log(`\nanalysed ${recs.length}/${files.length} files -> ${out} (statistics only)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
