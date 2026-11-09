// Fast harmony benchmark: notes.json (from song-from-vocal --full --dump-notes) + a truth file; the grid is the oracle (user taps).
import { it } from 'vitest';
import { readFileSync, writeFileSync as wf } from 'fs';
const require_fs = { writeFileSync: wf };
import { correctNotes } from '../../src/dsp/correct';
import { DEFAULT_CORRECTION, type Genre, type Project, type Section } from '../../src/model/types';
import { TIME_SIGS } from '../../src/music/timesig';
import { buildHarmony, harmonyInputFor } from '../../src/store/harmonyInput';
import { makeCtx, unary, emission, transition, pickPool } from '../../src/theory/harmony/harmonize';
import { chordName } from '../../src/theory/harmony/index';

const D = process.env.REF ?? 'C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/ref2';
const BAR = 2.827029, BPM = process.env.SIG === '12/8' ? 254.7 : 84.9;
const pc = (c: string) => { const m = /^([A-G])([b#]?)(m?)/.exec(c)!; return { root: (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, min: m[3] === 'm' }; };
it('grid oracle', () => {
  const all = JSON.parse(readFileSync(D + '/out-g-worship/notes.json', 'utf8')) as { startSec: number; durSec: number; midi: number; velocity: number }[];
  const truth = (JSON.parse(readFileSync(D + '/truth.json', 'utf8')) as { t: number; chord: string }[]);
  const at = (t: number) => { let r = truth[0]; for (const e of truth) if (e.t <= t) r = e; return r.chord; };
  const sig = process.env.SIG === '12/8' ? TIME_SIGS.find((x) => x.id === '12/8')!.sig : TIME_SIGS[0].sig, key = { tonic: 7, mode: 'minor' as const };
  const res: string[] = [];
  for (const genre of (process.env.GENRES ?? 'worship,cantare,pop').split(',') as Genre[]) {
    const tot: Record<string, [number, number]> = {};
    for (const [label, type, start, bars] of [['strofa', 'strofa', 24.404, 8], ['refren', 'refren', 47.02, 12]] as const) {
      const ns = all.filter((n) => n.startSec >= start - 0.3 && n.startSec < start + bars * BAR - 0.3).map((n, i) => ({ id: 'n' + i, midi: n.midi, startSec: n.startSec - start, durSec: n.durSec, velocity: n.velocity, centsDev: 0, confidence: 1 }));
      const cor = correctNotes(ns as never, key, BPM, sig, DEFAULT_CORRECTION);
      const sec: Section = { id: 's', type, label, order: 0, bars, generated: false, activeTakeId: 't', takes: [{ id: 't', rawAudioId: 'r', latencyMs: 0, durationSec: bars * BAR, createdAt: 0, source: 'import', notesOriginal: ns as never, notesCorrected: cor, correction: DEFAULT_CORRECTION }] } as Section;
      const nxt: Section = { ...sec, id: 'n', type: type === 'strofa' ? 'refren' : 'strofa' };
      const p = { id: 'p', name: 'r', version: 1, genre, emotion: 'inchinare', timeSig: sig, bpm: BPM, key, keyLocked: true, gridExact: process.env.LOCK !== '0', sections: type === 'strofa' ? [sec, nxt] : [nxt, sec], voices: [], createdAt: 0, updatedAt: 0 } as unknown as Project;
      const inp = harmonyInputFor(p, sec); if (typeof inp === 'string') throw new Error(inp);
      const h = buildHarmony(inp);
      if (process.env.DBG && label === 'strofa' && genre === 'worship') { const nm = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B']; res.push('DBG ' + h.active + ' A:' + h.variants.A.map((c) => chordName(c, 'letter', key)).join(',') + ' B:' + h.variants.B.map((c) => chordName(c, 'letter', key)).join(',') + ' ' + h.slots.map((s) => s.bar + ':' + s.startSec.toFixed(2) + ' ' + inp.notes.filter((n) => n.startSec >= s.startSec - 0.1 && n.startSec < s.startSec + s.durSec - 0.1).map((n) => nm[n.midi % 12] + (n.durSec > 0.5 ? '*' : '')).join(' ')).join(' | ') + ' beatmap ' + inp.beatMap!.times.slice(0, 10).map((x) => x.toFixed(2)).join(',')); }
      if (process.env.DBG && label === 'strofa' && genre === 'worship') { const ctx = makeCtx({ ...inp, rate: 1 }); for (const i of [1, 2, 7]) { const pl = pickPool(ctx, 'A', i, undefined); res.push('POOL' + i + ' ' + pl.map((c) => chordName(c.chord, 'letter', key) + ' u' + unary(ctx, 'A', c, i).toFixed(2) + ' e' + emission(ctx, c, i).toFixed(2)).join(' ; ')); } }
      const list = h.variants[h.active ?? 'A'];
      const rows: string[] = []; let ok = 0;
      for (let b = 0; b < bars; b++) {
        const sl = h.slots.findIndex((s) => s.bar === b);
        const mine = chordName(list[sl], 'letter', key), ref = at(start + (b + 0.5) * BAR);
        const a = pc(mine), r = pc(ref);
        if (a.root === r.root && a.min === r.min) ok++; else if (a.root === r.root && /^[A-G][b#]?(7|maj7|)$/.test(mine) === /^[A-G][b#]?(7|maj7|)$/.test(ref)) ok++;
        rows.push(`${ref}>${mine}`);
      }
      tot[label] = [ok, bars];
      res.push(`${genre} ${label} ${Math.round(100 * ok / bars)}%  ${rows.join(' ')}`);
    }
  }
  wf(D + '/grid-diag.txt', res.join(String.fromCharCode(10)));
});
