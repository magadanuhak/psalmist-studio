import type { Note, Project, Section } from '../model/types';
import {
  buildBeatMap, buildSectionHarmony, linearBeatMap, notesSignature, renderHarmony,
  type HarmonizeInput, type HarmonyRender, type SectionHarmony, type VariantId,
} from '../theory/harmony';

export function takeNotes(section: Section): Note[] {
  const take = section.takes.find((x) => x.id === section.activeTakeId);
  if (!take) return [];
  return take.notesCorrected.length ? take.notesCorrected : take.notesOriginal;
}

/** Corrected (key-snapped) pitches, timed like the voice actually sang them (beat map follows real onsets). */
export function harmonyNotes(section: Section): Note[] {
  const take = section.takes.find((x) => x.id === section.activeTakeId);
  const corrected = takeNotes(section);
  if (!take) return corrected;
  const orig = new Map(take.notesOriginal.map((n) => [n.id, n]));
  return corrected.map((n) => {
    const o = orig.get(n.id);
    return o ? { ...n, startSec: o.startSec, durSec: o.durSec } : n;
  });
}

export type InputError = 'noKey' | 'noNotes';

export function harmonyInputFor(p: Project, section: Section): HarmonizeInput | InputError {
  const notes = harmonyNotes(section);
  if (!notes.length) return 'noNotes';
  if (!p.key) return 'noKey';
  const i = p.sections.findIndex((s) => s.id === section.id);
  return {
    notes, key: p.key, bpm: p.bpm, sig: p.timeSig, bars: section.bars, genre: p.genre, emotion: p.emotion,
    sectionType: section.type, nextType: p.sections[i + 1]?.type ?? null, isLastSection: i === p.sections.length - 1,
    rate: section.harmony?.rate,
    simplicity: p.simplicity ?? 'simplu',
    beatMap: p.gridExact ? linearBeatMap(p.bpm) : buildBeatMap(notes.map((n) => n.startSec), p.bpm, section.bars * p.timeSig.num),
  };
}

export const buildHarmony = (inp: HarmonizeInput, prev?: SectionHarmony | null) => buildSectionHarmony(inp, prev);

export function isStale(section: Section): boolean {
  return !!section.harmony && section.harmony.notesSig !== notesSignature(takeNotes(section));
}

interface CacheEntry { notes: Note[]; key: Project['key']; genre: string; bpm: number; render: HarmonyRender }
const cache = new WeakMap<SectionHarmony, Map<string, CacheEntry>>();

/** Voicing / bass / comping for a section's chords (memoised on the harmony object and melody). */
export function renderFor(p: Project, section: Section, variant?: VariantId, style: 'simple' | 'full' = 'simple'): HarmonyRender | null {
  const h = section.harmony;
  if (!h || !p.key) return null;
  const v = variant ?? h.active;
  const notes = harmonyNotes(section);
  let m = cache.get(h);
  if (!m) { m = new Map(); cache.set(h, m); }
  const ck = `${v}|${style}`;
  const hit = m.get(ck);
  if (hit && hit.notes === notes && hit.key === p.key && hit.genre === p.genre && hit.bpm === p.bpm) return hit.render;
  const render = renderHarmony({ harmony: h, variant: v, notes, key: p.key, genre: p.genre, sig: p.timeSig, style });
  m.set(ck, { notes, key: p.key, genre: p.genre, bpm: p.bpm, render });
  return render;
}
