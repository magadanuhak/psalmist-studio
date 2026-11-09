/** Musical-relevance rule for the "answers" and the intro hook: they must be recognizable echoes of material the listener already heard
 *  (the last sung phrase, the refren), never free lines. Pure functions; the arrangement adapter uses them in place of the free generator. */
import { scalePcs } from '../../music/theory';
import type { KeySig } from '../../model/types';
import type { ArrNote, ArrVocalNote } from './types';

/** share of matching up / down / same steps between two note lists (compared over the shorter one) */
export function contourSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length) - 1;
  if (n < 1) return a.length === b.length ? 1 : 0;
  let ok = 0;
  for (let i = 0; i < n; i++) if (Math.sign(a[i + 1] - a[i]) === Math.sign(b[i + 1] - b[i])) ok++;
  return ok / n;
}

/** share of equal intervals (semitones) between two note lists */
export function intervalMatch(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length) - 1;
  if (n < 1) return 0;
  let ok = 0;
  for (let i = 0; i < n; i++) if (a[i + 1] - a[i] === b[i + 1] - b[i]) ok++;
  return ok / n;
}

const snapToScale = (midi: number, pcs: Set<number>): number => {
  for (const d of [0, 1, -1, 2, -2]) if (pcs.has((((midi + d) % 12) + 12) % 12)) return midi + d;
  return midi;
};

export interface EchoOptions { key: KeySig; barSec: number; beatSec: number; vocalHi: number; level: number }

/** phrase ends: a pause of at least one full bar after singing. Returns { phrase, pauseStart, pauseDur } for each. */
export function phraseEnds(vocal: ArrVocalNote[], barSec: number): { phrase: ArrVocalNote[]; pauseStart: number; pauseDur: number }[] {
  const v = [...vocal].sort((a, b) => a.startSec - b.startSec);
  const out: { phrase: ArrVocalNote[]; pauseStart: number; pauseDur: number }[] = [];
  let cur: ArrVocalNote[] = [];
  for (let i = 0; i < v.length; i++) {
    cur.push(v[i]);
    const end = v[i].startSec + v[i].durSec, nx = v[i + 1];
    const gap = nx ? nx.startSec - end : Infinity;
    if (gap >= barSec * 0.99) { if (nx) out.push({ phrase: cur, pauseStart: end, pauseDur: gap }); cur = []; }
  }
  return out;
}

/**
 * Echoes: at most one per phrase pair (the first pause of each pair), only in a pause of >= 1 bar, only at a phrase end. The echo repeats the last
 * (up to 5) notes of the phrase just sung - same contour, same rhythm - an octave above the voice, snapped to the key, softer (-4 dB), gentle attack.
 */
export function buildEchoes(vocal: ArrVocalNote[], o: EchoOptions): { notes: ArrNote[]; sources: number[][] } {
  const pcs = scalePcs(o.key);
  const notes: ArrNote[] = [], sources: number[][] = [];
  phraseEnds(vocal, o.barSec).forEach((pe, i) => {
    if (i % 2 === 1) return;
    const src = pe.phrase.slice(-5);
    if (src.length < 3) return;
    const t0 = pe.pauseStart + o.beatSec * 0.5, room = pe.pauseDur - o.beatSec * 1.5; // leave the pause's end free for the voice
    const shift = 12 * Math.max(0, Math.ceil((o.vocalHi - 4 - Math.min(...src.map((n) => n.midi))) / 12));
    const used: number[] = [];
    for (const n of src) {
      const rel = n.startSec - src[0].startSec;
      if (rel + n.durSec > room) break;
      const m = snapToScale(n.midi + shift, pcs);
      notes.push({ midi: m, startSec: t0 + rel, durSec: Math.max(0.2, n.durSec * 0.95), vel: Math.min(0.8, 0.5 * o.level), atk: 0.08 });
      used.push(n.midi);
    }
    if (used.length >= 3) sources.push(used); else notes.splice(notes.length - used.length, used.length);
  });
  return { notes, sources };
}

/** Intro hook as a quote of the refren: its first phrase (up to 6 notes), same intervals and rhythm, placed to end on the intro's last bar. */
export function quoteHook(refren: ArrVocalNote[], intro: { startSec: number; durSec: number }, barSec: number, shift: number, level: number): ArrNote[] {
  const all = [...refren].sort((a, b) => a.startSec - b.startSec).slice(0, 6);
  let cut = all.length; // a leap over an octave in the source is a pitch-tracker artefact, not a melody: quote only up to it
  for (let i = 1; i < all.length; i++) if (Math.abs(all[i].midi - all[i - 1].midi) > 12) { cut = i; break; }
  const src = all.slice(0, cut);
  if (src.length < 3) return [];
  const span = src[src.length - 1].startSec + src[src.length - 1].durSec - src[0].startSec;
  const start = intro.startSec + Math.max(0, intro.durSec - span - barSec * 0.25);
  return src.map((n) => ({ midi: n.midi + shift, startSec: start + (n.startSec - src[0].startSec), durSec: Math.max(0.25, n.durSec * 0.95), vel: Math.min(0.8, 0.55 * level), atk: 0.06 }));
}
