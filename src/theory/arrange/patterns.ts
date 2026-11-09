/** Pattern library (A3): comping, bass and drum patterns for every supported meter. Positions are in beats
 *  (units of the denominator) from the bar start; accents follow the meter grouping. */
import type { TimeSig } from '../../model/types';
import { DR } from './presets';
import type { DrumStyle } from './types';

export const isEighthMeter = (sig: TimeSig) => sig.den === 8;
/** compound meters (6/8, 12/8): every beat group is three eighths */
export const isCompound = (sig: TimeSig) => sig.den === 8 && sig.grouping.length > 0 && sig.grouping.every((g) => g === 3);

/** 12/8 / 6/8 ballad arpeggio: 1-5-8-10-8-5 over six eighths (indices into the voicing, low to high); `slow` plays one note per beat group */
export const COMPOUND_ARP = [0, 1, 2, 3, 2, 1];
export const COMPOUND_ARP_SLOW = [0, 2, 1, 2];

export function groupStarts(sig: TimeSig): number[] {
  const out: number[] = [];
  let p = 0;
  for (const g of sig.grouping) { out.push(p); p += g; }
  return out;
}

/** Accent weight (0..1) of every beat of the bar. Beat 1 is the strongest, group starts next. */
export function accentMap(sig: TimeSig): number[] {
  const gs = groupStarts(sig);
  const m: number[] = [];
  for (let p = 0; p < sig.num; p++) {
    if (p === 0) m.push(1);
    else if (isEighthMeter(sig)) m.push(gs.includes(p) ? 0.8 : 0.4);
    else if (sig.num === 4 && p === 2) m.push(0.8);
    else m.push(0.55);
  }
  return m;
}

/** weight of an arbitrary (possibly fractional) bar position */
export function accentAt(sig: TimeSig, pos: number): number {
  const b = Math.floor(pos + 1e-6);
  const base = accentMap(sig)[Math.min(sig.num - 1, Math.max(0, b))];
  return pos - b > 1e-6 ? base * 0.55 : base;
}

/** Guitar strum hits of one bar. */
export function strumPositions(sig: TimeSig): number[] {
  if (isEighthMeter(sig)) {
    const out: number[] = [];
    let p = 0;
    for (const g of sig.grouping) { out.push(p); if (g >= 3) out.push(p + 2); p += g; }
    return out;
  }
  if (sig.num === 4) return [0, 1.5, 2, 3.5];
  if (sig.num === 3) return [0, 1.5, 2];
  return [0, 1.5];
}

/** Arpeggio step positions of one bar. `fine` = eighth notes in simple meters (the pulse in eighth meters). */
export function arpPositions(sig: TimeSig, fine: boolean): number[] {
  if (isEighthMeter(sig)) return fine ? Array.from({ length: sig.num }, (_, i) => i) : strumPositions(sig);
  const step = fine ? 0.5 : 1;
  const out: number[] = [];
  for (let p = 0; p < sig.num - 1e-6; p += step) out.push(p);
  return out;
}

export interface OomHit { pos: number; low: boolean }
/** Folk "oom-pa" pattern: low note on group starts, chord on the other pulses. */
export function oompahPositions(sig: TimeSig): OomHit[] {
  if (isEighthMeter(sig)) {
    const out: OomHit[] = [];
    let p = 0;
    for (const g of sig.grouping) {
      out.push({ pos: p, low: true });
      for (let i = 1; i < g; i++) out.push({ pos: p + i, low: false });
      p += g;
    }
    return out;
  }
  return Array.from({ length: sig.num }, (_, i) => ({ pos: i, low: sig.num === 4 ? i % 2 === 0 : i === 0 }));
}

/** Even pulse positions (eighths in simple meters, every pulse in eighth meters). */
export function pulsePositions(sig: TimeSig): number[] {
  const step = isEighthMeter(sig) ? 1 : 0.5;
  const out: number[] = [];
  for (let p = 0; p < sig.num - 1e-6; p += step) out.push(p);
  return out;
}

export interface BassHit { pos: number; fifth: boolean }
export function bassPositions(sig: TimeSig, style: 'rootFifth' | 'folk'): BassHit[] {
  const gs = groupStarts(sig);
  if (style === 'rootFifth') {
    if (isEighthMeter(sig)) {
      const out: BassHit[] = [];
      sig.grouping.forEach((g, i) => { out.push({ pos: gs[i], fifth: false }); if (g >= 3) out.push({ pos: gs[i] + 2, fifth: true }); });
      return out;
    }
    if (sig.num === 4) return [{ pos: 0, fifth: false }, { pos: 1.5, fifth: false }, { pos: 2, fifth: true }, { pos: 3.5, fifth: false }];
    if (sig.num === 3) return [{ pos: 0, fifth: false }, { pos: 1.5, fifth: true }];
    return [{ pos: 0, fifth: false }, { pos: 1, fifth: true }];
  }
  if (isEighthMeter(sig)) return gs.map((p, i) => ({ pos: p, fifth: i % 2 === 1 }));
  if (sig.num === 4) return [{ pos: 0, fifth: false }, { pos: 2, fifth: true }];
  if (sig.num === 3) return [{ pos: 0, fifth: false }];
  return [{ pos: 0, fifth: false }, { pos: 1, fifth: true }];
}

