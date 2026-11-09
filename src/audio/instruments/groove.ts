/**
 * Real-drummer groove patterns (Groove MIDI Dataset, Google/Magenta, CC BY 4.0) converted to compact JSON by
 * scripts/instruments/groove.mjs. This module loads, selects and renders them. Attribution lives in the JSON
 * (`attribution`) and in public/instruments/LICENSES.md.
 */
import { hashSeed, mulberry32 } from './humanize';
import type { Genre } from './types';

export type DrumRole = 'k' | 's' | 'ss' | 'hc' | 'ho' | 'hp' | 'tl' | 'tm' | 'th' | 'cr' | 'rd';
export type GrooveFeel = 'straight8' | 'straight16' | 'swing';
export type Level = 'low' | 'mid' | 'high';

export interface GroovePattern {
  id: string;
  type: 'beat' | 'fill';
  style: string;
  bpm: number;
  /** '4/4' | '3/4' | '6/8' (2/4 is derived) */
  sig: string;
  bars: number;
  feel: GrooveFeel;
  /** events per beat */
  dens: number;
  vel: number;
  energy: Level;
  tempo: 'slow' | 'mid' | 'fast';
  /** [position in quarter-note beats within the pattern, role index, velocity 1..127] */
  ev: [number, number, number][];
}
export interface GrooveData { version: number; roles: DrumRole[]; attribution: string; license: string; source: string; patterns: GroovePattern[] }

export interface DrumHit { time: number; role: DrumRole; vel: number; /** GM drum note */ note: number }

export const ROLE_GM: Record<DrumRole, number> = { k: 36, s: 38, ss: 37, hc: 42, ho: 46, hp: 44, tl: 45, tm: 47, th: 50, cr: 49, rd: 51 };
export const BEATS_PER_BAR: Record<string, number> = { '4/4': 4, '3/4': 3, '6/8': 3, '2/4': 2 };

/** Which dataset styles suit which genre of the app. */
export const GENRE_STYLES: Record<Genre, string[]> = {
  worship: ['pop', 'rock', 'gospel', 'soul'],
  imn: ['gospel', 'pop', 'country'],
  cantare: ['country', 'pop', 'gospel', 'reggae', 'highlife'],
  pop: ['pop', 'funk', 'dance', 'soul', 'rock'],
  rock: ['rock', 'punk', 'funk'],
  popular: ['country', 'reggae', 'highlife', 'funk', 'pop'],
};

let cache: Promise<GrooveData> | null = null;
export async function loadGrooves(baseUrl?: string, fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<GrooveData> {
  const b = baseUrl ?? `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}instruments/`;
  cache ??= fetchFn(`${b}grooves/grooves.json`).then((r) => { if (!r.ok) throw new Error('grooves HTTP ' + r.status); return r.json() as Promise<GrooveData>; });
  return cache;
}
export function resetGrooveCache(): void { cache = null; }

/** Does the pattern play in this meter without modification? */
export function fitsMeter(p: Pick<GroovePattern, 'sig'>, sig: string): boolean { return p.sig === sig; }

/** Meters without native data: 2/4 = first half of a 4/4 bar; others (5/8, 7/8, 9/8) -> null (use synthetic patterns). */
export function deriveMeter(p: GroovePattern, sig: string): GroovePattern | null {
  if (p.sig === sig) return p;
  if (sig === '2/4' && p.sig === '4/4' && p.bars === 1 && p.type === 'beat') {
    const ev = p.ev.filter((e) => e[0] < 2);
    return ev.length >= 3 ? { ...p, id: p.id + '@2/4', sig: '2/4', ev, dens: ev.length / 2 } : null;
  }
  return null;
}

export interface PickOptions {
  sig: string;
  bpm: number;
  type?: 'beat' | 'fill';
  energy?: Level;
  genre?: Genre;
  feel?: GrooveFeel;
  bars?: number;
  seed: number;
}

function energyOf(x: number): Level { return x < 0.34 ? 'low' : x < 0.67 ? 'mid' : 'high'; }
export { energyOf as energyLevel };

/** Choose the best-fitting pattern (deterministic per seed among the top candidates). Returns null if no pattern fits the meter. */
export function pickGroove(data: GrooveData, o: PickOptions): GroovePattern | null {
  const type = o.type ?? 'beat';
  const styles = o.genre ? GENRE_STYLES[o.genre] : [];
  const cands: { p: GroovePattern; score: number }[] = [];
  for (const p0 of data.patterns) {
    if (p0.type !== type) continue;
    const p = deriveMeter(p0, o.sig); if (!p) continue;
    if (o.bars && p.bars !== o.bars && type === 'beat') continue;
    let s = Math.abs(Math.log2(o.bpm / p.bpm)) * 2;                 // tempo distance (octaves)
    if (o.energy && p.energy !== o.energy) s += 1.2;
    if (o.feel && p.feel !== o.feel) s += 1.5;
    if (styles.length) { const i = styles.indexOf(p.style); s += i < 0 ? 1.5 : i * 0.15; }
    cands.push({ p, score: s });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.score - b.score || a.p.id.localeCompare(b.p.id));
  const top = cands.slice(0, Math.min(5, cands.length));
  return top[Math.floor(mulberry32(hashSeed(o.seed, o.bpm))() * top.length)].p;
}

export interface RenderOptions { startSec: number; bpm: number; /** scale velocities (e.g. section energy) */ velScale?: number; /** repeat the pattern this many times */ repeat?: number }

/** Render a pattern to timed drum hits (positions are in quarter notes, so any tempo works). */
export function grooveToHits(p: GroovePattern, roles: readonly DrumRole[], o: RenderOptions): DrumHit[] {
  const beat = 60 / o.bpm; const len = (BEATS_PER_BAR[p.sig] ?? 4) * p.bars; const out: DrumHit[] = [];
  for (let r = 0; r < (o.repeat ?? 1); r++) {
    for (const [pos, ri, v] of p.ev) {
      const role = roles[ri]; if (!role) continue;
      out.push({ time: o.startSec + (r * len + pos) * beat, role, vel: Math.min(1, Math.max(0.03, (v / 127) * (o.velScale ?? 1))), note: ROLE_GM[role] });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
