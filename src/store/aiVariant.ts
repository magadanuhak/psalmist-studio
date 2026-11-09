/** "Variantă AI" for one arrangement layer: the local generator proposes, our rule filters decide (key, chords, vocal clash guard, range, density, anomalies). */
import { Midi } from '@tonejs/midi';
import { ai, aiMessage } from './ai';
import { useApp } from './store';
import { arrangeInputFor, arrangementFor, arrangementSettings } from './arrangeInput';
import { entryOf } from './userInstruments';
import { getInstrument } from '../audio/instruments/catalog';
import { chordName } from '../theory/harmony/chords';
import { transposeInput } from '../theory/arrange';
import { filterAiNotes, type VariantReport } from '../theory/arrange/aiVariant';
import type { ArrNote } from '../theory/arrange/types';
import { barSec } from '../music/timesig';
import { t } from '../i18n/ro';

const STYLE: Record<string, string> = { worship: 'worship', imn: 'hymn', cantare: 'hymn', pop: 'pop', rock: 'rock', popular: 'folk' };

export async function requestAiVariant(trackId: string): Promise<VariantReport | null> {
  const st = useApp.getState();
  const p = st.project;
  const arr = arrangementFor(p);
  const raw = p ? arrangeInputFor(p) : null;
  const track = arr?.tracks.find((x) => x.id === trackId);
  if (!p || !arr || !raw || !track || track.drums || !p.key) return null;
  const set = arrangementSettings(p);
  const inp = transposeInput(raw, set.transpose ?? 0);
  const key = inp.key;
  const qBpm = p.timeSig.den === 8 ? p.bpm / 2 : p.bpm; // x/8 meters count eighths
  const beatsPerBar = p.timeSig.den === 8 ? p.timeSig.num / 2 : p.timeSig.num;
  const bar = barSec(p.bpm, p.timeSig);
  const beatSec = bar / beatsPerBar;
  const vocal = arr.plan.flatMap((s, i) => inp.sections[i].notes.map((n) => ({ midi: n.midi, startSec: s.startSec + n.startSec, durSec: n.durSec })));
  // melody as a MIDI file on the song timeline (constant tempo)
  const mid = new Midi();
  mid.header.setTempo(qBpm);
  mid.header.timeSignatures.push({ ticks: 0, timeSignature: [p.timeSig.num, p.timeSig.den] });
  const mt = mid.addTrack();
  vocal.sort((a, b) => a.startSec - b.startSec).forEach((n) => mt.addNote({ midi: n.midi, time: n.startSec, duration: n.durSec, velocity: 0.8 }));
  const totalBars = Math.max(1, Math.round(arr.plan.reduce((m, s) => m + s.bars, 0)));
  const chords: string[] = [];
  for (let b = 0; b < totalBars; b++) {
    const tt = b * bar + 1e-3;
    const s = arr.plan.find((x) => tt >= x.startSec && tt < x.startSec + x.durSec) ?? arr.plan[arr.plan.length - 1];
    let c = s.chords[0];
    for (const x of s.chords) if (s.startSec + x.startSec <= tt) c = x;
    chords.push(c ? chordName(c.chord, 'letter', key) : 'C');
  }
  const tonicName = chordName({ root: key.tonic, quality: 'maj' }, 'letter', key);
  try {
    const res = await ai.accompany({
      melodyMidi: new Uint8Array(mid.toArray()), key: tonicName, mode: key.mode, meter: `${p.timeSig.num}/${p.timeSig.den}`, bpm: p.timeSig.den === 8 ? qBpm : p.bpm,
      bars: totalBars, chords, style: STYLE[p.genre] ?? 'worship', instruments: [track.gm], nCandidates: 1, seed: (set.seed ?? 1) + 7,
    });
    const cand = res.candidates[0];
    if (!cand) throw new Error('no candidates');
    const gen = new Midi(cand.midi);
    const pick = gen.tracks.find((x) => x.instrument.number === track.gm && x.notes.length) ?? gen.tracks.filter((x) => x.notes.length && !x.instrument.percussion).sort((a, b) => b.notes.length - a.notes.length)[0];
    if (!pick) throw new Error('no notes');
    const notes: ArrNote[] = pick.notes.map((n) => ({ midi: n.midi, startSec: n.time, durSec: n.duration, vel: n.velocity }));
    const e = track.inst ? entryOf(track.inst) ?? getInstrument(track.inst) : undefined;
    const out = filterAiNotes(notes, track, { key, plan: arr.plan, vocal, range: e?.range ?? [36, 96], beatSec, beatsPerBar, maxPerBar: Math.round(beatsPerBar * 4) });
    if (!out.notes.length) { st.notify('error', t.ai.variantEmpty); return out.report; }
    st.setAiVariant(trackId, { notes: out.notes, kept: out.report.kept, input: out.report.input });
    return out.report;
  } catch (err) { st.notify('error', aiMessage(err)); return null; }
}

export function clearAiVariant(trackId: string): void {
  const st = useApp.getState();
  st.setAiVariant(trackId, null);
}
