/** "Construiește din vocea completă": from the notes of ONE full-song vocal find the instrumental gaps, the vocal blocks and the
 *  strofă / refren split (melodic self-similarity), and lay the form on a bar grid of the ORIGINAL timeline. Pure TypeScript. */
import type { OnsetIn } from './meter';

export type FormType = 'intro' | 'strofa' | 'refren' | 'bridge' | 'interlude' | 'outro';
export interface FormSection {
  type: FormType;
  startBar: number;
  bars: number;
  /** seconds on the original timeline */
  startSec: number;
  endSec: number;
  /** false for instrumental sections (intro, interlude / bridge, outro) */
  vocal: boolean;
}
export interface FormResult {
  /** time of bar 0 (a bar line of the original) */
  t0: number;
  barSec: number;
  sections: FormSection[];
  blocks: { startSec: number; endSec: number }[];
}

const DT = 0.05;

/** notes of the first sustained vocal block (at least 12 s of singing): the source for tempo and meter */
export function mainBlockNotes(notes: OnsetIn[], gapSec = 3.2): OnsetIn[] {
  const ns = denseNotes(notes);
  let start = 0;
  for (let i = 1; i <= ns.length; i++) {
    if (i === ns.length || ns[i].startSec - (ns[i - 1].startSec + ns[i - 1].durSec) > gapSec) {
      if (ns[i - 1].startSec + ns[i - 1].durSec - ns[start].startSec >= 12) return ns.slice(start, i);
      start = i;
    }
  }
  return ns;
}

/** drop isolated notes (bleed, breaths, stray pitch-tracker hits): a sung note has neighbours; slow songs (long notes) have fewer of them per second, so the window is 4 s and 3 neighbours */
export function denseNotes(notes: OnsetIn[]): OnsetIn[] {
  const ns = [...notes].sort((a, b) => a.startSec - b.startSec);
  return ns.filter((n, i) => {
    let c = 0;
    for (let j = i - 1; j >= 0 && n.startSec - ns[j].startSec <= 4; j--) c++;
    for (let j = i + 1; j < ns.length && ns[j].startSec - n.startSec <= 4; j++) c++;
    return c >= 3;
  });
}

/** pitch contour per frame (NaN = silence) between two times */
function contour(notes: OnsetIn[], from: number, to: number): Float32Array {
  const n = Math.max(1, Math.round((to - from) / DT));
  const f = new Float32Array(n).fill(NaN);
  for (const x of notes) {
    const a = Math.max(0, Math.floor((x.startSec - from) / DT)), b = Math.min(n, Math.max(a + 1, Math.floor((x.startSec + x.durSec - from) / DT)));
    for (let i = a; i < b; i++) f[i] = x.midi;
  }
  return f;
}

/** similarity of two equally long contours: share of voiced frames that sing the same pitch (+-1 semitone) */
function similarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let hit = 0, vo = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i]) && Number.isNaN(b[i])) continue;
    vo++;
    if (!Number.isNaN(a[i]) && !Number.isNaN(b[i]) && Math.abs(a[i] - b[i]) <= 1) hit++;
  }
  return vo > 8 ? hit / vo : 0;
}

/**
 * @param notes   every sung note of the vocal (original timeline)
 * @param barSec  bar length from the tempo / meter
 * @param t0      a bar line of the original (the first stressed note)
 * @param totalSec length of the recording
 * @param phraseBars bars of a sung phrase (4 by default)
 */
