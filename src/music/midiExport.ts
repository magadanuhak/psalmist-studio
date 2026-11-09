import { Midi } from '@tonejs/midi';
import type { Note, Project } from '../model/types';
import { barSec } from './timesig';
import { effectiveSection } from '../model/sections';
import { renderFor, takeNotes } from '../store/harmonyInput';
import { chordName, type ChordNaming } from '../theory/harmony';

function newMidi(p: Project): Midi {
  const m = new Midi();
  m.header.setTempo(p.bpm);
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [p.timeSig.num, p.timeSig.den] });
  m.header.name = p.name;
  return m;
}

export function activeNotes(p: Project, sectionIndex: number): Note[] {
  return takeNotes(effectiveSection(p, p.sections[sectionIndex]));
}

interface Ev { midi: number; time: number; dur: number; vel: number }

function addTrack(m: Midi, name: string, events: Ev[], channel: number, program = 0) {
  const tr = m.addTrack();
  tr.name = name;
  tr.channel = channel;
  tr.instrument.number = program;
  for (const n of events) tr.addNote({ midi: n.midi, time: n.time, duration: Math.max(0.03, n.dur), velocity: Math.min(1, n.vel) });
}

interface Layers { melody: Ev[]; chords: Ev[]; bass: Ev[]; markers: { time: number; text: string }[] }

function sectionLayers(p: Project, index: number, offset: number, naming: ChordNaming): Layers {
  const sec = effectiveSection(p, p.sections[index]);
  const melody = takeNotes(sec).map((n) => ({ midi: n.midi, time: offset + n.startSec, dur: n.durSec, vel: n.velocity }));
  const out: Layers = { melody, chords: [], bass: [], markers: [] };
  const r = renderFor(p, sec);
  if (r) {
    out.chords = r.chordEvents.map((e) => ({ midi: e.midi, time: offset + e.startSec, dur: e.durSec, vel: e.vel }));
    out.bass = r.bassEvents.map((e) => ({ midi: e.midi, time: offset + e.startSec, dur: e.durSec, vel: e.vel }));
    out.markers = r.slots.map(({ slot, chord, voiced }) => ({ time: offset + slot.startSec, text: chordName(chord, naming, p.key, voiced.bassPc) }));
  }
  return out;
}

function write(m: Midi, l: Layers) {
  addTrack(m, 'Melodie', l.melody, 0);
  addTrack(m, 'Acorduri', l.chords, 1);
  addTrack(m, 'Bas', l.bass, 2, 32);
  for (const k of l.markers) m.header.meta.push({ ticks: Math.round(m.header.secondsToTicks(k.time)), text: k.text, type: 'marker' });
}

export function sectionMidi(p: Project, sectionIndex: number, naming: ChordNaming = 'letter'): Uint8Array<ArrayBuffer> {
  const m = newMidi(p);
  write(m, sectionLayers(p, sectionIndex, 0, naming));
  return new Uint8Array(m.toArray());
}

export function songMidi(p: Project, naming: ChordNaming = 'letter'): Uint8Array<ArrayBuffer> {
  const m = newMidi(p);
  const all: Layers = { melody: [], chords: [], bass: [], markers: [] };
  let offset = 0;
  const bar = barSec(p.bpm, p.timeSig);
  p.sections.forEach((s, i) => {
    const l = sectionLayers(p, i, offset, naming);
    all.melody.push(...l.melody); all.chords.push(...l.chords); all.bass.push(...l.bass); all.markers.push(...l.markers);
    offset += s.bars * bar;
  });
  write(m, all);
  return new Uint8Array(m.toArray());
}
