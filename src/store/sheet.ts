import type { Project } from '../model/types';
import { effectiveSection } from '../model/sections';
import { beatSec } from '../music/timesig';
import { buildMusicXml, type MusicXmlInput } from '../music/musicxml';
import { arrangeInputFor, arrangementSettings, songLayout } from './arrangeInput';
import { takeNotes } from './harmonyInput';

/** MusicXML input for the whole song (melody + chord symbols + section marks), or null while there is no key or no notes. */
export function sheetInput(p: Project | null): MusicXmlInput | null {
  if (!p || !p.key) return null;
  const lay = songLayout(p);
  const inp = arrangeInputFor(p);
  const beat = beatSec(p.bpm);
  const notes: MusicXmlInput['notes'] = [];
  const chords: MusicXmlInput['chords'] = [];
  p.sections.forEach((s, i) => {
    const L = lay.sections[i];
    for (const n of takeNotes(effectiveSection(p, s))) if (n.startSec < L.durSec) notes.push({ midi: n.midi, startSec: L.startSec + n.startSec, durSec: n.durSec });
    for (const c of inp?.sections[i]?.chords ?? []) if (c.chord) chords.push({ startSec: L.startSec + c.startBeat * beat, chord: c.chord });
  });
  if (!notes.length) return null;
  return {
    title: p.name, key: p.key, sig: p.timeSig, bpm: p.bpm, notes, chords,
    sections: lay.sections.map((s) => ({ label: s.label, startSec: s.startSec, bars: s.bars })),
    transpose: arrangementSettings(p).transpose ?? 0,
  };
}

export function sheetXml(p: Project | null): string | null {
  const i = sheetInput(p);
  return i ? buildMusicXml(i) : null;
}