export function formFromVocal(notes: OnsetIn[], barSec: number, t0: number, totalSec: number, phraseBars = 4): FormResult | null {
  const ns = denseNotes(notes.filter((n) => n.durSec >= 0.08));
  if (ns.length < 12) return null;
  // vocal blocks: separated by silences of at least 3/4 of a bar (and 2 s)
  const gapMin = Math.max(2.0, 0.75 * barSec);
  const blocks: { startSec: number; endSec: number }[] = [];
  let cur = { startSec: ns[0].startSec, endSec: ns[0].startSec + ns[0].durSec };
  for (let i = 1; i < ns.length; i++) {
    const n = ns[i];
    if (n.startSec - cur.endSec >= gapMin) { blocks.push(cur); cur = { startSec: n.startSec, endSec: n.startSec + n.durSec }; }
    else cur.endSec = Math.max(cur.endSec, n.startSec + n.durSec);
  }
  blocks.push(cur);
  // a few stray seconds of bleed are not a vocal block
  for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].endSec - blocks[i].startSec < 6) blocks.splice(i, 1);
  if (!blocks.length) return null;

  const barAt = (t: number) => (t - t0) / barSec;
  // a block starts on the bar line at or just after its first note when that note is a pickup (within 0.4 bar before the line)
  const startBarOf = (t: number) => { const b = barAt(t); const r = Math.round(b); return b - Math.floor(b) > 0.6 && r - b < 0.4 ? r : Math.floor(b + 0.02); };
  const endBarOf = (t: number) => Math.ceil(barAt(t) - 0.12);

  // phrases of every block (phraseBars long, from the block's first bar line); the last one may be shorter
  interface Ph { block: number; bar: number; bars: number; c: Float32Array; label?: 'S' | 'R' }
  const phrases: Ph[] = [];
  const bl = blocks.map((b, bi) => ({ ...b, sb: startBarOf(b.startSec), eb: Math.max(startBarOf(b.startSec) + 1, endBarOf(b.endSec)), bi }));
  for (const b of bl) {
    for (let bar = b.sb; bar < b.eb; bar += phraseBars) {
      const bars = Math.min(phraseBars, b.eb - bar);
      phrases.push({ block: b.bi, bar, bars, c: contour(ns, t0 + bar * barSec, t0 + (bar + phraseBars) * barSec) });
    }
  }
  // first block: strofă = the leading phrases similar to its first phrase, the rest is refren
  const first = phrases.filter((p) => p.block === 0);
  // strofă = the leading phrases that still resemble the first one (a strofă is a phrase and its answer); the melody then turns to new material
  let k = 1;
  if (first.length >= 2) {
    const s0 = first.slice(1).map((p) => similarity(first[0].c, p.c));
    const top = Math.max(...s0);
    while (k < Math.min(2, first.length) && s0[k - 1] >= 0.75 * top && s0[k - 1] >= 0.2) k++; // a strofă is a phrase and its answer: at most two
    if (k === first.length) k = first.length - 1;
  }
  first.forEach((p, i) => { p.label = i < k ? 'S' : 'R'; });
  const sRef = first.filter((p) => p.label === 'S'), rRef = first.filter((p) => p.label === 'R');
  // other blocks: every phrase goes to the class (strofă / refren) it resembles most
  for (const p of phrases) {
    if (p.label) continue;
    const s = Math.max(0, ...sRef.map((q) => similarity(p.c, q.c))), r = Math.max(0, ...rRef.map((q) => similarity(p.c, q.c)));
    p.label = r > s ? 'R' : 'S';
  }

  const sections: FormSection[] = [];
  const push = (type: FormType, startBar: number, bars: number, vocal: boolean) => {
    if (bars <= 0) return;
    sections.push({ type, startBar, bars, startSec: t0 + startBar * barSec, endSec: t0 + (startBar + bars) * barSec, vocal });
  };
  const totalBars = Math.max(1, Math.ceil(barAt(totalSec) - 0.2));
  const firstBar = bl[0].sb;
  if (firstBar > 0) push('intro', 0, firstBar, false);
  bl.forEach((b, bi) => {
    const ps = phrases.filter((p) => p.block === b.bi);
    let i = 0;
    while (i < ps.length) {
      let j = i;
      while (j + 1 < ps.length && ps[j + 1].label === ps[i].label) j++;
      const sb = ps[i].bar, eb = j === ps.length - 1 ? b.eb : ps[j].bar + ps[j].bars;
      push(ps[i].label === 'S' ? 'strofa' : 'refren', sb, eb - sb, true);
      i = j + 1;
    }
    const nextStart = bi + 1 < bl.length ? bl[bi + 1].sb : null;
    // a one-bar gap is an interlude (turnaround), a longer one a bridge
    if (nextStart !== null) push(nextStart - b.eb === 1 ? 'interlude' : 'bridge', b.eb, nextStart - b.eb, false);
  });
  const lastEnd = bl[bl.length - 1].eb;
  if (totalBars > lastEnd) push('outro', lastEnd, totalBars - lastEnd, false);
  return { t0, barSec, sections, blocks };
}

