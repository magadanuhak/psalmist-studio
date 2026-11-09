/** A4 "chestii random": anomaly detector for a realized arrangement. Every finding is (time, track, note, kind) so a listener's complaint can be traced to a cause. */
import { scalePcs } from '../../music/theory';
import type { KeySig } from '../../model/types';
import { chordPcs } from '../harmony/chords';
import type { Arrangement, ArrVocalNote } from './types';

export type AnomalyKind = 'tinyNote' | 'velOutlier' | 'outOfKey' | 'answerOverVoice' | 'bigLeap' | 'outOfRange' | 'densitySpike' | 'longOverlap';
export interface Anomaly { kind: AnomalyKind; track: string; time: number; midi: number; detail: string }

export interface AnomalyOptions {
  key: KeySig;
  /** sung notes on the song timeline (seconds) */
  vocal: ArrVocalNote[];
  /** playable range of the track's instrument, when known */
  rangeOf?: (trackId: string, inst?: string) => [number, number] | undefined;
  beatSec: number;
  beatsPerBar: number;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function findAnomalies(arr: Arrangement, o: AnomalyOptions): Anomaly[] {
  const out: Anomaly[] = [];
  const scale = scalePcs(o.key);
  const barSec = o.beatSec * o.beatsPerBar;
  const chordAt = (t: number) => {
    for (const s of arr.plan) {
      if (t < s.startSec || t >= s.startSec + s.durSec) continue;
      let r = null as (typeof s.chords)[number] | null;
      for (const c of s.chords) if (s.startSec + c.startSec <= t + 1e-6) r = c;
      return r;
    }
    return null;
  };
  const vocal = [...o.vocal].sort((a, b) => a.startSec - b.startSec);
  for (const tr of arr.tracks) {
    if (tr.drums) continue;
    const ns = [...tr.notes].sort((a, b) => a.startSec - b.startSec);
    if (!ns.length) continue;
    const velMed = median(ns.map((n) => n.vel));
    const range = o.rangeOf?.(tr.id, tr.inst);
    const melodic = tr.id === 'hook' || tr.id === 'answers' || tr.id === 'counter';
    // per-bar density against the track's own median
    const perBar = new Map<number, number>();
    for (const n of ns) { const b = Math.floor(n.startSec / barSec); perBar.set(b, (perBar.get(b) ?? 0) + 1); }
    const dMed = median([...perBar.values()]);
    ns.forEach((n, i) => {
      if (n.durSec < 0.09) out.push({ kind: 'tinyNote', track: tr.id, time: n.startSec, midi: n.midi, detail: `${Math.round(n.durSec * 1000)} ms` });
      if (velMed > 0 && (n.vel > velMed * 1.9 || n.vel < velMed * 0.35) && Math.abs(n.vel - velMed) > 0.3) out.push({ kind: 'velOutlier', track: tr.id, time: n.startSec, midi: n.midi, detail: `vel ${n.vel.toFixed(2)} vs median ${velMed.toFixed(2)}` });
      if (range && (n.midi < range[0] || n.midi > range[1])) out.push({ kind: 'outOfRange', track: tr.id, time: n.startSec, midi: n.midi, detail: `range ${range[0]}-${range[1]}` });
      // off-scale and not a chord tone, on a strong beat (beat 1 of a bar) of a sustained note
      const posInBar = (n.startSec / barSec) % 1;
      const strong = posInBar < 0.04 || posInBar > 0.96;
      if (strong && n.durSec >= 0.3) {
        const c = chordAt(n.startSec + 0.01);
        const pc = ((n.midi % 12) + 12) % 12;
        if (!scale.has(pc) && !(c && chordPcs(c.chord).includes(pc))) out.push({ kind: 'outOfKey', track: tr.id, time: n.startSec, midi: n.midi, detail: 'not in the scale or the chord, strong beat' });
      }
      if (melodic) {
        const nx = ns[i + 1];
        if (nx && nx.startSec - (n.startSec + n.durSec) < 0.5 && Math.abs(nx.midi - n.midi) > 12) out.push({ kind: 'bigLeap', track: tr.id, time: nx.startSec, midi: nx.midi, detail: `${Math.abs(nx.midi - n.midi)} semitones` });
        if (tr.id !== 'counter') {
          let ov = 0;
          for (const v of vocal) { if (v.startSec >= n.startSec + n.durSec) break; ov += Math.max(0, Math.min(n.startSec + n.durSec, v.startSec + v.durSec) - Math.max(n.startSec, v.startSec)); }
          if (ov > 0.3) out.push({ kind: 'answerOverVoice', track: tr.id, time: n.startSec, midi: n.midi, detail: `${Math.round(ov * 1000)} ms over the singing` });
        }
      }
    });
    if (dMed > 0) for (const [b, c] of perBar) if (c > Math.max(12, dMed * 3)) out.push({ kind: 'densitySpike', track: tr.id, time: b * barSec, midi: 0, detail: `${c} notes in one bar (median ${dMed})` });
  }
  return out.sort((a, b) => a.time - b.time);
}

export const summarize = (a: Anomaly[]): Record<string, number> => { const r: Record<string, number> = {}; for (const x of a) r[x.kind] = (r[x.kind] ?? 0) + 1; return r; };
