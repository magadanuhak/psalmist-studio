/** Song MIDI of the full arrangement (A5): GM program per track, drums on channel 10, chord + section markers. */
import { Midi } from '@tonejs/midi';
import type { Arrangement, ArrNote } from './types';

export interface MidiOptions {
  name: string;
  bpm: number;
  sig: { num: number; den: number };
  /** sung melody played by the "Melodie" track (song time) */
  melody?: ArrNote[];
  /** tracks to leave out (e.g. muted by the user) */
  skip?: string[];
}

/** MIDI text events are single-byte: fold Romanian diacritics (Ţambal -> Tambal). */
export const midiText = (s: string) => s.normalize('NFD').replace(/[̀-̧̦ͯ]/g, '').replace(/[^ -~]/g, '?');

export function arrangementMidi(a: Arrangement, o: MidiOptions): Uint8Array<ArrayBuffer> {
  const m = new Midi();
  m.header.setTempo(o.bpm);
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [o.sig.num, o.sig.den] });
  m.header.name = midiText(o.name);
  const add = (name: string, channel: number, program: number, notes: ArrNote[], pan = 0, reverb = 0, level = 0.8) => {
    const tr = m.addTrack();
    tr.name = midiText(name);
    tr.channel = channel;
    tr.instrument.number = program;
    tr.addCC({ number: 7, value: Math.max(0, Math.min(1, level)), time: 0 });
    tr.addCC({ number: 10, value: (pan + 1) / 2, time: 0 });
    if (reverb) tr.addCC({ number: 91, value: reverb / 127, time: 0 });
    for (const n of notes) tr.addNote({ midi: n.midi, time: n.startSec, duration: Math.max(0.03, n.durSec), velocity: Math.min(1, Math.max(0.05, n.vel)) });
  };
  // one channel per GM program (drums always on 9): a channel never carries two programs, so program changes cannot collide in a DAW
  const chOf = new Map<number, number>();
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const channelFor = (program: number) => {
    let c = chOf.get(program);
    if (c === undefined) { c = free.length ? free.shift()! : [...chOf.values()][chOf.size % 15]; chOf.set(program, c); }
    return c;
  };
  const tracks = a.tracks.filter((t) => !o.skip?.includes(t.id));
  if (o.melody?.length) add('Melodie', channelFor(0), 0, o.melody, 0, 0, 0.9);
  for (const t of tracks) add(t.name, t.drums ? 9 : channelFor(t.gm), t.drums ? 0 : t.gm, t.notes, t.pan, t.reverb, t.level);
  for (const k of a.markers) m.header.meta.push({ ticks: Math.round(m.header.secondsToTicks(k.time)), text: midiText(k.text), type: 'marker' });
  return new Uint8Array(m.toArray());
}