/** Metric strength of the beats of a bar (first = downbeat). */
const BEAT_PRIOR: Record<number, number[]> = { 2: [1, 0.45], 3: [1, 0.4, 0.4], 4: [1, 0.4, 0.7, 0.4], 6: [1, 0.3, 0.3, 0.6, 0.3, 0.3] };

/**
 * ONE global bar grid (period and phase) fitted to the whole vocal.
 * 1. period and beat phase: weighted circular statistics of every onset on the beat grid (searched around the tempo guess);
 * 2. which beat is the downbeat: phrase starts, block starts and long notes vote with a metric prior (entries may fall on any beat).
 * Returns the bar length and `t0`, a bar line of the original (0 <= t0 < barSec).
 */
export function fitBarGrid(notes: OnsetIn[], barSecGuess: number, beats = 4, searchPct = 0.04): { barSec: number; t0: number; beatSec: number } | null {
  const ns = denseNotes(notes.filter((n) => n.durSec >= 0.08));
  if (ns.length < 12) return null;
  const prior = BEAT_PRIOR[beats] ?? new Array(beats).fill(0.5).map((v, i) => (i === 0 ? 1 : v));
  const w = ns.map((n) => 0.5 + Math.min(1.5, n.durSec / 0.6));
  // long-range period: block / phrase starts of a whole song are whole bars apart, which pins the period to a few milliseconds
  let guess = barSecGuess;
  const starts: number[] = [];
  ns.forEach((n, i) => {
    const gap = i ? n.startSec - (ns[i - 1].startSec + ns[i - 1].durSec) : 9;
    if (gap >= 2.0) { starts.push(n.startSec); if (i) starts.push(ns[i - 1].startSec + ns[i - 1].durSec); }
  });
  const span = starts.length ? starts[starts.length - 1] - starts[0] : 0;
  if (starts.length >= 5 && span > 12 * barSecGuess) {
    let bp = -1;
    for (let k = 0; k <= 400; k++) {
      const bar = barSecGuess * (1 - 0.06 + (0.12 * k) / 400);
      let c = 0, sn = 0;
      for (const t of starts) { const a2 = (2 * Math.PI * t) / bar; c += Math.cos(a2); sn += Math.sin(a2); }
      const R = Math.hypot(c, sn) / starts.length;
      if (R > bp) { bp = R; guess = bar; }
    }
  }
  let best = { R: -1, bar: guess, phase: 0 };
  const steps = 160;
  for (let s = 0; s <= steps; s++) {
    const bar = guess * (1 - (guess === barSecGuess ? searchPct : 0.004) + (2 * (guess === barSecGuess ? searchPct : 0.004) * s) / steps);
    const b = bar / beats;
    let c = 0, sn = 0, tw = 0;
    ns.forEach((n, i) => { const a = (2 * Math.PI * n.startSec) / b; c += w[i] * Math.cos(a); sn += w[i] * Math.sin(a); tw += w[i]; });
    const R = Math.hypot(c, sn) / tw;
    if (R > best.R) best = { R, bar, phase: ((Math.atan2(sn, c) / (2 * Math.PI)) * b + b) % b };
  }
  const bar = best.bar, b = bar / beats, ph = best.phase;
  // anchors: block / phrase starts (after a breath) and long notes
  const anchors: { t: number; w: number }[] = [];
  ns.forEach((n, i) => {
    const gap = i ? n.startSec - (ns[i - 1].startSec + ns[i - 1].durSec) : 9;
    if (gap >= 2.0) anchors.push({ t: n.startSec, w: 2.5 });
    else if (gap >= 0.45) anchors.push({ t: n.startSec, w: 1 });
    if (n.durSec >= 0.8 * b) anchors.push({ t: n.startSec, w: 0.6 + Math.min(1, n.durSec / bar) });
  });
  let bj = 0, bs = -Infinity;
  for (let j = 0; j < beats; j++) {
    let sc = 0;
    for (const a of anchors) {
      const pos = (((a.t - ph) / b - j) % beats + beats) % beats; // beats after the candidate downbeat
      const k = Math.round(pos);
      const off = Math.abs(pos - k);
      if (off > 0.22) continue;
      sc += a.w * prior[k % beats];
    }
    if (sc > bs) { bs = sc; bj = j; }
  }
  return { barSec: bar, beatSec: b, t0: (ph + bj * b) % bar };
}
