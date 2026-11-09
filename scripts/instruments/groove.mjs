// Groove MIDI Dataset (Magenta, CC BY 4.0, midi-only zip) -> public/instruments/grooves/grooves.json
// usage: node scripts/instruments/groove.mjs   (expects the zip extracted in <cache>/groove/groove)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CACHE, OUT, ROOT } from './lib.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));
const { Midi } = require('@tonejs/midi');
const DIR = path.join(CACHE, 'groove', 'groove');
if (!fs.existsSync(path.join(DIR, 'info.csv'))) throw new Error('groove dataset missing: ' + DIR);

const ROLES = ['k', 's', 'ss', 'hc', 'ho', 'hp', 'tl', 'tm', 'th', 'cr', 'rd'];
const ROLE_OF = { 36: 'k', 35: 'k', 38: 's', 40: 's', 37: 'ss', 42: 'hc', 22: 'hc', 46: 'ho', 26: 'ho', 44: 'hp', 41: 'tl', 43: 'tl', 45: 'tm', 47: 'tm', 48: 'th', 50: 'th', 49: 'cr', 57: 'cr', 55: 'cr', 52: 'cr', 51: 'rd', 59: 'rd', 53: 'rd', 56: 'rd' };
const GOOD_BEAT = /^(rock|pop|gospel|country|soul|funk|dance|blues|punk|reggae|jazz|highlife|neworleans)/;
const GOOD_FILL = /^(rock|pop|gospel|country|soul|funk|dance|blues|punk|reggae|highlife)/;
const METER = { '4-4': { sig: '4/4', beats: 4 }, '3-4': { sig: '3/4', beats: 3 }, '6-8': { sig: '6/8', beats: 3 } };

const rows = fs.readFileSync(path.join(DIR, 'info.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const c = l.split(','); return { drummer: c[0], style: c[3], bpm: +c[4], type: c[5], ts: c[6], file: c[7] };
});

const r3 = (x) => Math.round(x * 1000) / 1000;
function parse(row) {
  const m = METER[row.ts]; if (!m) return [];
  const midi = new Midi(fs.readFileSync(path.join(DIR, row.file)));
  const ppq = midi.header.ppq; const notes = [];
  for (const t of midi.tracks) for (const n of t.notes) { const r = ROLE_OF[n.midi]; if (r) notes.push({ pos: n.ticks / ppq, r, v: Math.max(1, Math.round(n.velocity * 127)) }); }
  if (!notes.length) return [];
  const end = Math.max(...notes.map((n) => n.pos));
  const nBars = Math.max(1, Math.floor(end / m.beats + 0.15)); const out = [];
  const windows = row.type === 'fill' ? [[0, 1]] : [[1, 1], [Math.max(1, Math.floor(nBars / 2)), 1], [1, 2]];
  for (const [b0, len] of windows) {
    if (row.type !== 'fill' && b0 + len > nBars + 1) continue;
    const s = b0 * m.beats, e = (b0 + len) * m.beats;
    const ev = notes.filter((n) => n.pos >= s - 0.12 && n.pos < e - 0.12).map((n) => [r3(Math.max(0, n.pos - s)), ROLES.indexOf(n.r), n.v]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (ev.length < 3) continue; out.push({ ev, bars: len, sig: m.sig, beats: m.beats });
  }
  return out;
}

function feelOf(ev) {
  const off = ev.filter((e) => [3, 10, 4].includes(e[1]) && (e[0] % 1) > 0.4 && (e[0] % 1) < 0.85).map((e) => e[0] % 1).sort((a, b) => a - b);
  const swing = off.length >= 3 && off[Math.floor(off.length / 2)] > 0.6;
  const s16 = ev.filter((e) => [3, 10].includes(e[1]) && [0.25, 0.75].some((q) => Math.abs((e[0] % 1) - q) < 0.06)).length;
  return swing ? 'swing' : s16 >= 4 ? 'straight16' : 'straight8';
}

const pats = []; const seen = new Set();
for (const row of rows) {
  const good = row.type === 'fill' ? GOOD_FILL.test(row.style) : GOOD_BEAT.test(row.style);
  if (!good) continue;
  if (row.type === 'beat' && /^jazz/.test(row.style) && row.ts === '4-4') continue; // keep jazz only for waltz / compound
  for (const w of parse(row)) {
    const sig = JSON.stringify(w.ev.map((e) => [Math.round(e[0] * 8), e[1]])) + w.bars; if (seen.has(sig)) continue; seen.add(sig);
    const dens = w.ev.length / (w.beats * w.bars); const vel = w.ev.reduce((a, e) => a + e[2], 0) / w.ev.length;
    pats.push({ type: row.type, style: row.style.split('/')[0], bpm: row.bpm, sig: w.sig, bars: w.bars, feel: feelOf(w.ev), dens: r3(dens), vel: Math.round(vel), ev: w.ev, _score: dens * vel });
  }
}
const scores = pats.map((p) => p._score).sort((a, b) => a - b); const q = (f) => scores[Math.floor(f * (scores.length - 1))];
const t1 = q(0.33), t2 = q(0.66);
pats.forEach((p, i) => {
  p.id = `${p.type === 'fill' ? 'f' : 'g'}${i}`;
  p.energy = p._score < t1 ? 'low' : p._score < t2 ? 'mid' : 'high';
  p.tempo = p.bpm < 84 ? 'slow' : p.bpm <= 115 ? 'mid' : 'fast'; delete p._score;
});
const dst = path.join(OUT, 'grooves'); fs.mkdirSync(dst, { recursive: true });
const data = {
  version: 1, roles: ROLES,
  attribution: 'Groove MIDI Dataset (c) Google LLC / Magenta, licensed CC BY 4.0 (https://magenta.tensorflow.org/datasets/groove). Converted to compact pattern JSON; positions in quarter-note beats within the bar.',
  license: 'CC-BY-4.0', source: 'https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip', patterns: pats,
};
fs.writeFileSync(path.join(dst, 'grooves.json'), JSON.stringify(data));
fs.copyFileSync(path.join(DIR, 'LICENSE'), path.join(dst, 'LICENSE-groove.txt'));
const cnt = {}; for (const p of pats) { const k = `${p.type}/${p.sig}/${p.feel}`; cnt[k] = (cnt[k] || 0) + 1; }
console.log(pats.length, 'patterns', (fs.statSync(path.join(dst, 'grooves.json')).size / 1e3).toFixed(0), 'KB', cnt);
