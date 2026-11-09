/** Audio-measured audits of the arrangement (Q1): the melodic tracks are rendered alone and pitch-tracked against their MIDI notes.
 *  Used by the benchmark scripts (song-from-vocal*.mjs) and available to the UI. */
import type { Project } from '../model/types';
import { arrangementFor, arrangementSettings } from './arrangeInput';
import { entryOf, getUserInstrument } from './userInstruments';
import { isExternal, renderExternalBus } from '../audio/external';
import { renderSong } from '../audio/offline';
import { engine } from '../audio/engine';
import { checkPitch } from '../audio/instruments/pitchcheck';

const MELODIC = ['hook', 'answers', 'counter'];
const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface MelodicPitchAudit { notes: number; correct: number; within10: number; ratio: number; byTrack: Record<string, { notes: number; correct: number }>; wrong: { track: string; midi: number; sec: number; octave: number | null; cents: number | null }[] }

/** Solo-renders every melodic track (hook, answers, counter) with its instrument and checks each long-enough note: right pitch (within 50 cents, right octave). */
export async function auditMelodicPitch(p: Project, only: string[] = MELODIC): Promise<MelodicPitchAudit> {
  const arr = arrangementFor(p);
  const out: MelodicPitchAudit = { notes: 0, correct: 0, within10: 0, ratio: 1, byTrack: {}, wrong: [] };
  if (!arr) return out;
  const total = arr.songSec + 1.5;
  const sf = await engine.soundFontBytes();
  const semis = arrangementSettings(p).transpose ?? 0;
  for (const t of arr.tracks) {
    if (!only.includes(t.id) || !t.notes.length) continue;
    const e = t.inst ? entryOf(t.inst) : undefined;
    let L: Float32Array, R: Float32Array;
    if (isExternal(e)) {
      const r = await renderExternalBus([{ id: t.id, entry: e, notes: t.notes.map((n) => ({ midi: n.midi, time: n.startSec, dur: n.durSec, vel: n.vel, art: n.art })), pan: 0, level: 1 }], { sampleRate: SR, totalSec: total, tuningCents: 0, space: 'studio', spaceTrim: 0, getUser: getUserInstrument });
      if (r.failed.length) continue;
      [L, R] = r.ch;
    } else {
      const r = await renderSong(sf, [{ id: t.id, name: t.name, channel: 0, program: t.gm, drums: false, pan: 0, notes: t.notes, bus: 'direct' }], { sampleRate: SR, songSec: arr.songSec, levels: { [t.id]: 1 } });
      [L, R] = r.mix;
    }
    const mono = new Float32Array(L.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (L[i] + R[i]) * 0.5;
    const sorted = [...t.notes].sort((a, b) => a.startSec - b.startSec);
    const stat = { notes: 0, correct: 0 };
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      const dur = Math.min(n.durSec, next ? next.startSec - n.startSec : n.durSec);
      if (dur < 0.18) return; // too short to carry a measurable pitch
      if (next && next.startSec < n.startSec + n.durSec - 0.02 && Math.abs(next.midi - n.midi) < 12) { /* overlapping legato note: window is cut at the next onset */ }
      const a = Math.round((n.startSec + Math.min(0.12, dur * 0.3)) * SR), b = Math.round((n.startSec + dur * 0.92) * SR);
      if (b - a < 2400) return;
      const r = checkPitch(mono.subarray(a, Math.min(b, mono.length)), SR, hz(n.midi));
      stat.notes++;
      if (r && r.octave === 0 && Math.abs(r.cents) <= 50) { stat.correct++; if (Math.abs(r.cents) <= 10) out.within10++; } else out.wrong.push({ track: t.id, midi: n.midi, sec: Math.round(n.startSec * 10) / 10, octave: r ? r.octave : null, cents: r ? Math.round(r.cents) : null });
    });
    out.byTrack[t.id] = stat;
    out.notes += stat.notes; out.correct += stat.correct;
  }
  void semis;
  out.ratio = out.notes ? out.correct / out.notes : 1;
  return out;
}

/** Chords of the whole song as written in the chart: start, duration and root / quality (for comparison with a chord detector on the rendered minus). */
export function chordChart(p: Project): { t: number; dur: number; root: number; minor: boolean; name: string; hasThird: boolean }[] {
  const arr = arrangementFor(p);
  if (!arr) return [];
  const semis = arrangementSettings(p).transpose ?? 0;
  const out: { t: number; dur: number; root: number; minor: boolean; name: string; hasThird: boolean }[] = [];
  for (const s of arr.plan) for (const c of s.chords) {
    const q = c.chord.quality;
    const minor = q === 'min' || q === 'min7' || q === 'dim' || q === 'dim7' || q === 'hdim7';
    const t0 = s.startSec + c.startSec, t1 = t0 + c.durSec, pc = (c.chord.root + (minor ? 3 : 4)) % 12;
    const hasThird = arr.tracks.some((t) => !t.drums && t.notes.some((n) => n.startSec < t1 && n.startSec + n.durSec > t0 && ((n.midi % 12) + 12) % 12 === pc));
    out.push({ t: t0, dur: c.durSec, root: (c.chord.root + semis + 120) % 12, minor, name: `${c.chord.root}${q}`, hasThird });
  }
  return out;
}
