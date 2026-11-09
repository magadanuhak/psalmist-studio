/**
 * "Variantă AI" per layer: notes proposed by the local accompaniment generator are never trusted as they are.
 * They pass our rule filters (key, chords, vocal clash guard, instrument range, density), then the anomaly detector reports what is left.
 */
import { scalePcs } from '../../music/theory';
import type { KeySig } from '../../model/types';
import { chordPcs } from '../harmony/chords';
import { findAnomalies, type Anomaly } from './anomaly';
import { guardClashes } from './realize';
import type { ArrNote, ArrTrack, ArrVocalNote, Arrangement, PlanSection } from './types';

export interface VariantCtx {
  key: KeySig;
  plan: PlanSection[];
  /** sung notes on the song timeline */
  vocal: ArrVocalNote[];
  /** practical range of the layer's instrument (MIDI) */
  range: [number, number];
  beatSec: number;
  beatsPerBar: number;
  /** most notes a bar may hold (density cap) */
  maxPerBar?: number;
}

export interface VariantReport { input: number; kept: number; folded: number; snapped: number; dropped: { range: number; offChord: number; outOfKey: number; clash: number; density: number }; anomalies: Anomaly[] }
export interface VariantResult { notes: ArrNote[]; report: VariantReport }

const mod = (n: number) => ((n % 12) + 12) % 12;

/** the chord sounding at song time t, or null */
function chordAt(plan: PlanSection[], t: number) {
  for (const s of plan) {
    if (t < s.startSec - 1e-6 || t >= s.startSec + s.durSec - 1e-6) continue;
    let r = null as (typeof s.chords)[number] | null;
    for (const c of s.chords) if (s.startSec + c.startSec <= t + 1e-6) r = c;
    return r;
  }
  return null;
}

/** Rule-filter AI notes for one layer. Pure; the caller decides what to do with the result. */
export function filterAiNotes(raw: ArrNote[], layer: Pick<ArrTrack, 'id' | 'name' | 'gm' | 'channel' | 'level' | 'pan' | 'reverb' | 'inst'>, ctx: VariantCtx): VariantResult {
  const [lo, hi] = ctx.range;
  const scale = new Set(scalePcs(ctx.key));
  const rep: VariantReport = { input: raw.length, kept: 0, folded: 0, snapped: 0, dropped: { range: 0, offChord: 0, outOfKey: 0, clash: 0, density: 0 }, anomalies: [] };
  let out: ArrNote[] = [];
  for (const n0 of [...raw].sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)) {
    let n = { ...n0 };
    // range: fold by octaves into the instrument's range
    if (n.midi < lo || n.midi > hi) {
      let m = n.midi;
      while (m < lo) m += 12;
      while (m > hi) m -= 12;
      if (m < lo || m > hi) { rep.dropped.range++; continue; }
      n = { ...n, midi: m }; rep.folded++;
    }
    const ch = chordAt(ctx.plan, n.startSec);
    const beatPos = n.startSec / ctx.beatSec;
    const onBeat = Math.abs(beatPos - Math.round(beatPos)) < 0.08;
    const strong = onBeat || n.durSec >= ctx.beatSec * 0.95;
    if (ch) {
      const pcs = new Set(chordPcs(ch.chord));
      if (strong && !pcs.has(mod(n.midi))) {
        // strong or long notes must be chord tones: snap to the nearest one within a whole step, otherwise drop
        const cand = [-2, -1, 1, 2].map((d) => n.midi + d).filter((m) => pcs.has(mod(m)) && m >= lo && m <= hi).sort((a, b) => Math.abs(a - n.midi) - Math.abs(b - n.midi));
        if (!cand.length) { rep.dropped.offChord++; continue; }
        n = { ...n, midi: cand[0] }; rep.snapped++;
      } else if (!strong && !pcs.has(mod(n.midi)) && !scale.has(mod(n.midi))) { rep.dropped.outOfKey++; continue; }
    } else if (!scale.has(mod(n.midi))) { rep.dropped.outOfKey++; continue; }
    out.push(n);
  }
  // density: at most maxPerBar notes per bar, the loudest and longest survive
  const barSec = ctx.beatSec * ctx.beatsPerBar;
  const maxBar = ctx.maxPerBar ?? 16;
  const byBar = new Map<number, ArrNote[]>();
  for (const n of out) { const b = Math.floor(n.startSec / barSec + 1e-6); (byBar.get(b) ?? byBar.set(b, []).get(b)!).push(n); }
  const keep = new Set<ArrNote>();
  for (const ns of byBar.values()) {
    const ranked = [...ns].sort((a, b) => b.vel * b.durSec - a.vel * a.durSec).slice(0, maxBar);
    ranked.forEach((n) => keep.add(n));
    rep.dropped.density += ns.length - ranked.length;
  }
  out = out.filter((n) => keep.has(n));
  // clash guard against the sung notes
  const track: ArrTrack = { id: layer.id, name: layer.name, gm: layer.gm, channel: layer.channel, drums: false, inst: layer.inst, level: layer.level, pan: layer.pan, reverb: layer.reverb, notes: out };
  const probe: Arrangement = { tracks: [track], plan: ctx.plan, songSec: ctx.plan.reduce((m, s) => Math.max(m, s.startSec + s.durSec), 0), markers: [], transitions: [], register: { mode: 'above', lo, hi, vocalLo: 0, vocalHi: 127 } };
  const guarded = guardClashes(probe, ctx.vocal).tracks[0].notes;
  rep.dropped.clash = out.length - guarded.length;
  rep.kept = guarded.length;
  rep.anomalies = findAnomalies({ ...probe, tracks: [{ ...track, notes: guarded }] }, { key: ctx.key, vocal: ctx.vocal, rangeOf: () => [lo, hi], beatSec: ctx.beatSec, beatsPerBar: ctx.beatsPerBar });
  return { notes: guarded, report: rep };
}
