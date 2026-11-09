/** Register policy and voice leading for the accompaniment (A3 / low-voice rule).
 *  - Normal voices ("below"): the harmony stays under the sung line (top <= vocal note - 1).
 *  - Low voices ("above", vocal top <= D4): the harmony sits ABOVE the voice with a gap of >= 3 semitones,
 *    the bass stays below the voice. */
import { chordPcs, chordRoles, hasSeventh } from '../harmony/chords';
import type { Chord } from '../harmony/types';
import type { ArrVocalNote } from './types';

export interface Register {
  mode: 'above' | 'below';
  /** zone for the shared chord voicing */
  lo: number;
  hi: number;
  vocalLo: number;
  vocalHi: number;
  /** highest bass note */
  bassHi: number;
}

export const BASS_LO = 28; // E1
export const GAP_ABOVE = 3;

const pcOf = (m: number) => ((m % 12) + 12) % 12;

/** Vocal range of the song (ignores very short blips). */
export function vocalRange(notes: ArrVocalNote[]): { lo: number; hi: number } | null {
  const real = notes.filter((n) => n.durSec >= 0.12);
  const use = real.length ? real : notes;
  if (!use.length) return null;
  const sorted = use.map((n) => n.midi).sort((a, b) => a - b);
  return { lo: sorted[0], hi: sorted[sorted.length - 1] };
}

export function chooseRegister(notes: ArrVocalNote[]): Register {
  const vr = vocalRange(notes) ?? { lo: 60, hi: 72 };
  const bassHi = Math.max(39, Math.min(48, vr.lo - 2));
  if (vr.hi <= 62) {
    const lo = Math.max(52, vr.hi + GAP_ABOVE);
    return { mode: 'above', lo, hi: lo + 21, vocalLo: vr.lo, vocalHi: vr.hi, bassHi };
  }
  const hi = Math.max(vr.lo - 1, 52);
  return { mode: 'below', lo: Math.max(40, hi - 20), hi, vocalLo: vr.lo, vocalHi: vr.hi, bassHi };
}

interface Opt { v: number[]; own: number }

function moveCost(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const m = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < m; i++) s += Math.abs(a[a.length - 1 - i] - b[b.length - 1 - i]);
  const ca = a.reduce((x, y) => x + y, 0) / a.length, cb = b.reduce((x, y) => x + y, 0) / b.length;
  return s * 0.1 + Math.abs(ca - cb) * 0.12 + Math.abs(a.length - b.length) * 0.3;
}

function pcsFor(c: Chord, n: number): number[] {
  const all = chordPcs(c);
  const roles = chordRoles(c);
  if (all.length >= n) {
    if (n === 3 && all.length === 4 && roles.fifth !== null) return all.filter((p) => p !== roles.fifth);
    return all.slice(0, n);
  }
  return [...all, all[0]];
}

function combos(lists: number[][]): number[][] {
  let acc: number[][] = [[]];
  for (const l of lists) {
    const next: number[][] = [];
    for (const a of acc) for (const x of l) next.push([...a, x]);
    acc = next;
    if (acc.length > 3000) acc = acc.slice(0, 3000);
  }
  return acc;
}

function options(c: Chord, n: number, lo: number, hi: number, mode: Register['mode']): Opt[] {
  const colour = c.quality === 'sus2' || c.quality === 'add9' || hasSeventh(c.quality);
  const pcs = pcsFor(c, n);
  const lists = pcs.map((pc) => { const l: number[] = []; for (let m = lo; m <= hi; m++) if (pcOf(m) === pc) l.push(m); return l; });
  if (lists.some((l) => !l.length)) return [];
  const out: Opt[] = [];
  for (const combo of combos(lists)) {
    const v = [...combo].sort((a, b) => a - b);
    if (new Set(v).size !== v.length) continue;
    if (v[v.length - 1] - v[0] > 17) continue;
    let ok = true;
    for (let k = 1; k < v.length; k++) {
      const gap = v[k] - v[k - 1];
      const minGap = v[k - 1] < 48 ? 5 : colour ? 2 : 3;
      if (gap < minGap) { ok = false; break; }
    }
    if (!ok) continue;
    const top = v[v.length - 1];
    let own = Math.max(0, v[v.length - 1] - v[0] - 12) * 0.12;
    own += mode === 'above' ? 0.05 * Math.max(0, top - (lo + 14)) : 0.05 * (hi - top);
    own += mode === 'above' ? 0.03 * (v[0] - lo) : 0;
    out.push({ v, own });
  }
  out.sort((a, b) => a.own - b.own);
  return out.slice(0, 48);
}

/** Voicing of every slot: `tops[i]` is the highest allowed pitch of slot i (below mode), `voices[i]` the wanted size. */
export function voiceSlots(chords: Chord[], tops: number[], voices: number[], reg: Register): number[][] {
  const n = chords.length;
  const opts: Opt[][] = [];
  for (let i = 0; i < n; i++) {
    const c = chords[i];
    const hiAbs = reg.mode === 'above' ? reg.hi : Math.min(reg.hi, tops[i]);
    let found: Opt[] = [];
    for (const size of [voices[i], 3]) {
      for (let drop = 0; drop <= 24 && !found.length; drop += 6) {
        const lo = Math.max(reg.mode === 'above' ? reg.lo : 36, reg.lo - drop);
        found = options(c, size, lo, hiAbs + (reg.mode === 'above' ? 0 : 0), reg.mode);
      }
      if (found.length) break;
    }
    if (!found.length) {
      const r = chordRoles(c);
      const base = reg.mode === 'above' ? reg.lo : Math.max(40, hiAbs - 12);
      const pick = (pc: number) => { let m = base; while (pcOf(m) !== pc) m++; return m; };
      const root = pick(r.root);
      found = [{ v: [root, root + 7 > hiAbs && reg.mode === 'below' ? root : root + 7], own: 5 }];
    }
    opts.push(found);
  }
  const cost: number[][] = [], back: number[][] = [];
  for (let i = 0; i < n; i++) {
    cost[i] = []; back[i] = [];
    opts[i].forEach((o, j) => {
      if (i === 0) { cost[i][j] = o.own; back[i][j] = 0; return; }
      let best = Infinity, arg = 0;
      opts[i - 1].forEach((p, k) => {
        const c = cost[i - 1][k] + moveCost(p.v, o.v) + o.own;
        if (c < best) { best = c; arg = k; }
      });
      cost[i][j] = best; back[i][j] = arg;
    });
  }
  if (!n) return [];
  const res: number[][] = new Array(n);
  let j = 0;
  for (let k = 1; k < cost[n - 1].length; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  for (let i = n - 1; i >= 0; i--) { res[i] = opts[i][j].v; j = back[i][j]; }
  return res;
}

/** Root of every slot's bass in [E1, bassHi], keeping the line smooth. */
export function bassRoots(chords: Chord[], reg: Register): number[] {
  const out: number[] = [];
  let prev = 36;
  for (const c of chords) {
    const cands: number[] = [];
    for (let m = BASS_LO; m <= reg.bassHi; m++) if (pcOf(m) === c.root) cands.push(m);
    if (!cands.length) cands.push(BASS_LO + ((c.root - BASS_LO) % 12 + 12) % 12);
    cands.sort((a, b) => Math.abs(a - prev) + Math.abs(a - 36) * 0.25 - (Math.abs(b - prev) + Math.abs(b - 36) * 0.25));
    prev = cands[0];
    out.push(cands[0]);
  }
  return out;
}
