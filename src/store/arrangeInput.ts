import type { Project, Section } from '../model/types';
import { effectiveSection } from '../model/sections';
import { barSec } from '../music/timesig';
import { addMelodicLayers, arrangementMidi, generateArrangement, transposeInput, type ArrangeInput, type Arrangement, type ArrSectionInput, type ArrangementSettings } from '../theory/arrange';
import { takeNotes } from './harmonyInput';
import { warpArrangement } from '../theory/arrange/tempoMap';
import { guardClashes, realizeArrangement } from '../theory/arrange/realize';
import { defaultLayersOff, defaultPalette } from '../theory/arrange/presets';
import { entryOf } from './userInstruments';

export const DEFAULT_ARRANGEMENT: ArrangementSettings = { v: 1, energy: {}, drop: false };
export const arrangementSettings = (p: Project): ArrangementSettings => p.arrangement ?? DEFAULT_ARRANGEMENT;

function sectionInput(p: Project, s: Section): ArrSectionInput {
  const src = s.sourceSectionId ? p.sections.find((x) => x.id === s.sourceSectionId) : undefined;
  const eff = effectiveSection(p, s);
  const harmony = s.harmony ?? (!s.takes.length ? src?.harmony : undefined);
  const notes = takeNotes(eff).map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec }));
  let chords: ArrSectionInput['chords'] = null;
  if (harmony) {
    const list = harmony.variants[harmony.active];
    chords = harmony.slots.map((sl, i) => ({ startBeat: sl.startBeat, beats: sl.beats, chord: list[i], phraseEnd: sl.phraseEnd })).filter((c) => !!c.chord);
    if (!chords.length) chords = null;
  }
  return { id: s.id, type: s.type, label: s.label, bars: s.bars, notes, chords, isCopy: !!src && !s.harmony };
}

export function arrangeInputFor(p: Project): ArrangeInput | null {
  if (!p.key) return null;
  const set = arrangementSettings(p);
  return {
    genre: p.genre, emotion: p.emotion, key: p.key, bpm: p.bpm, sig: p.timeSig,
    sections: p.sections.map((s) => sectionInput(p, s)),
    energy: set.energy, drop: set.drop, palette: set.palette ?? defaultPalette(p.genre),
  };
}

const cache = new WeakMap<Project, Arrangement | null>();

/** The whole-song arrangement (memoised per project snapshot). Null until the song has a key and chords. */
export function arrangementFor(p: Project | null): Arrangement | null {
  if (!p) return null;
  if (cache.has(p)) return cache.get(p) ?? null;
  const out = buildArrangement(p, true);
  cache.set(p, out);
  return out;
}

/** The same arrangement without the sung-note clash guard (for audits: before / after). */
export const arrangementUnguarded = (p: Project): Arrangement | null => buildArrangement(p, false);

function buildArrangement(p: Project, guard: boolean): Arrangement | null {
  const raw = arrangeInputFor(p);
  const inp = raw ? transposeInput(raw, arrangementSettings(p).transpose ?? 0) : null;
  let out: Arrangement | null = null;
  if (inp && inp.sections.some((s) => s.chords)) {
    try {
      out = generateArrangement(inp);
      const set = arrangementSettings(p);
      try { out = addMelodicLayers(inp, out, set.seed ?? 1, set.layersOff ?? defaultLayersOff(set.palette ?? defaultPalette(p.genre))); } catch { /* arrangement stays without melodic layers */ }
      try { out = realizeArrangement(out, { seed: set.seed ?? 1, bpm: p.bpm, sig: p.timeSig, genre: p.genre, emotion: p.emotion, palette: set.palette ?? defaultPalette(p.genre), overrides: set.instruments, entryOf, clashGuard: guard && !(arrangementSettings(p).tempoMap?.length), vocal: [
        ...out.plan.flatMap((s, i) => inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec }))),
        // the singer's real (uncorrected) pitches count too: that is what the listener hears against the accompaniment
        ...out.plan.flatMap((s, i) => { const eff = effectiveSection(p, p.sections[i]); const tk = eff.takes.find((x) => x.id === eff.activeTakeId); return (tk?.notesOriginal ?? []).map((n) => ({ midi: n.midi + (arrangementSettings(p).transpose ?? 0), startSec: s.startSec + n.startSec, durSec: n.durSec })); }),
      ] }); } catch { /* arrangement stays as generated */ }
    } catch { out = null; }
  }
  const av = arrangementSettings(p).aiVariants;
  if (out && av) out = { ...out, tracks: out.tracks.map((x) => (av[x.id] ? { ...x, notes: av[x.id].notes } : x)) };
  const tm = arrangementSettings(p).tempoMap;
  if (out && tm && tm.length > 2) {
    out = warpArrangement(out, tm, barSec(p.bpm, p.timeSig));
    // with a tempo map the guard runs AFTER the warp, against the vocal in the same (mapped) time: a section's take plays at its mapped start in real time
    if (guard && inp) {
      const plan = out.plan;
      const vocal = plan.flatMap((s, i) => { const eff = effectiveSection(p, p.sections[i]); const tk = eff.takes.find((x) => x.id === eff.activeTakeId); return [...inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })), ...(tk?.notesOriginal ?? []).map((n) => ({ midi: n.midi + (arrangementSettings(p).transpose ?? 0), startSec: s.startSec + n.startSec, durSec: n.durSec }))]; });
      out = guardClashes(out, vocal);
    }
  }
  return out;
}

export interface LayoutSection { id: string; label: string; type: Section['type']; bars: number; startSec: number; durSec: number }

/** Section positions on the song timeline (matches the arrangement; the last section may be longer for the ritardando). */
export function songLayout(p: Project | null): { sections: LayoutSection[]; total: number } {
  if (!p) return { sections: [], total: 0 };
  const arr = arrangementFor(p);
  const bar = barSec(p.bpm, p.timeSig);
  let t = 0;
  const sections = p.sections.map((s, i) => {
    const plan = arr?.plan[i];
    const startSec = plan?.startSec ?? t;
    const durSec = plan?.durSec ?? s.bars * bar;
    t = startSec + durSec;
    return { id: s.id, label: s.label, type: s.type, bars: s.bars, startSec, durSec };
  });
  return { sections, total: arr ? Math.max(arr.songSec, t) : t };
}

/** Whole-song MIDI with every arrangement track (GM programs, drums on channel 10), or null when there is no arrangement yet. */
export function fullSongMidi(p: Project): Uint8Array<ArrayBuffer> | null {
  const arr = arrangementFor(p);
  if (!arr) return null;
  const lay = songLayout(p);
  const melody = p.sections.flatMap((s, i) =>
    takeNotes(effectiveSection(p, s)).map((n) => ({ midi: n.midi + (arrangementSettings(p).transpose ?? 0), startSec: lay.sections[i].startSec + n.startSec, durSec: n.durSec, vel: n.velocity })));
  return arrangementMidi(arr, { name: p.name, bpm: p.bpm, sig: p.timeSig, melody });
}
