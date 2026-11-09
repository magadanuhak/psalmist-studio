/** Articulation choice by energy, string legato and swell helpers, per-instrument mix defaults. Pure functions. */
import type { NoteEv } from './humanize';
import type { CatalogEntry, Family } from './types';

export interface ArticulationContext {
  /** 0..1 section energy */
  energy: number;
  durSec: number;
  /** 'pad' | 'comp' | 'melody' ... (Role) */
  role?: string;
  /** very quiet emotions (rugaciune, linistit) prefer soft / muted variants */
  soft?: boolean;
  phraseStart?: boolean;
}

const pick = (entry: Pick<CatalogEntry, 'articulations'>, ...prefs: string[]): string => prefs.find((p) => entry.articulations.includes(p)) ?? entry.articulations[0];

/** Choose the articulation id (always one of entry.articulations) for a note, by family, energy and length. */
export function chooseArticulation(entry: Pick<CatalogEntry, 'articulations' | 'family'>, c: ArticulationContext): string {
  const f: Family = entry.family; const e = c.energy; const d = c.durSec;
  switch (f) {
    case 'strings':
      if (e > 0.8 && d < 0.35) return pick(entry, 'spic', 'sus');
      if (c.role === 'comp' && e >= 0.3 && d < 0.6) return pick(entry, 'pizz', 'sus');
      if (c.role === 'pad' && e > 0.88 && d > 1.2) return pick(entry, 'trem', 'sus');
      if (d < 0.18) return pick(entry, 'spic', 'sus');
      return pick(entry, 'sus');
    case 'woodwinds':
    case 'brass':
      if (d < 0.22 || (e > 0.8 && d < 0.4)) return pick(entry, 'stac', 'sus');
      if (c.soft && f === 'brass') return pick(entry, 'mute', 'sus');
      if (d > 1.4 && e > 0.35) return pick(entry, 'vib', 'sus');
      return pick(entry, 'sus');
    case 'organ': return c.soft || e < 0.3 ? pick(entry, 'soft', 'flute8', 'full') : pick(entry, 'full');
    case 'mallets': return e > 0.65 ? pick(entry, 'hard', 'hit', 'pluck') : pick(entry, 'soft', 'hit', 'pluck');
    case 'guitars': return d < 0.3 || c.role === 'melody' ? pick(entry, 'pick', 'strum') : pick(entry, 'strum', 'pick');
    default: return entry.articulations[0];
  }
}

// ---- string legato / swell --------------------------------------------------------------------------

export interface LegatoOptions { overlap?: number; maxGap?: number }

/**
 * Monophonic legato: when the gap to the next note is small, the previous note is stretched to overlap the next
 * by `overlap` seconds and the next note gets a softer attack (bow change instead of a new bow).
 */
export function legato(notes: readonly NoteEv[], o: LegatoOptions = {}): NoteEv[] {
  const overlap = o.overlap ?? 0.06, maxGap = o.maxGap ?? 0.25;
  const s = notes.map((n) => ({ ...n })).sort((a, b) => a.time - b.time);
  for (let i = 0; i < s.length - 1; i++) {
    const n = s[i], nx = s[i + 1];
    if (nx.time <= n.time) continue; // chord, not a line
    const gap = nx.time - (n.time + n.dur);
    if (gap < maxGap) { n.dur = nx.time - n.time + overlap; nx.attack = Math.max(nx.attack ?? 0, 0.07); }
  }
  return s;
}

/** Attack time for a swell note: long, slow bow-in that scales with length and (inverse) energy. */
export function swellAttack(durSec: number, energy = 0.5): number {
  return Math.min(1.2, Math.max(0.08, durSec * (0.32 - 0.14 * Math.min(1, Math.max(0, energy)))));
}

/** Crescendo / decrescendo control curve over a phrase: gain per normalized time 0..1 (smooth cosine). */
export function swellGain(t: number, from = 0.45, to = 1, peakAt = 0.7): number {
  const x = Math.min(1, Math.max(0, t));
  if (x <= peakAt) { const u = x / peakAt; return from + (to - from) * (1 - Math.cos(u * Math.PI)) / 2; }
  const u = (x - peakAt) / (1 - peakAt); return to - (to - from * 0.8) * (1 - Math.cos(u * Math.PI)) / 2 * 0.6;
}

/** Scale note velocities across [t0, t1] with the swell curve (phrase-level dynamics for pads and strings). */
export function applySwell(notes: readonly NoteEv[], t0: number, t1: number, from = 0.45, to = 1, peakAt = 0.7): NoteEv[] {
  const span = Math.max(1e-6, t1 - t0);
  return notes.map((n) => {
    if (n.time < t0 || n.time > t1) return { ...n };
    return { ...n, vel: Math.min(1, n.vel * swellGain((n.time - t0) / span, from, to, peakAt)) };
  });
}

/** Mark pad / string notes that start a phrase with a slow swell attack and a following sustain. */
export function swellNotes(notes: readonly NoteEv[], energy: number): NoteEv[] {
  return notes.map((n) => ({ ...n, attack: swellAttack(n.dur, energy) }));
}

// ---- mix defaults -----------------------------------------------------------------------------------

export interface MixDefaults { pan: number; send: number; gainDb: number }

/** Pan / church-reverb send / trim defaults for an instrument. `send` is scaled by the reverb space size. */
export function mixDefaults(entry: Pick<CatalogEntry, 'pan' | 'send' | 'gainDb'>, spaceId: string = 'biserica'): MixDefaults {
  const k: Record<string, number> = { studio: 0.4, capela: 0.8, biserica: 1, catedrala: 0.8, sala: 0.9 };
  return { pan: entry.pan, send: Math.min(1, entry.send * (k[spaceId] ?? 1)), gainDb: entry.gainDb };
}

/** Nudge pans of instruments that share (nearly) the same position so a band stays readable. */
export function spreadPans(entries: readonly Pick<CatalogEntry, 'id' | 'pan'>[], minGap = 0.18): Record<string, number> {
  const res: Record<string, number> = {}; const used: number[] = [];
  for (const e of [...entries].sort((a, b) => a.pan - b.pan || a.id.localeCompare(b.id))) {
    let p = e.pan;
    for (let guard = 0; guard < 12; guard++) {
      const clash = used.find((u) => Math.abs(u - p) < minGap && Math.abs(p) > 0.05);
      if (clash === undefined) break;
      p = clash + (p >= clash ? minGap : -minGap);
    }
    p = Math.max(-0.9, Math.min(0.9, p)); res[e.id] = Math.round(p * 100) / 100; used.push(res[e.id]);
  }
  return res;
}