export interface DrumHit { pos: number; note: number; vel: number }

/** Notes that count as strong (accent) drum hits: they only fall on group starts in eighth meters. */
export const STRONG_DRUMS: number[] = [DR.kick, DR.snare, DR.crash];

/** Backbeat positions (snare / rim) of a simple meter. */
function backbeats(sig: TimeSig): number[] {
  if (sig.num === 4) return [1, 3];
  if (sig.num === 3) return [1, 2];
  return [1];
}

/** One bar of drums. Velocity 0..1 (energy / emotion scaling is applied by the caller). */
export function drumBar(sig: TimeSig, style: DrumStyle, energy: number): DrumHit[] {
  const out: DrumHit[] = [];
  const gs = groupStarts(sig);
  const eighth = isEighthMeter(sig);
  const add = (pos: number, note: number, vel: number) => out.push({ pos, note, vel });
  const others = gs.filter((p) => p > 0);
  const hatSteps = pulsePositions(sig);
  switch (style) {
    case 'off': break;
    case 'sparse':
      add(0, DR.kick, 0.85);
      if (eighth) for (const p of others) add(p, DR.rim, 0.42);
      else for (const p of backbeats(sig)) add(p, DR.rim, 0.38);
      break;
    case 'kit':
    case 'kit8': {
      add(0, DR.kick, 0.95);
      if (eighth) for (const p of others) add(p, DR.snare, 0.78);
      else {
        for (const p of backbeats(sig)) add(p, DR.snare, 0.74);
        if (sig.num === 4) add(2, DR.kick, 0.7);
      }
      const hs = style === 'kit' && !eighth ? Array.from({ length: sig.num }, (_, i) => i) : hatSteps;
      for (const p of hs) add(p, DR.hatC, Number.isInteger(p) ? 0.34 : 0.24);
      break;
    }
    case 'rock': {
      add(0, DR.kick, 0.98);
      if (eighth) for (const p of others) add(p, DR.snare, 0.85);
      else {
        for (const p of backbeats(sig)) add(p, DR.snare, 0.82);
        if (sig.num === 4) { add(2, DR.kick, 0.78); if (energy >= 4) add(2.5, DR.kick, 0.55); if (energy >= 5) add(3.5, DR.kick, 0.5); }
      }
      for (const p of hatSteps) add(p, energy >= 4 && !Number.isInteger(p) ? DR.hatO : DR.hatC, Number.isInteger(p) ? 0.4 : 0.28);
      break;
    }
    case 'perc':
    case 'percFull': {
      for (const p of hatSteps) if (!Number.isInteger(p) || eighth || style === 'percFull') add(p, DR.shaker, Number.isInteger(p) ? 0.3 : 0.2);
      for (const p of gs) add(p, DR.tamb, p === 0 ? 0.55 : 0.42);
      if (style === 'percFull') {
        add(0, DR.kick, 0.8);
        if (eighth) for (const p of others) add(p, DR.rim, 0.45);
        else for (const p of backbeats(sig)) add(p, DR.rim, 0.45);
      }
      break;
    }
    case 'hora': {
      if (eighth) {
        gs.forEach((p, i) => add(p, DR.kick, i === 0 ? 0.95 : 0.76));
        for (let p = 0; p < sig.num; p++) if (!gs.includes(p)) add(p, DR.tamb, 0.32);
      } else {
        add(0, DR.kick, 0.95);
        for (const p of backbeats(sig)) add(p, sig.num === 4 && p === 2 ? DR.kick : DR.rim, sig.num === 4 && p === 2 ? 0.76 : 0.55);
        if (sig.num === 4) add(2, DR.kick, 0.76);
        for (let p = 0.5; p < sig.num; p += 1) add(p, DR.tamb, 0.32);
      }
      break;
    }
  }
  // de-duplicate identical (pos,note)
  const seen = new Set<string>();
  return out.filter((h) => { const k = `${h.pos}|${h.note}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.pos - b.pos);
}

/** Tom fill filling the last half bar (or last group) of a bar. */
export function fillBar(sig: TimeSig): DrumHit[] {
  const eighth = isEighthMeter(sig);
  const step = eighth ? 1 : 0.5;
  const span = eighth ? Math.min(sig.num - 1, sig.grouping[sig.grouping.length - 1] + 1) : Math.min(sig.num, 2);
  const start = sig.num - span;
  const toms = [DR.tomHi, DR.tomHi, DR.tomMid, DR.tomLo];
  const out: DrumHit[] = [];
  if (start > 0) {
    out.push({ pos: 0, note: DR.kick, vel: 0.9 });
    const g = groupStarts(sig);
    for (const p of g) if (p > 0 && p < start) out.push({ pos: p, note: DR.snare, vel: 0.7 });
  } else out.push({ pos: 0, note: DR.kick, vel: 0.9 });
  const n = Math.max(1, Math.round(span / step));
  for (let i = 0; i < n; i++) {
    out.push({ pos: start + i * step, note: toms[Math.min(toms.length - 1, Math.floor((i / n) * toms.length))], vel: 0.55 + 0.35 * (i / Math.max(1, n - 1)) });
  }
  return out;
}
