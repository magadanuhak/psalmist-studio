/** MusicXML 3.1 (score-partwise) of the song: melody + chord symbols, key, meter, tempo and section rehearsal marks.
 *  Opens in MuseScore / OpenSheetMusicDisplay. Pure TypeScript. */
import type { KeySig, TimeSig } from '../model/types';
import { prefersFlats } from '../theory/harmony/chords';
import type { Chord, ChordQuality } from '../theory/harmony/types';

export interface XmlNote { midi: number; startSec: number; durSec: number }
export interface XmlChord { startSec: number; chord: Pick<Chord, 'root' | 'quality'> }
export interface XmlSection { label: string; startSec: number; bars: number }
export interface MusicXmlInput {
  title: string;
  key: KeySig;
  sig: TimeSig;
  /** pulses (den units) per minute */
  bpm: number;
  notes: XmlNote[];
  chords: XmlChord[];
  sections: XmlSection[];
  /** semitones the whole score is transposed by */
  transpose?: number;
  /** a new system every n bars (default 4) */
  systemBars?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pcOf = (m: number) => ((m % 12) + 12) % 12;
const SHARP = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]] as const;
const FLAT = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]] as const;

function fifthsOf(key: KeySig): number {
  const majorTonic = key.mode === 'major' ? key.tonic : pcOf(key.tonic + 3);
  const order = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B F# C# G# D# A# F: sharps count 0..11
  const idx = order.indexOf(majorTonic);
  return idx <= 6 ? idx : idx - 12;
}

const KIND: Record<ChordQuality, { kind: string; text: string; deg?: [number, number, string] }> = {
  maj: { kind: 'major', text: '' },
  min: { kind: 'minor', text: 'm' },
  dim: { kind: 'diminished', text: 'dim' },
  dom7: { kind: 'dominant', text: '7' },
  maj7: { kind: 'major-seventh', text: 'maj7' },
  min7: { kind: 'minor-seventh', text: 'm7' },
  hdim7: { kind: 'half-diminished', text: 'm7b5' },
  dim7: { kind: 'diminished-seventh', text: 'dim7' },
  sus2: { kind: 'suspended-second', text: 'sus2' },
  sus4: { kind: 'suspended-fourth', text: 'sus4' },
  add9: { kind: 'major', text: 'add9', deg: [9, 0, 'add'] },
};

const STD: [number, string, boolean][] = [[16, 'whole', false], [12, 'half', true], [8, 'half', false], [6, 'quarter', true], [4, 'quarter', false], [3, 'eighth', true], [2, 'eighth', false], [1, '16th', false]];

/** split a duration (divisions) into standard note values */
function pieces(d: number): [number, string, boolean][] {
  const out: [number, string, boolean][] = [];
  let left = d;
  while (left > 0) {
    const s = STD.find((x) => x[0] <= left)!;
    out.push(s); left -= s[0];
  }
  return out;
}

