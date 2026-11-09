// Ground-truth benchmark: a synthetic singer sings a public-domain song whose every parameter is known; the real app pipeline
// (scripts/song-from-vocal-full.mjs) builds the arrangement; we score it against the truth.
//   node scripts/benchmarks/run.mjs [--song silent-night|amazing-grace|ode-to-joy|greensleeves|all] [--mode metronome|taps|blind|all] [--register male|female] [--nomp3]
// metronome: the exact bar grid + tempo are given (like a perfect click track); taps: the bar grid with human tap noise + drift; blind: nothing is given.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SONGS, acceptableAt, chordOk, sing, wavBytes } from './singer.mjs';

const args = (() => { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; return o; })();
const songs = !args.song || args.song === 'all' ? Object.keys(SONGS) : args.song.split(',');
const modes = !args.mode || args.mode === 'all' ? ['metronome', 'taps', 'blind'] : args.mode.split(',');
const register = args.register ?? 'male';
const style = args.style ?? null; // acustic | vesel | clasic (never imn / organ by default)
const ROOT = resolve('bench-out'), LISTEN = resolve('listen');
mkdirSync(ROOT, { recursive: true }); mkdirSync(LISTEN, { recursive: true });

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const chordOf = (c) => { const m = /^([A-G])([#b]?)(.*)$/.exec(c); if (!m) return null; const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12; const rest = m[3].split('/')[0]; return { root: pc, minor: /^(m(?!aj)|min|dim)/.test(rest) }; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(0.9 * s.length))] : NaN; };
let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.577;

function runOne(id, mode) {
  const song = SONGS[id], tag = `${id}-${style && style !== 'acustic' ? style : mode}`, dir = resolve(ROOT, tag);
  mkdirSync(dir, { recursive: true });
  const { samples, sr, truth } = sing(song, { register, seed: 7 });
  writeFileSync(resolve(dir, 'vocal.wav'), wavBytes(samples, sr));
  const truthChords = truth.bars.map((t, i) => ({ t: Math.round(t * 1000) / 1000, chord: truth.chords[i] }));
  writeFileSync(resolve(dir, 'truth.json'), JSON.stringify(truthChords));
  const a = ['scripts/song-from-vocal-full.mjs', '--anomalies', '1', ...(style ? ['--style', style] : []), '--roomtone', '0.8', '--vocal', resolve(dir, 'vocal.wav'), '--genre', song.genre, '--out', resolve(dir, 'out'), '--truth', resolve(dir, 'truth.json')];
  if (mode === 'blind') a.push('--sig', 'auto');
  else {
    a.push('--sig', song.sig);
    const bars = mode === 'taps' ? truth.bars.map((t, i) => t + gauss() * 0.035 + 0.04 * Math.sin(i * 0.6)) : truth.bars;
    writeFileSync(resolve(dir, 'grid.json'), JSON.stringify(bars));
    a.push('--grid', resolve(dir, 'grid.json'), '--sections', `strofa:${song.chords.length}`);
    if (mode === 'metronome') a.push('--bpm', String(song.compound ? song.bpm * 3 : song.bpm));
  }
  const t0 = Date.now();
  const r = spawnSync('node', a, { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1500000 });
  const sumPath = resolve(dir, 'out', 'summary.json');
  if (!existsSync(sumPath)) return { id, mode, error: ((r.stderr || '') + (r.stdout || '')).split('\n').filter((l) => /FAILED|Error/.test(l)).slice(0, 3).join(' | ') || 'no summary' };
  const s = JSON.parse(readFileSync(sumPath, 'utf8'));
  // ---- scoring
  const keyOk = s.key && s.key.tonic === PC[song.key] && (song.mode === 'minor' ? /minor/i.test(s.key.mode) : s.key.mode === 'major');
  const meterOk = s.meter === song.sig, feelOk = (/\/8$/.test(s.meter)) === song.compound;
  const truthBpm = song.compound ? song.bpm * 3 : song.bpm;
  const bpmOk = Math.abs(s.bpm - truthBpm) <= 3 || Math.abs(s.bpm - song.bpm) <= 3 || (song.compound && Math.abs(s.bpm * 3 - truthBpm) <= 3);
  const barSec = s.tempo.barSec, trueBar = truth.barSec;
  const rows = []; // per our bar: truth chord vs ours
  for (const sec of s.sections) {
    if (!sec.chordsPerBar) continue;
    sec.chordsPerBar.forEach((names, b) => {
      const t = sec.origStartSec + (b + 0.5) * barSec;
      const k = Math.floor((t - truth.bars[0]) / trueBar + 1e-6);
      if (k < 0 || k >= truth.chords.length) return;
      const mn = names.split(' / ')[0];
      rows.push({ k, ref: truth.chords[k], mine: mn, prim: chordOk(truth.chords[k], mn), ok: acceptableAt(song, k).some((c) => chordOk(c, mn)) });
    });
  }
  rows.sort((x, y) => x.k - y.k);
  const primary = rows.length ? rows.filter((x) => x.prim).length / rows.length : NaN;
  const agree = rows.length ? rows.filter((x) => x.ok).length / rows.length : NaN;
  let hrOk = 0, hrN = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].k === rows[i - 1].k + 1) { hrN++; if ((rows[i].ref !== rows[i - 1].ref) === (rows[i].mine !== rows[i - 1].mine)) hrOk++; }
  const offs = truth.bars.map((tb) => { const k = Math.round((tb - s.tempo.barLineSec) / barSec); const d = s.tempo.barLineSec + k * barSec - tb; return Math.abs(d); }).map((d) => d * 1000);
  const au = s.soundAudit ?? {};
  if (!args.nomp3) {
    for (const [src, name] of [['mix.wav', 'mix'], ['minus.wav', 'minus']]) spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', resolve(dir, 'out', src), '-codec:a', 'libmp3lame', '-b:a', '192k', resolve(LISTEN, `bench-${tag}-${name}.mp3`)]);
  }
  return {
    id, mode, sec: Math.round((Date.now() - t0) / 1000), key: keyOk, keyGot: s.key, meter: s.meter, meterOk, feelOk, bpm: s.bpm, bpmOk, truthBpm,
    agree, primary, bars: rows.length, hr: hrN ? hrOk / hrN : NaN, anom: s.anomalies, clash: au.clashes ? `${au.clashes.before}>${au.clashes.after}` : '-', offMed: median(offs), offP90: p90(offs),
    chordino: au.selfConsistency, melodic: au.melodicPitch, miss: rows.filter((x) => !x.ok).slice(0, 6).map((x) => `${x.k + 1}:${x.ref}>${x.mine}`).join(' '),
  };
}

const results = [];
for (const id of songs) for (const mode of modes) {
  process.stdout.write(`${id} / ${mode} ... `);
  const r = runOne(id, mode); results.push(r);
  console.log(r.error ? 'ERROR ' + r.error : `key ${r.key ? 'ok' : 'WRONG ' + JSON.stringify(r.keyGot)}, ${r.meter} (${r.meterOk ? 'ok' : 'wrong'}), ${r.bpm} bpm (${r.bpmOk ? 'ok' : 'wrong, truth ' + r.truthBpm}), chords ${(100 * r.agree).toFixed(0)}% of ${r.bars}, ${r.sec}s`);
}
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
console.log('\nsong / mode          key  meter   feel  BPM(truth)   chords acc/prim  harm.rhythm  clashes anom  offset med/p90 ms');
for (const r of results) {
  if (r.error) { console.log(`${r.id}/${r.mode}`.padEnd(20), 'ERROR', r.error); continue; }
  console.log(`${r.id}/${r.mode}`.padEnd(20), (r.key ? 'ok' : 'NO').padEnd(4), `${r.meter}${r.meterOk ? '' : '!'}`.padEnd(7), (r.feelOk ? 'ok' : 'NO').padEnd(5), `${r.bpm}(${r.truthBpm})${r.bpmOk ? '' : '!'}`.padEnd(12), `${f(100 * r.agree)}/${f(100 * r.primary)}%`.padEnd(10), `${f(100 * r.hr)}%`.padEnd(12), String(r.clash).padEnd(8), String(r.anom ?? '-').padEnd(5), `${f(r.offMed)}/${f(r.offP90)}`);
}
writeFileSync(resolve(ROOT, `results-${modes.join('+')}-${register}.json`), JSON.stringify(results, null, 1));
for (const r of results) if (r.miss) console.log(`  ${r.id}/${r.mode} misses: ${r.miss}`);
