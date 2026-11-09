import type { Genre, KeySig, Note } from '../../model/types';
import { GENRE_BIAS } from './bias';
import { chordPcs, chordRoles, hasSeventh } from './chords';
import type { Chord, HarmonySlot } from './types';

export interface VoicedSlot {
  /** ascending MIDI pitches of the chord layer (imn: T, A, S) */
  voicing: number[];
  bass: number;
  bassPc: number;
  /** 0 root position, 1 first inversion, 2 second inversion */
  inversion: 0 | 1 | 2;
  /** soprano / vocal note used for this slot (SATB) */
  soprano: number | null;
}

export interface VoiceInput {
  chords: Chord[];
  slots: HarmonySlot[];
  notes: Note[];
  key: KeySig;
  genre: Genre;
}

export const BASS_LO = 28; // E1
export const BASS_HI = 48; // C3

const pcOf = (m: number) => ((m % 12) + 12) % 12;

function soundingAt(notes: Note[], sec: number, tol: number): Note | undefined {
  return notes.find((n) => n.startSec - tol <= sec && sec < n.startSec + n.durSec - 1e-6);
}
function slotNotes(notes: Note[], s: HarmonySlot): Note[] {
  return notes.filter((n) => n.startSec < s.startSec + s.durSec - 1e-6 && n.startSec + n.durSec > s.startSec + 1e-6);
}

/** Parallel (or hidden-by-repetition-free) perfect 5ths / octaves between two voices over a change. */
export function parallelPerfect(a1: number, b1: number, a2: number, b2: number): boolean {
  const i1 = pcOf(a1 - b1), i2 = pcOf(a2 - b2);
  if (i1 !== i2 || (i1 !== 0 && i1 !== 7)) return false;
  return a1 !== a2 || b1 !== b2; // some voice moved
}

interface BassCand { midi: number; role: 0 | 1 | 2 }

function bassCandidates(c: Chord, lo: number, hi: number): BassCand[] {
  const r = chordRoles(c);
  const out: BassCand[] = [];
  const tones: [number | null, 0 | 1 | 2][] = [[r.root, 0], [r.third, 1], [r.fifth, 2]];
  const sus = c.quality === 'sus2' || c.quality === 'sus4' || c.quality === 'add9';
  for (const [pc, role] of tones) {
    if (pc === null) continue;
    if (sus && role === 1) continue;
    let found = false;
    for (let m = lo; m <= hi; m++) if (pcOf(m) === pc) { out.push({ midi: m, role }); found = true; }
    if (!found) for (let m = Math.max(BASS_LO, lo - 12); m <= hi; m++) if (pcOf(m) === pc) out.push({ midi: m, role });
  }
  return out;
}

