/** Adapter M4 -> M5: feeds the arrangement timeline to the melodic-layers engine and appends its 3 tracks. */
import { chordPcs } from '../harmony/chords';
import { generateMelodicLayers } from '../melody';
import type { MelodyInput, PauseIn } from '../melody';
import { buildEchoes, quoteHook } from './echo';
import type { ArrangeInput, Arrangement, ArrNote, ArrTrack, MelodicLayer } from './types';

export const LAYER_META: Record<MelodicLayer, { id: string; name: string; level: number; pan: number }> = {
  lead: { id: 'hook', name: 'Temă (hook)', level: 0.5, pan: 0.25 },
  answers: { id: 'answers', name: 'Răspunsuri', level: 0.5, pan: -0.25 },
  counter: { id: 'counter', name: 'Contra-melodie', level: 0.4, pan: 0.35 },
};
const HARMONIC_MINOR_GENRES = ['imn', 'cantare', 'popular'];

/** Outro ritardando time warp of the arrangement. */
export function warpTime(r: NonNullable<Arrangement['ritard']>, t: number): number {
  if (t <= r.fromSec) return t;
  const u = (t - r.fromSec) / r.beat;
  return r.fromSec + (u + (r.k * u * u) / (2 * r.n)) * r.beat;
}

export function buildMelodyInput(inp: ArrangeInput, arr: Arrangement, seed: number): MelodyInput {
  const qbpm = (inp.bpm * inp.sig.den) / 4;
  const vocal = arr.plan.flatMap((s, i) => inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })))
    .sort((a, b) => a.startSec - b.startSec);
  const pauses: PauseIn[] = [];
  for (let i = 0; i + 1 < vocal.length; i++) {
    const end = vocal[i].startSec + vocal[i].durSec;
    const gap = vocal[i + 1].startSec - end;
    if (gap >= 60 / qbpm) pauses.push({ startSec: end, durSec: gap });
  }
  return {
    sections: arr.plan.map((s) => ({
      type: s.type, startSec: s.startSec, bars: s.bars, energy: s.energy,
      chords: s.chords.map((c) => ({ startSec: s.startSec + c.startSec, durSec: c.durSec, pcs: chordPcs(c.chord), root: c.chord.root, function: c.chord.func })),
    })),
    vocalNotes: vocal, vocalPauses: pauses,
    key: { tonic: inp.key.tonic, mode: inp.key.mode === 'major' ? 'major' : HARMONIC_MINOR_GENRES.includes(inp.genre) ? 'harmonicMinor' : 'minor' },
    meter: { num: inp.sig.num, den: inp.sig.den, grouping: inp.sig.grouping },
    bpm: qbpm, genre: inp.genre, emotion: inp.emotion,
    vocalRange: { low: arr.register.vocalLo, high: arr.register.vocalHi },
    seed,
  };
}

/** Returns a copy of the arrangement with the hook / answers / counter-melody tracks (unless switched off). */
export function addMelodicLayers(inp: ArrangeInput, arr: Arrangement, seed: number, off: MelodicLayer[] = []): Arrangement {
  if (!arr.plan.length) return arr;
  const res = generateMelodicLayers(buildMelodyInput(inp, arr, seed));
  const used = new Set(arr.tracks.map((t) => t.channel));
  let ch = 0;
  const nextCh = () => { while (used.has(ch) || ch === 9) ch++; used.add(ch); return ch; };
  const per: Record<string, { lead: number; answers: number; counter: number }> = {};
  arr.plan.forEach((s) => { per[s.id] = { lead: 0, answers: 0, counter: 0 }; });
  const tracks: ArrTrack[] = [];
  const beatSec = 60 / inp.bpm, barSec = beatSec * inp.sig.num;
  const vocalAll = arr.plan.flatMap((s, i) => inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })));
  for (const t0 of res.tracks) {
    const meta = LAYER_META[t0.role];
    // musical-relevance rule: answers are echoes of the phrase just sung (one per phrase pair, only in pauses >= 1 bar); the intro hook quotes the refren
    let t = t0;
    if (t0.role === 'answers') t = { ...t0, notes: buildEchoes(vocalAll, { key: inp.key, barSec, beatSec, vocalHi: arr.register.vocalHi, level: 0.63 }).notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec, vel: n.vel })) as typeof t0.notes };
    else if (t0.role === 'lead') {
      const ii = arr.plan.findIndex((p) => p.type === 'intro'), ri = arr.plan.findIndex((p) => p.type === 'refren');
      if (ii >= 0 && ri >= 0 && inp.sections[ri].notes.length >= 3) {
        const intro = arr.plan[ii];
        const lo = Math.min(...inp.sections[ri].notes.map((n) => n.midi));
        const q = quoteHook(inp.sections[ri].notes, intro, barSec, 12 * Math.max(0, Math.ceil((arr.register.vocalHi - 2 - lo) / 12)), 1);
        t = { ...t0, notes: [...t0.notes.filter((n) => n.startSec < intro.startSec || n.startSec >= intro.startSec + intro.durSec), ...q.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec, vel: n.vel }))].sort((a, b) => a.startSec - b.startSec) as typeof t0.notes };
      }
    }
    const notes: ArrNote[] = t.notes.map((n) => {
      if (!arr.ritard) return { midi: n.midi, startSec: n.startSec, durSec: n.durSec, vel: n.vel };
      const st = warpTime(arr.ritard, n.startSec);
      return { midi: n.midi, startSec: st, durSec: Math.max(0.05, warpTime(arr.ritard, n.startSec + n.durSec) - st), vel: n.vel };
    }).filter((n) => n.startSec < arr.songSec - 1e-6).map((n) => ({ ...n, durSec: Math.min(n.durSec, arr.songSec - n.startSec) }));
    for (const n of t.notes) {
      const s = arr.plan.find((p) => n.startSec >= p.startSec - 1e-6 && n.startSec < p.startSec + p.bars * (60 / inp.bpm) * inp.sig.num - 1e-6);
      if (s) per[s.id][t.role]++;
    }
    if (off.includes(t.role) || !notes.length) continue;
    tracks.push({ id: meta.id, name: meta.name, gm: t.gmProgram, channel: nextCh(), drums: false, level: meta.level, pan: meta.pan, reverb: 48, notes });
  }
  const h = res.diagnostics.hook;
  return {
    ...arr, tracks: [...arr.tracks, ...tracks],
    melodic: { hook: h.pitches.join(' '), perSection: per, voiceClass: res.diagnostics.voiceClass },
  };
}