export function buildMusicXml(inp: MusicXmlInput): string {
  const t = inp.transpose ?? 0;
  const key: KeySig = { tonic: pcOf(inp.key.tonic + t), mode: inp.key.mode };
  const flats = prefersFlats(key);
  const sp = flats ? FLAT : SHARP;
  const beatSec = 60 / inp.bpm;
  const unitDiv = 16 / inp.sig.den;                  // divisions per den-unit beat (divisions = 4 per quarter)
  const divSec = beatSec / unitDiv;
  const measDiv = inp.sig.num * unitDiv;
  const totalBars = inp.sections.reduce((s, x) => s + x.bars, 0);
  const sysBars = inp.systemBars ?? 4;
  const q = (sec: number) => Math.round(sec / divSec);

  // quantised, monophonic melody
  const mel = [...inp.notes].sort((a, b) => a.startSec - b.startSec).map((n) => ({ midi: n.midi + t, a: q(n.startSec), b: Math.max(q(n.startSec) + 1, q(n.startSec + n.durSec)) }));
  for (let i = 0; i + 1 < mel.length; i++) if (mel[i].b > mel[i + 1].a) mel[i].b = Math.max(mel[i].a + 1, mel[i + 1].a);
  const chords = inp.chords.map((c) => ({ at: q(c.startSec), root: pcOf(c.chord.root + t), quality: c.chord.quality })).sort((a, b) => a.at - b.at);
  const marks = new Map<number, string>();
  let bar = 0;
  for (const s of inp.sections) { marks.set(bar, s.label); bar += s.bars; }

  const xml: string[] = [];
  xml.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  xml.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  xml.push('<score-partwise version="3.1">');
  xml.push(`<work><work-title>${esc(inp.title)}</work-title></work>`);
  xml.push('<identification><encoding><software>Psalmist Studio</software></encoding></identification>');
  xml.push('<part-list><score-part id="P1"><part-name>Melodie</part-name></score-part></part-list>');
  xml.push('<part id="P1">');

  const noteXml = (midi: number | null, dur: number, tieStart: boolean, tieStop: boolean): string => {
    const parts = pieces(dur);
    let o = '';
    parts.forEach(([d, type, dot], i) => {
      const ts = i < parts.length - 1 || tieStart, te = i > 0 || tieStop;
      o += '<note>';
      if (midi === null) o += '<rest/>';
      else {
        const [step, alter] = sp[pcOf(midi)];
        const oct = Math.floor(midi / 12) - 1;
        o += `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch>`;
      }
      o += `<duration>${d}</duration>`;
      if (midi !== null) { if (te) o += '<tie type="stop"/>'; if (ts) o += '<tie type="start"/>'; }
      o += `<type>${type}</type>${dot ? '<dot/>' : ''}`;
      if (midi !== null && (te || ts)) o += `<notations>${te ? '<tied type="stop"/>' : ''}${ts ? '<tied type="start"/>' : ''}</notations>`;
      o += '</note>';
    });
    return o;
  };

  let mi = 0; // melody pointer
  let ci = 0; // chord pointer
  for (let m = 0; m < totalBars; m++) {
    const m0 = m * measDiv, m1 = m0 + measDiv;
    xml.push(`<measure number="${m + 1}">`);
    const mark = marks.get(m);
    if (m > 0 && (mark !== undefined || m % sysBars === 0)) xml.push('<print new-system="yes"/>');
    if (m === 0) {
      xml.push(`<attributes><divisions>4</divisions><key><fifths>${fifthsOf(key)}</fifths><mode>${key.mode}</mode></key><time><beats>${inp.sig.num}</beats><beat-type>${inp.sig.den}</beat-type></time><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>`);
      const qbpm = Math.round((inp.bpm * inp.sig.den) / 4);
      xml.push(`<direction placement="above"><direction-type><metronome><beat-unit>${inp.sig.den === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${Math.round(inp.bpm)}</per-minute></metronome></direction-type><sound tempo="${qbpm}"/></direction>`);
    }
    if (mark !== undefined) xml.push(`<direction placement="above"><direction-type><rehearsal>${esc(mark)}</rehearsal></direction-type></direction>`);
    let cursor = m0;
    while (cursor < m1) {
      while (ci < chords.length && chords[ci].at <= cursor) {
        const c = chords[ci++];
        if (c.at < m0) continue;
        const [step, alter] = sp[c.root];
        const k = KIND[c.quality];
        xml.push(`<harmony><root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ''}</root><kind text="${esc(k.text)}">${k.kind}</kind></harmony>`);
      }
      let nextChord = m1;
      for (let j = ci; j < chords.length; j++) if (chords[j].at > cursor) { nextChord = Math.min(m1, chords[j].at); break; }
      while (mi < mel.length && mel[mi].b <= cursor) mi++;
      const n = mi < mel.length ? mel[mi] : null;
      if (n && n.a <= cursor) {
        const end = Math.min(n.b, m1, nextChord);
        xml.push(noteXml(n.midi, end - cursor, end < n.b, cursor > n.a));
        cursor = end;
      } else {
        const end = Math.min(m1, n ? n.a : m1, nextChord);
        xml.push(noteXml(null, end - cursor, false, false));
        cursor = end;
      }
    }
    xml.push('</measure>');
  }
  xml.push('</part>', '</score-partwise>');
  return xml.join('\n');
}