export function voiceSection(inp: VoiceInput): VoicedSlot[] {
  const { chords, slots, notes, key, genre } = inp;
  const n = chords.length;
  const g = GENRE_BIAS[genre];
  const beatTol = slots.length > 1 ? Math.min(0.08, slots[0].durSec * 0.05) : 0.05;
  const rangeLo = notes.length ? Math.min(...notes.map((x) => x.midi)) : 60;
  const rangeHi = notes.length ? Math.max(...notes.map((x) => x.midi)) : 72;
  /** low voices (below G3): chords sit ABOVE the voice with a gap; the bass goes an octave+ under it */
  const above = !GENRE_BIAS[genre].satb && rangeLo < 55;

  // soprano per slot (SATB)
  const sop: (number | null)[] = [];
  let carry: number | null = null;
  slots.forEach((s) => {
    const at = soundingAt(notes, s.startSec, beatTol + 0.02);
    const first = at ?? notes.filter((x) => x.startSec >= s.startSec && x.startSec < s.startSec + s.durSec).sort((a, b) => a.startSec - b.startSec)[0];
    if (first) carry = first.midi;
    sop.push(first ? first.midi : carry);
  });

  // ---------------- bass DP (inversions + octave) ----------------
  const bLo = g.satb ? 40 : BASS_LO;
  const bHi = above ? Math.min(BASS_HI, Math.max(BASS_LO + 11, rangeLo - 10)) : BASS_HI;
  const cands = chords.map((c, i) => {
    let list = bassCandidates(c, bLo, bHi);
    const mustRoot = slots[i].phraseEnd || i === n - 1 || (!g.satb && i + 1 < n && slots[i + 1].phraseEnd);
    if (mustRoot) list = list.filter((x) => x.role === 0);
    return list.length ? list : bassCandidates(c, BASS_LO, BASS_HI).filter((x) => x.role === 0);
  });
  const cost: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i < n; i++) {
    cost[i] = []; back[i] = [];
    cands[i].forEach((b, j) => {
      let own = b.role === 0 ? 0 : b.role === 1 ? 0.35 : 0.9;
      own += 0.02 * Math.abs(b.midi - 38);
      if (i === 0) { cost[i][j] = own; back[i][j] = 0; return; }
      let best = Infinity, arg = 0;
      cands[i - 1].forEach((p, k) => {
        const d = Math.abs(b.midi - p.midi);
        let c = cost[i - 1][k] + own + 0.05 * d;
        if (b.role > 0 && d <= 2 && d > 0) c -= 0.3;
        if (g.satb && sop[i] !== null && sop[i - 1] !== null && parallelPerfect(sop[i - 1]!, p.midi, sop[i]!, b.midi)) c += 8;
        if (g.satb && sop[i] !== null && b.midi > sop[i]!) c += 20;
        if (c < best) { best = c; arg = k; }
      });
      cost[i][j] = best; back[i][j] = arg;
    });
  }
  const bassIdx: number[] = new Array(n);
  let bj = 0;
  for (let j = 1; j < cost[n - 1].length; j++) if (cost[n - 1][j] < cost[n - 1][bj]) bj = j;
  for (let i = n - 1; i >= 0; i--) { bassIdx[i] = bj; bj = back[i][bj]; }
  const bass = chords.map((_, i) => cands[i][bassIdx[i]]);

  // ---------------- upper voicing ----------------
  const out: VoicedSlot[] = [];
  const voicings: number[][] = g.satb ? satbVoicing(chords, bass, sop, key) : padVoicing(chords, bass, slots, notes, rangeLo, rangeHi, above);
  for (let i = 0; i < n; i++) {
    out.push({ voicing: voicings[i], bass: bass[i].midi, bassPc: pcOf(bass[i].midi), inversion: bass[i].role, soprano: sop[i] });
  }
  return out;
}

function moveCost(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const m = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < m; i++) s += Math.abs(a[a.length - 1 - i] - b[b.length - 1 - i]);
  const ca = a.reduce((x, y) => x + y, 0) / a.length, cb = b.reduce((x, y) => x + y, 0) / b.length;
  return s * 0.1 + Math.abs(ca - cb) * 0.1 + Math.abs(a.length - b.length) * 0.3;
}

function combos<T>(lists: T[][]): T[][] {
  let acc: T[][] = [[]];
  for (const l of lists) {
    const next: T[][] = [];
    for (const a of acc) for (const x of l) next.push([...a, x]);
    acc = next;
    if (acc.length > 4000) acc = acc.slice(0, 4000);
  }
  return acc;
}

