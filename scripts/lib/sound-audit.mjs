// Q1 / Q4 audits for the benchmark scripts: Chordino on the rendered minus vs the app's chord chart, solo-rendered melodic tracks vs their MIDI,
// and the export audit (loudness, clipping, spectral balance, masking, taste) of the last `exportSong` call (window.__last).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SA = process.env.SONIC_ANNOTATOR ?? 'C:/Users/Admin/tools/sonic-annotator/sonic-annotator-win64/sonic-annotator.exe';

const parseChord = (c) => {
  const m = /^([A-G])([#b]?)(.*)$/.exec(String(c).replace('♭', 'b').replace('♯', '#'));
  if (!m) return null;
  const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const rest = m[3].split('/')[0];
  return { root: ((pc % 12) + 12) % 12, minor: /^(m(?!aj)|min|dim)/.test(rest) };
};

export async function soundAudit({ app, outDir, minusPath, log = console.log }) {
  const res = { selfConsistency: null, rootOnly: null, bars: 0, melodicPitch: null, melodicNotes: 0, audit: null, warnings: [] };
  // ---- Chordino self-consistency (per bar, root + major / minor)
  if (existsSync(SA)) {
    const dir = join(outDir, 'chordino');
    mkdirSync(dir, { recursive: true });
    const r = spawnSync(SA, ['-d', 'vamp:nnls-chroma:chordino:simplechord', minusPath, '-w', 'csv', '--csv-basedir', dir, '--csv-force'], { encoding: 'utf8' });
    const f = readdirSync(dir).find((x) => /simplechord\.csv$/.test(x));
    if (r.status === 0 && f) {
      const ev = readFileSync(join(dir, f), 'utf8').trim().split(/\r?\n/).map((l) => { const i = l.indexOf(','); return { t: Number(l.slice(0, i)), c: l.slice(i + 1).replace(/"/g, '') }; }).filter((e) => Number.isFinite(e.t));
      const chart = await app(async () => { const m = await import('/src/store/audioAudit.ts'); return m.chordChart(window.__app.getState().project); });
      const bar = await app(() => { const p = window.__app.getState().project; return (60 / p.bpm) * p.timeSig.num; });
      const total = chart.length ? chart[chart.length - 1].t + chart[chart.length - 1].dur : 0;
      let n = 0, ok = 0, rootOk = 0, nThird = 0, okThird = 0;
      const miss = [];
      for (let k = 0; (k + 1) * bar <= total + 1e-6; k++) {
        const mid = (k + 0.5) * bar;
        const ours = chart.find((c) => mid >= c.t - 1e-6 && mid < c.t + c.dur - 1e-6);
        let theirs = null;
        for (const e of ev) if (e.t <= mid) theirs = e; else break;
        const th = theirs ? parseChord(theirs.c) : null;
        if (!ours || !th) continue;
        n++;
        if (ours.hasThird && th.root === ours.root) { nThird++; if (th.minor === ours.minor) okThird++; }
        if (th.root === ours.root) { rootOk++; if (th.minor === ours.minor) ok++; else miss.push(`${k}:${ours.name}>${theirs.c}`); } else miss.push(`${k}:${ours.name}>${theirs.c}`);
      }
      res.barsWithThird = nThird; res.qualityOnThird = nThird ? okThird / nThird : null; res.bars = n; res.mismatches = miss; res.selfConsistency = n ? ok / n : null; res.rootOnly = n ? rootOk / n : null;
      log(`  Chordino on the minus: ${(100 * (res.selfConsistency ?? 0)).toFixed(0)}% of ${n} bars agree with the chord chart (root only ${(100 * (res.rootOnly ?? 0)).toFixed(0)}%); quality on the ${nThird} bars whose voicing contains the third: ${(100 * (res.qualityOnThird ?? 0)).toFixed(0)}%`);
    } else log('  Chordino failed: ' + (r.stderr || '').slice(0, 200));
  } else log('  Sonic Annotator not found, self-consistency skipped');
  // ---- melodic tracks vs their MIDI
  const mp = await app(async () => { const m = await import('/src/store/audioAudit.ts'); return m.auditMelodicPitch(window.__app.getState().project); });
  res.melodicPitch = mp.ratio; res.melodicNotes = mp.notes; res.melodicByTrack = mp.byTrack; res.melodicWrong = mp.wrong.slice(0, 12);
  log(`  melodic tracks: ${mp.correct}/${mp.notes} notes at the right pitch (${(100 * mp.ratio).toFixed(1)}%), ${mp.within10} within 10 cents`);
  // ---- clash finder: accompaniment notes a semitone / flat 9th from the real sung pitch for > 150 ms, before and after the guard
  res.clashes = await app(async () => {
    const A = await import('/src/store/arrangeInput.ts'), R = await import('/src/theory/arrange/realize.ts');
    const p = window.__app.getState().project;
    // the SAME analysis the harmonization used: each section's own take (original pitches), in song time
    const lay = A.songLayout(p);
    const vocal = p.sections.flatMap((sec, i) => { const tk = sec.takes.find((x) => x.id === sec.activeTakeId); return (tk?.notesOriginal ?? []).map((n) => ({ midi: n.midi, startSec: lay.sections[i].startSec + n.startSec, durSec: n.durSec })); });
    if (!vocal.length) return null;
    const after = R.findClashes(A.arrangementFor(p), vocal), before = R.findClashes(A.arrangementUnguarded(p), vocal);
    return { before: before.length, after: after.length, left: after.slice(0, 10).map((c) => `${c.track}:${c.midi}/${c.vocalMidi}@${c.startSec.toFixed(1)}`) };
  });
  if (res.clashes) log(`  clash finder (accompaniment note a semitone / b9 from the sung pitch > 150 ms): ${res.clashes.before} before the guard, ${res.clashes.after} after ${res.clashes.left.join(' ')}`);
  // ---- export audit (loudness, clipping, balance, masking, taste)
  const a = await app(() => { const x = window.__last?.audit; return x ? { lufs: x.lufs, truePeakDb: x.truePeakDb, clipped: x.clipped, maxDeviationDb: x.maxDeviationDb, maskingDb: x.maskingDb, bands: x.bands, maxSimultaneous: x.taste.maxSimultaneous, contrast: x.taste.contrast, counterPerBar: x.taste.counterPerBar, perSection: x.taste.perSection, warnings: x.warnings.map((w) => w.id) } : null; });
  res.audit = a;
  // gate: root agreement >= 95%, quality agreement >= 95% only where our voicing has the third (Chordino reads third-less chords as major)
  if ((res.rootOnly ?? 1) < 0.95 || (res.qualityOnThird ?? 1) < 0.95) res.warnings.push('selfLow');
  if (res.melodicPitch < 0.98) res.warnings.push('pitchLow');
  if (a) res.warnings.push(...a.warnings);
  if (a) log(`  audit: ${a.lufs.toFixed(1)} LUFS, peak ${a.truePeakDb.toFixed(1)} dB, clipped ${a.clipped}, balance dev ${a.maxDeviationDb.toFixed(1)} dB, masking ${a.maskingDb.toFixed(1)} dB, max ${a.maxSimultaneous} tracks together, warnings: ${res.warnings.join(', ') || 'none'}`);
  return res;
}
