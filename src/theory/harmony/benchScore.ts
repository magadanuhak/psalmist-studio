// Scoring helper of the ground-truth harmony benchmark (fast): the exact melody of four public-domain songs (scripts/benchmarks/songs.json) goes through the
// real harmonizer with the exact bar grid, and the chords it picks are scored against the known chords, bar by bar.
import { correctNotes } from '../../dsp/correct';
import { DEFAULT_CORRECTION, type Genre, type Project, type Section } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { buildHarmony, harmonyInputFor } from '../../store/harmonyInput';
import { chordName } from './index';
import { makeCtx, unary, emission, pickPool } from './harmonize';
import { SONGS, acceptableAt, chordOk, eighthSec, truthOf } from '../../../scripts/benchmarks/singer.mjs';

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** chord agreement (root + major/minor) per bar for a song cut into sections of `secBars` bars (0 = one section) */
export function scoreSong(id: string, genre: Genre, secBars = 0, bars?: number): { agree: number; primary: number; n: number; rows: string[] } {
  const song = SONGS[id], truth = truthOf(song, { bars, lead: 0 });
  const nBars = truth.chords.length, step = secBars || nBars;
  const sig = TIME_SIGS.find((t) => t.id === song.sig)!.sig;
  const bpm = song.compound ? song.bpm * 3 : song.bpm;
  const key = { tonic: PC[song.key], mode: song.mode } as const;
  const barSec = truth.barSec, e8 = eighthSec(song);
  const rows: string[] = []; let ok = 0, prim = 0, n = 0;
  for (let b0 = 0, si = 0; b0 < nBars; b0 += step, si++) {
    const bn = Math.min(step, nBars - b0);
    const t0 = truth.bars[b0];
    const ns = truth.notes.filter((x) => truth.lead + x.u * e8 >= t0 - 1e-6 && truth.lead + x.u * e8 < t0 + bn * barSec - 1e-6)
      .map((x, i, all) => ({ id: 'n' + i, midi: x.midi, startSec: truth.lead + x.u * e8 - t0, durSec: all[i + 1]?.midi === x.midi && all[i + 1].u === x.u + x.d ? x.d * e8 - 0.08 : x.d * e8 * 0.94, velocity: 0.8, centsDev: 0, confidence: 1 }));
    const cor = correctNotes(ns as never, key, bpm, sig, DEFAULT_CORRECTION);
    const type = si % 2 === 0 ? 'strofa' : 'refren';
    const sec = { id: 's', type, label: type, order: 0, bars: bn, generated: false, activeTakeId: 't', takes: [{ id: 't', rawAudioId: 'r', latencyMs: 0, durationSec: bn * barSec, createdAt: 0, source: 'import', notesOriginal: ns, notesCorrected: cor, correction: DEFAULT_CORRECTION }] } as unknown as Section;
    const p = { id: 'p', name: 'r', version: 1, genre, emotion: 'inchinare', timeSig: sig, bpm, key, keyLocked: true, gridExact: true, simplicity: 'simplu', sections: [sec], voices: [], createdAt: 0, updatedAt: 0 } as unknown as Project;
    if (process.env.BENCH_DBG) console.log('IN', ns.slice(0, 4).map((x) => x.midi + '@' + x.startSec.toFixed(2) + '+' + x.durSec.toFixed(2)).join(' '), 'COR', b0, cor.slice(0, 10).map((x) => x.midi + '@' + x.startSec.toFixed(2)).join(' '));
    const inp = harmonyInputFor(p, sec);
    if (typeof inp === 'string') throw new Error(inp);
    const h = buildHarmony(inp);
    if (process.env.BENCH_DBG && b0 === 0) { const ctx = makeCtx({ ...inp, rate: 1 }); for (const i of [0, 1, 2]) { const pl = pickPool(ctx, 'A', i, undefined); if (i === 0) console.log('SMP', JSON.stringify(ctx.samples[0].map((x) => [x.pc, +x.w.toFixed(2), x.held ? 'h' : '', x.strong ? 's' : '', x.beat1 ? 'b' : '', x.pass ? 'p' : ''].join(''))));
      console.log('POOL', i, ctx.slots[i].bar, ctx.slots[i].beats, JSON.stringify(ctx.roles[i]), pl.map((c) => chordName(c.chord, 'letter', key) + ':' + unary(ctx, 'A', c, i).toFixed(1) + '/' + emission(ctx, c, i).toFixed(1)).join(' ')); } }
    const list = h.variants[h.active ?? 'A'];
    for (let b = 0; b < bn; b++) {
      const sl = h.slots.findIndex((s) => s.bar === b);
      const mine = chordName(list[sl], 'letter', key), ref = truth.chords[b0 + b];
      n++; if (chordOk(ref, mine)) prim++;
      const acc = acceptableAt(song, b0 + b).some((c: string) => chordOk(c, mine));
      if (acc) ok++;
      rows.push(`${b0 + b + 1}:${acc ? mine : ref + '>' + mine}`);
    }
  }
  return { agree: ok / n, primary: prim / n, n, rows };
}