function padVoicing(chords: Chord[], bass: BassCand[], slots: HarmonySlot[], notes: Note[], rangeLo: number, rangeHi: number, above: boolean): number[][] {
  const n = chords.length;
  const options: { v: number[]; own: number }[][] = [];
  const aboveLo = Math.max(rangeHi + 3, 55);
  for (let i = 0; i < n; i++) {
    const c = chords[i];
    const sn = slotNotes(notes, slots[i]);
    const melMin = sn.length ? Math.min(...sn.map((x) => x.midi)) : rangeLo;
    const pcs = chordPcs(c);
    const roles = chordRoles(c);
    // default voicing is a 3-note triad: 7ths / add9 lose their fifth
    let set = pcs.length === 4 && roles.fifth !== null ? pcs.filter((p) => p !== roles.fifth) : pcs;
    // a sung note held >= 250 ms must not sit a semitone from a voiced chord tone (A over a held D: drop C#, leave A5)
    const held = sn.filter((x) => x.durSec >= 0.25).map((x) => pcOf(x.midi));
    if (held.length) {
      const clash = (pc: number) => held.some((h) => { const d = pcOf(pc - h); return d === 1 || d === 11; });
      let kept = set.filter((pc) => !clash(pc));
      if (kept.length < 2) kept = pcs.filter((pc) => pc === roles.root || pc === roles.fifth).filter((pc) => !clash(pc) || pc === roles.root);
      if (kept.length) set = kept;
    }
    const tight = c.quality === 'sus2' || c.quality === 'add9' || hasSeventh(c.quality);
    let found: { v: number[]; own: number }[] = [];
    const tryRange = (lo: number, hi: number, maxSpan: number): void => {
      const lists = set.map((pc) => {
        const l: number[] = [];
        for (let m = lo; m <= hi; m++) if (pcOf(m) === pc) l.push(m);
        return l;
      });
      if (lists.some((l) => !l.length)) return;
      for (const combo of combos(lists)) {
        const v = [...combo].sort((a, b) => a - b);
        if (new Set(v).size !== v.length || v[v.length - 1] - v[0] > maxSpan) continue;
        let ok = true;
        for (let k = 1; k < v.length; k++) {
          const minGap = v[k - 1] < 48 ? 5 : tight ? 2 : 3;
          if (v[k] - v[k - 1] < minGap) { ok = false; break; }
        }
        if (!ok) continue;
        const top = v[v.length - 1];
        let own = 0;
        if (above) {
          const mean = v.reduce((x, y) => x + y, 0) / v.length;
          own += 0.03 * Math.abs(mean - 66);
        } else {
          if (top > melMin - 3) own += 1.0 * (top - (melMin - 3));
          for (const m of v) if (m < 48 && pcOf(m) !== roles.root && pcOf(m) !== roles.fifth) own += 2.0;
          if (v[0] < bass[i].midi + 2) own += 0.5;
          if (v[0] < 43) own += 0.4;
          own += 0.04 * (melMin - top);
        }
        if (v[v.length - 1] - v[0] < 9) own += 0.25;
        found.push({ v, own });
      }
    };
    if (above) {
      tryRange(aboveLo, aboveLo + 19, 15);
    } else {
      for (let relax = 0; relax <= 16 && !found.length; relax++) tryRange(40, melMin + relax, 17);
    }
    if (!found.length) found = [{ v: set.map((p, k) => 48 + ((p - 48 + 120) % 12) + (k > 2 ? 12 : 0)).sort((a, b) => a - b), own: 5 }];
    found.sort((a, b) => a.own - b.own);
    options.push(found.slice(0, 60));
  }
  // DP over movement
  const cost: number[][] = [], back: number[][] = [];
  for (let i = 0; i < n; i++) {
    cost[i] = []; back[i] = [];
    options[i].forEach((o, j) => {
      if (i === 0) { cost[i][j] = o.own; back[i][j] = 0; return; }
      let best = Infinity, arg = 0;
      options[i - 1].forEach((p, k) => {
        const c = cost[i - 1][k] + moveCost(p.v, o.v) + o.own;
        if (c < best) { best = c; arg = k; }
      });
      cost[i][j] = best; back[i][j] = arg;
    });
  }
  const res: number[][] = new Array(n);
  let j = 0;
  for (let k = 1; k < cost[n - 1].length; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  for (let i = n - 1; i >= 0; i--) { res[i] = options[i][j].v; j = back[i][j]; }
  return res;
}

/** Four-part hymn writing: soprano = vocal melody; A/T chosen by the classic rules. Returns [T, A, S]. */
function satbVoicing(chords: Chord[], bass: BassCand[], sop: (number | null)[], key: KeySig): number[][] {
  const n = chords.length;
  const leading = (key.tonic + 11) % 12;
  interface Opt { a: number; t: number; own: number }
  const options: Opt[][] = [];
  for (let i = 0; i < n; i++) {
    const c = chords[i];
    const pcs = chordPcs(c);
    const roles = chordRoles(c);
    const s = sop[i] ?? 67;
    const b = bass[i].midi;
    const aList: number[] = [], tList: number[] = [];
    for (let m = 50; m <= 74; m++) if (pcs.includes(pcOf(m)) && m <= s) aList.push(m);
    for (let m = 46; m <= 67; m++) if (pcs.includes(pcOf(m))) tList.push(m);
    const need = [roles.root, roles.third, ...(roles.seventh !== null ? [roles.seventh] : [])].filter((x): x is number => x !== null);
    const opts: Opt[] = [];
    for (const a of aList) for (const t of tList) {
      if (t > a || a > s || t < b + 1 || s - a > 12 || a - t > 12) continue;
      const set = [pcOf(s), pcOf(a), pcOf(t), pcOf(b)];
      let own = 0;
      for (const p of need) if (!set.includes(p)) own += 40;
      if (roles.fifth !== null && !set.includes(roles.fifth)) own += hasSeventh(c.quality) ? 0.5 : 2.5;
      const count = (p: number) => set.filter((x) => x === p).length;
      if (count(leading) > 1 && pcs.includes(leading)) own += 50;
      if (bass[i].role === 0 && !hasSeventh(c.quality) && count(roles.root) < 2) own += 3;
      if (roles.third !== null && count(roles.third) > 1) own += 0.6;
      if (roles.fifth !== null && count(roles.fifth) > 1) own += 0.3;
      if (a === t) own += 0.5;
      opts.push({ a, t, own });
    }
    if (!opts.length) opts.push({ a: Math.min(s, 62), t: Math.min(s - 5, 55), own: 200 });
    options.push(opts);
  }
  const cost: number[][] = [], back: number[][] = [];
  for (let i = 0; i < n; i++) {
    cost[i] = []; back[i] = [];
    options[i].forEach((o, j) => {
      if (i === 0) { cost[i][j] = o.own; back[i][j] = 0; return; }
      let best = Infinity, arg = 0;
      const prevC = chords[i - 1];
      const prevSev = chordRoles(prevC).seventh;
      options[i - 1].forEach((p, k) => {
        let c = cost[i - 1][k] + o.own + 0.15 * (Math.abs(o.a - p.a) + Math.abs(o.t - p.t));
        if (prevSev !== null) {
          const curPcs = chordPcs(chords[i]);
          if (pcOf(p.a) === prevSev && !(o.a === p.a && curPcs.includes(prevSev)) && !(p.a - o.a >= 1 && p.a - o.a <= 2)) c += 6;
          if (pcOf(p.t) === prevSev && !(o.t === p.t && curPcs.includes(prevSev)) && !(p.t - o.t >= 1 && p.t - o.t <= 2)) c += 6;
        }
        // parallels in inner pairs
        if (parallelPerfect(p.a, p.t, o.a, o.t)) c += 2;
        if (sop[i] !== null && sop[i - 1] !== null) {
          if (parallelPerfect(sop[i - 1]!, p.a, sop[i]!, o.a)) c += 2;
          if (parallelPerfect(sop[i - 1]!, p.t, sop[i]!, o.t)) c += 2;
        }
        if (parallelPerfect(p.t, bass[i - 1].midi, o.t, bass[i].midi)) c += 2;
        if (c < best) { best = c; arg = k; }
      });
      cost[i][j] = best; back[i][j] = arg;
    });
  }
  const res: number[][] = new Array(n);
  let j = 0;
  for (let k = 1; k < cost[n - 1].length; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  for (let i = n - 1; i >= 0; i--) {
    const o = options[i][j];
    res[i] = [o.t, o.a, sop[i] ?? o.a + 4];
    j = back[i][j];
  }
  return res;
}
