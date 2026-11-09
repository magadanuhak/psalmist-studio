import type { Emotion, Genre, KeySig, Note, SectionType, TimeSig } from '../../model/types';
import { EMOTION_BIAS, GENRE_BIAS, LOOPS, STYLE_PRIORS } from './bias';
import { candFromChord, candidatePool, chordPcs, chordRoles, type Cand } from './chords';
import { buildSlots, metricWeight, resolveRate } from './rhythm';
import type { BeatMap } from './beatmap';
import { chordKey, type CadenceKind, type Chord, type HarmonicRate, type HarmonySlot, type Simplicity, type VariantId, VARIANTS } from './types';

export interface HarmonizeInput {
  notes: Note[];
  key: KeySig;
  bpm: number;
  sig: TimeSig;
  bars: number;
  genre: Genre;
  emotion: Emotion;
  sectionType: SectionType;
  nextType: SectionType | null;
  isLastSection: boolean;
  rate?: HarmonicRate;
  /** undefined keeps the classic behaviour (auto rate, full vocabulary) */
  simplicity?: Simplicity;
  locks?: Partial<Record<VariantId, Record<number, Chord>>>;
  /** the singer's actual beat times (tracked from vocal onsets); linear grid when absent */
  beatMap?: BeatMap;
}

export interface HarmonizeResult { slots: HarmonySlot[]; variants: Record<VariantId, Chord[]> }

export type SlotRole = { end?: CadenceKind; pre?: CadenceKind | 'any'; /** a phrase end that is not the end of the section */ mid?: boolean };

function isPassing(notes: { midi: number; startSec: number; durSec: number }[], n: { midi: number; startSec: number; durSec: number }, fbeat: number): boolean {
  if (n.durSec > 1.05 * fbeat) return false;
  let prev: typeof n | undefined, next: typeof n | undefined;
  for (const x of notes) { if (x.startSec < n.startSec - 1e-6) prev = x; else if (x.startSec > n.startSec + 1e-6) { next = x; break; } }
  if (!prev || !next || n.startSec - (prev.startSec + prev.durSec) > 0.25 * fbeat || next.startSec - (n.startSec + n.durSec) > 0.25 * fbeat) return false;
  const a = n.midi - prev.midi, b = next.midi - n.midi;
  return a !== 0 && b !== 0 && Math.abs(a) <= 2 && Math.abs(b) <= 2;
}

interface Sample { pc: number | null; w: number; held: boolean; strong: boolean; long: boolean; /** sung for at least one beat */ beat1: boolean; /** a stepwise passing / neighbour tone shorter than about a beat */ pass: boolean }

export interface Ctx {
  inp: HarmonizeInput;
  slots: HarmonySlot[];
  samples: Sample[][];
  slotPcs: Set<number>[];
  roles: SlotRole[];
  pool: Cand[];
}

const degKey = (roman: string) => (roman.includes('/') ? roman : roman.replace(/(maj7|sus2|sus4|add9|ø7|7)$/, ''));

export function makeCtx(inp: HarmonizeInput): Ctx {
  const rate = resolveRate(inp.rate, inp.genre, inp.sig, inp.bpm);
  const bm = inp.beatMap;
  const slots = buildSlots({ bars: inp.bars, bpm: inp.bpm, sig: inp.sig, rate, notes: inp.notes, bm });
  const compound = inp.sig.den === 8 && inp.sig.num >= 12 && inp.sig.grouping.every((g) => g === 3);
  const beat = 60 / inp.bpm;
  const fbeat = compound ? beat * 3 : beat; // the felt beat (dotted quarter in 12/8): duration weights are measured against it
  const notes = [...inp.notes].sort((a, b) => a.startSec - b.startSec);
  const samples: Sample[][] = slots.map((s) => {
    const out: Sample[] = [];
    // 16 samples per bar whatever the meter: in 12/8 the felt beat is three eighths, so the sample step is 0.75 eighth (keeps the evidence / prior balance of 4/4)
    const step = compound ? 0.75 : 0.25;
    for (let t = s.startBeat; t < s.startBeat + s.beats - 1e-6; t += step) {
      const sec = bm ? bm.timeOfBeat(t) : t * beat;
      const bar = Math.floor(t / inp.sig.num + 1e-6);
      const w = metricWeight(t - bar * inp.sig.num, inp.sig);
      const n = notes.find((x) => x.startSec - 0.12 * fbeat <= sec && sec < x.startSec + x.durSec - 1e-6);
      // brief notes (scoops, grace notes) count less than sustained ones
      const dw = n ? Math.min(1, n.durSec / (0.75 * fbeat)) : 1;
      out.push({ pc: n ? ((n.midi % 12) + 12) % 12 : null, w: w * dw * 0.5, held: !!n && n.durSec >= 0.25, strong: w >= 0.6, long: !!n && n.durSec >= 0.6, beat1: !!n && n.durSec >= 0.95 * fbeat, pass: !!n && isPassing(notes, n, fbeat) });
    }
    return out;
  });
  const slotPcs = samples.map((ss) => new Set(ss.filter((x) => x.pc !== null).map((x) => x.pc as number)));
  // cadence roles
  const roles: SlotRole[] = slots.map(() => ({}));
  const lastIdx = slots.length - 1;
  const emo = EMOTION_BIAS[inp.emotion];
  slots.forEach((s, i) => {
    if (!(s.phraseEnd || i === lastIdx)) return;
    const final = i === lastIdx;
    // Simplu / minor: only a 4-bar boundary is a cadence; a pause after 2 bars is just a breath inside an i IV | i V unit
    if (!final && relaxedCadences(inp) && (s.bar + 1) % 4 !== 0) return;
    let kind: CadenceKind = 'authentic';
    if (final && (inp.sectionType === 'strofa' || inp.sectionType === 'prerefren') && inp.nextType === 'refren') kind = 'half';
    else if (!final && emo.deceptive >= 0.4) kind = 'deceptive';
    roles[i].end = kind;
    if (!final) roles[i].mid = true;
    if (i > 0 && !(slots[i - 1].phraseEnd) && kind !== 'half') roles[i - 1].pre = kind;
  });
  return { inp, slots, samples, slotPcs, roles, pool: candidatePool(inp.key) };
}

const TONIC_Q_MAJOR = ['maj', 'maj7', 'add9'];
const TONIC_Q_MINOR = ['min', 'min7'];

/** Simplu in a minor key, sung genres: 2-bar answer units (i IV | i V) are normal, so the bar before a phrase end is free and a middle phrase may end on V */
const relaxedCadences = (inp: HarmonizeInput) => inp.simplicity === 'simplu' && inp.genre !== 'imn';

const isNatural = (inp: HarmonizeInput) => inp.key.mode === 'minor' && !GENRE_BIAS[inp.genre].harmonicMinor && inp.simplicity !== 'simplu';

/** Simplu vocabulary (variant A): i, iv, V(7) in minor; I, IV, V in major. Returns 0 core, 1 colour (VI / III, vi), -1 outside. */
function simpleClass(c: Cand, key: KeySig): number {
  const q = c.chord.quality;
  // Simplu = fewer CHANGES, not fewer chord types: every diatonic triad (natural + harmonic minor, no ii° / vii°), no 7ths, borrowed or secondary chords
  if (c.kind === 'secondary' || (q !== 'maj' && q !== 'min')) return -1;
  if (key.mode === 'minor') {
    if (c.rel === 5 && q === 'maj') return 1; // major IV: Dorian / melodic-minor colour of the sung genres
    if (c.kind === 'borrowed') return -1;
    if (c.rel === 0 || c.rel === 5 || c.rel === 7) return 0;
    if (c.rel === 3 || c.rel === 8 || c.rel === 10) return q === 'maj' ? 1 : -1;
    return -1;
  }
  if (c.rel === 0 || c.rel === 5 || c.rel === 7) return q === 'maj' ? 0 : -1;
  if ((c.rel === 2 || c.rel === 4 || c.rel === 9) && q === 'min') return 1;
  return -1;
}

function cadenceAllows(c: Cand, role: SlotRole, key: KeySig, plagalOk: boolean, variant: VariantId, natural = false, relaxPre = false): boolean {
  const q = c.chord.quality;
  if (role.end) {
    if (role.end === 'half') return (c.rel === 7 && (q === 'maj' || q === 'dom7' || (natural && q === 'min'))) || (natural && c.rel === 10 && q === 'maj') || (relaxPre && c.rel === 0 && q === 'min');
    const tonicQs = key.mode === 'major' ? TONIC_Q_MAJOR : TONIC_Q_MINOR;
    const tonic = c.rel === 0 && tonicQs.includes(q) && c.kind !== 'secondary' && (variant !== 'A' || q === 'maj' || q === 'min');
    if (role.end === 'deceptive') {
      const dec = key.mode === 'major' ? c.rel === 9 && (q === 'min' || q === 'min7') : c.rel === 8 && (q === 'maj' || q === 'maj7');
      return tonic || dec;
    }
    // modern sung genres: a phrase that is not the last answers on the dominant (antecedent) as often as on the tonic
    if (relaxPre && role.mid && c.rel === 7 && (q === 'maj' || q === 'dom7') && c.kind !== 'secondary') return true;
    return tonic || (natural && variant !== 'C' && q === 'maj' && (c.rel === 10 || c.rel === 8));
  }
  if (role.pre) {
    if (c.kind === 'secondary') return false;
    if (natural || relaxPre) return true; // modern sung genres: the bar before a phrase end is free (a soft V / IV bonus in `unary`)
    const dom = c.rel === 7 && (q === 'maj' || q === 'dom7') || c.rel === 11 && (q === 'dim' || q === 'hdim7' || q === 'dim7');
    const plagal = plagalOk && c.rel === 5 && (key.mode === 'major' ? q === 'maj' : q === 'min');
    const modal = natural && ((c.rel === 7 && q === 'min') || (c.rel === 10 && q === 'maj') || (c.rel === 8 && q === 'maj') || (c.rel === 5 && q === 'min'));
    return dom || plagal || modal;
  }
  return true;
}

function inVariant(c: Cand, v: VariantId, genre: Genre, natural = false): boolean {
  const g = GENRE_BIAS[genre];
  // modern genres in a minor key use natural minor: the harmonic-minor V (F#7 in B minor) is variant-C colour only
  if (natural && v !== 'C' && c.rel === 7 && c.chord.quality !== 'min') return false;
  if (v === 'A') return c.tier === 'A' && c.kind === 'diatonic' && !(c.rel === 11 || c.chord.quality === 'dim');
  if (v === 'B') {
    if (c.tier === 'C') return false;
    if (c.kind === 'colour') return g.colour;
    if (c.kind === 'borrowed') return g.borrowed;
    if (c.kind === 'seventh') return false; // 7ths and secondary dominants live in variant C only
    return true;
  }
  return !(c.rel === 11 && c.chord.quality === 'dim' && false);
}

export function unary(ctx: Ctx, v: VariantId, c: Cand, i: number): number {
  const { inp } = ctx;
  const g = GENRE_BIAS[inp.genre], e = EMOTION_BIAS[inp.emotion];
  const dk = degKey(c.chord.roman);
  let s = 0;
  s += (g.degree[dk] ?? g.degree[c.chord.roman] ?? 0) + (e.degree[dk] ?? e.degree[c.chord.roman] ?? 0);
  s += (g.quality[c.chord.quality] ?? 0) + (e.quality[c.chord.quality] ?? 0);
  if (isNatural(inp)) {
    if (c.rel === 7) s += c.chord.quality === 'min' ? 0.4 : -0.9;
    if (c.rel === 10 && c.chord.quality === 'maj') s += 0.5;
    if (c.rel === 8 && c.chord.quality === 'maj') s += 0.4;
  }
  if (inp.key.mode === 'minor' && g.harmonicMinor && c.rel === 7 && c.chord.quality === 'min') s -= 0.3;
  if (c.rel === 0 && c.kind !== 'secondary') s += 0.12;
  if (inp.simplicity === 'simplu' && v === 'A') {
    if (simpleClass(c, inp.key) === 1) s -= 0.2;
  }
  const sp = inp.simplicity !== undefined && inp.key.mode === 'minor' ? STYLE_PRIORS[inp.genre] : undefined;
  if (sp && (!sp.simpluOnly || inp.simplicity === 'simplu')) {
    const flat6 = ctx.slotPcs[i].has((inp.key.tonic + 8) % 12);
    if (c.rel === 5 && c.chord.quality === 'maj') s += flat6 ? -0.8 : sp.majorIV;
    if (c.rel === 5 && c.chord.quality === 'min' && !flat6) s -= 0.15;
    if (i === 0 && inp.sectionType === 'refren' && c.chord.quality !== 'dom7') s += sp.refrenOpen[c.rel] ?? 0;
  }
  if (v === 'C') s += c.kind === 'seventh' ? 0.3 : c.kind === 'secondary' ? 0.15 : c.kind === 'borrowed' ? 0.1 : 0;
  if (c.kind === 'secondary') s -= 0.25;
  if (c.kind === 'colour') s -= 0.05;
  if (i === 0) {
    const st = inp.sectionType === 'refren' ? g.start.refren : g.start.strofa;
    s += st[dk] ?? 0;
    if (c.rel !== 0 && c.rel !== 9 && c.rel !== 5 && c.rel !== 8) s -= 0.3;
  }
  if (c.chord.quality === 'dim' && !(inp.genre === 'imn')) s -= 0.4;
  if (ctx.roles[i].pre && relaxedCadences(inp) && inp.key.mode === 'minor' && (c.rel === 7 || c.rel === 5) && c.kind !== 'secondary') s += 0.25;
  return s;
}

/**
 * Tie-breaking rules for simple major-key hymn styles (small, so they only decide between chords that cover the melody about equally):
 * (a) the chord holds the note on the first beat and the note on the middle of the bar;
 * (b) the melodic contour: a bar that descends stepwise to degree 2 (5-4-3-2, 3-2-2) wants V, a bar that arrives on degree 1 (2-1, 7-1) wants I.
 */
function tieBreak(ctx: Ctx, c: Cand, pcs: number[], i: number): number {
  const inp = ctx.inp;
  if (inp.key.mode !== 'major' || inp.simplicity !== 'simplu') return 0;
  const sm = ctx.samples[i];
  let s = 0;
  const first = sm[0]?.pc, mid = sm[Math.floor(sm.length / 2)]?.pc;
  if (first !== null && first !== undefined && pcs.includes(first)) s += 0.35;
  if (mid !== null && mid !== undefined && pcs.includes(mid)) s += 0.25;
  const seq: number[] = [];
  for (const x of sm) if (x.pc !== null && seq[seq.length - 1] !== x.pc) seq.push(x.pc);
  if (seq.length >= 2) {
    const rel = (p: number) => (((p - inp.key.tonic) % 12) + 12) % 12;
    const last = rel(seq[seq.length - 1]), prev = rel(seq[seq.length - 2]);
    const down = (((prev - last) % 12) + 12) % 12;
    if (last === 2 && down >= 1 && down <= 2) { if (c.rel === 7 && (c.chord.quality === 'maj' || c.chord.quality === 'dom7')) s += 0.7; else if (c.rel === 0) s -= 0.3; }
    else if (last === 0 && (prev === 2 || prev === 11 || prev === 1)) { if (c.rel === 0 && c.kind !== 'secondary') s += 0.5; }
  }
  return s * 1.5;
}

export function emission(ctx: Ctx, c: Cand, i: number): number {
  const roles = chordRoles(c.chord);
  const pcs = chordPcs(c.chord);
  let s = 0;
  s += tieBreak(ctx, c, pcs, i);
  for (const smp of ctx.samples[i]) {
    if (smp.pc === null) continue;
    const w = smp.w;
    // a chord tone a semitone away from a held sung note is a clash (b9 / maj7 against the voice)
    if (smp.held && !smp.pass && pcs.some((p) => p !== smp.pc && (((p - smp.pc!) % 12) + 12) % 12 !== 0 && (((p - smp.pc!) % 12 + 12) % 12 === 1 || ((p - smp.pc!) % 12 + 12) % 12 === 11))) s -= 4 * Math.max(w, 0.5);
    if (pcs.includes(smp.pc)) {
      const wt = smp.pc === roles.root || smp.pc === roles.third ? 1.0 : smp.pc === roles.fifth ? 0.85 : smp.pc === roles.seventh ? 0.8 : 0.7;
      s += w * wt;
    } else {
      const avoid = pcs.some((p) => (p + 1) % 12 === smp.pc) && smp.strong && smp.beat1 && !smp.pass; // only a held (>= 1 beat) note on a strong beat; passing / neighbour tones are free
      if (avoid) s -= 2.5 * w; // a passing quarter note over a chord tone a semitone below is normal in hymns (the clash guard keeps the voicing clean)
      else s -= w >= 0.6 ? 1.0 * w : 0.15;
    }
  }
  // suspended chords: never when the melody sings the replaced third or a semitone from the sus tone
  if (c.chord.quality === 'sus2' || c.chord.quality === 'sus4') {
    const sus = (c.chord.root + (c.chord.quality === 'sus2' ? 2 : 5)) % 12;
    const mel = ctx.slotPcs[i];
    const clash = mel.has((c.chord.root + 3) % 12) || mel.has((c.chord.root + 4) % 12) || mel.has((sus + 1) % 12) || mel.has((sus + 11) % 12);
    if (clash) s -= 8;
  }
  return s * 1.5;
}

export function transition(ctx: Ctx, p: Cand, c: Cand, i = 1): number {
  const g = GENRE_BIAS[ctx.inp.genre];
  let s = 0;
  const motion = (((c.rel - p.rel) % 12) + 12) % 12;
  s += ({ 5: 0.5, 7: 0.15, 2: 0.1, 10: 0.1, 9: 0.25, 3: 0.2, 4: 0.1, 8: 0.1, 1: -0.2, 11: -0.1, 6: -0.5, 0: 0 } as Record<number, number>)[motion] ?? 0;
  const pf = p.chord.func, cf = c.chord.func;
  const fm: Record<string, number> = { TS: 0.3, SD: 0.4, DT: 0.7, TD: 0.1, ST: 0.2, DS: -0.9, SS: 0.05, DD: 0, TT: 0 };
  s += fm[pf + cf] ?? 0;
  if (p.target !== undefined) s += c.rel === p.target ? 1.4 : -1.6;
  const simple = ctx.inp.simplicity === 'simplu';
  if (p.rel === c.rel && p.chord.quality === c.chord.quality) s -= simple ? -(1.0 + (c.rel === 0 && ctx.inp.key.mode === 'major' ? 0.5 : 0)) : 1.0; // Simplu holds a chord over 2 bars; a major-key hymn prolongs its tonic
  else if (p.rel === c.rel) s -= 0.5;
  const spf = ctx.inp.simplicity !== undefined && ctx.inp.key.mode === 'minor' ? STYLE_PRIORS[ctx.inp.genre] : undefined;
  if (spf && (!spf.simpluOnly || ctx.inp.simplicity === 'simplu')) for (const [a, b, w] of spf.flows) if (p.rel === a && c.rel === b) s += w;
  if (simple && !(p.rel === c.rel && p.chord.quality === c.chord.quality) && i % 2 === 1) s -= 0.8; // changes fall on even bars
  const a = degKey(p.chord.roman), b = degKey(c.chord.roman);
  if (g.bigrams.some(([x, y]) => x === a && y === b)) s += 0.4;
  // dominant must resolve: V -> tonic family strongly preferred when not repeating
  if (p.rel === 7 && c.rel === 0) s += 0.5;
  return s;
}

export function pickPool(ctx: Ctx, v: VariantId, i: number, locks: Record<number, Chord> | undefined): Cand[] {
  const lock = locks?.[i];
  if (lock) return [candFromChord(lock, ctx.inp.key)];
  const plagalOk = GENRE_BIAS[ctx.inp.genre].plagalAmen && i >= ctx.slots.length - 2;
  const simple = ctx.inp.simplicity === 'simplu' && v === 'A';
  const relaxPre = relaxedCadences(ctx.inp);
  let pool = ctx.pool.filter((c) => (simple ? simpleClass(c, ctx.inp.key) >= 0 : inVariant(c, v, ctx.inp.genre, isNatural(ctx.inp))) && cadenceAllows(c, ctx.roles[i], ctx.inp.key, plagalOk, v, isNatural(ctx.inp), relaxPre));
  if (!pool.length && simple) pool = ctx.pool.filter((c) => simpleClass(c, ctx.inp.key) >= 0 && cadenceAllows(c, ctx.roles[i], ctx.inp.key, plagalOk, 'A', isNatural(ctx.inp), relaxPre));
  if (!pool.length && simple) pool = ctx.pool.filter((c) => simpleClass(c, ctx.inp.key) >= 0);
  if (!pool.length) pool = ctx.pool.filter((c) => c.tier === 'A' && cadenceAllows(c, ctx.roles[i], ctx.inp.key, plagalOk, 'A', isNatural(ctx.inp), relaxPre));
  if (!pool.length) pool = ctx.pool.filter((c) => c.tier === 'A');
  return pool;
}

function viterbi(ctx: Ctx, v: VariantId, locks: Record<number, Chord> | undefined, avoid: Chord[][], penalty: number): Chord[] {
  const n = ctx.slots.length;
  const pools = ctx.slots.map((_, i) => pickPool(ctx, v, i, locks));
  const score: number[][] = [];
  const back: number[][] = [];
  for (let i = 0; i < n; i++) {
    score[i] = new Array(pools[i].length).fill(-1e9);
    back[i] = new Array(pools[i].length).fill(0);
    pools[i].forEach((c, j) => {
      let u = unary(ctx, v, c, i) + emission(ctx, c, i);
      for (const a of avoid) if (a[i] && chordKey(a[i]) === chordKey(c.chord) && !(locks?.[i])) u -= penalty;
      if (i === 0) { score[0][j] = u; return; }
      let best = -1e9, arg = 0;
      pools[i - 1].forEach((p, k) => {
        const val = score[i - 1][k] + transition(ctx, p, c, i);
        if (val > best) { best = val; arg = k; }
      });
      score[i][j] = best + u;
      back[i][j] = arg;
    });
  }
  let j = 0;
  const last = score[n - 1];
  for (let k = 1; k < last.length; k++) if (last[k] > last[j]) j = k;
  const out: Chord[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    out[i] = pools[i][j].chord;
    j = back[i][j];
  }
  return out;
}

export function variantDiff(a: Chord[], b: Chord[], skip?: Set<number>): number {
  let d = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (skip?.has(i)) continue;
    n++;
    if (chordKey(a[i]) !== chordKey(b[i])) d++;
  }
  return n ? d / n : 1;
}

const isSus = (q: string) => q === 'sus2' || q === 'sus4';

/** Suspended chords are colour, not a habit: at most 25% of the slots; the least useful ones become plain triads. */
function capSus(ctx: Ctx, v: VariantId, chords: Chord[], locks: Record<number, Chord> | undefined): Chord[] {
  const cap = Math.floor(0.25 * chords.length);
  const sus = chords.map((c, i) => ({ c, i })).filter((x) => isSus(x.c.quality) && !locks?.[x.i]);
  const total = chords.filter((c) => isSus(c.quality)).length;
  if (total <= cap) return chords;
  const out = [...chords];
  const losses = sus.map(({ c, i }) => {
    const cur = ctx.pool.find((x) => x.chord.root === c.root && x.chord.quality === c.quality);
    const repl = ctx.pool.find((x) => x.chord.root === c.root && (x.chord.quality === 'maj' || x.chord.quality === 'min') && x.kind === 'diatonic')
      ?? ctx.pool.find((x) => x.chord.root === c.root && (x.chord.quality === 'maj' || x.chord.quality === 'min'));
    if (!cur || !repl) return { i, loss: Infinity, repl: null as Cand | null };
    return { i, loss: unary(ctx, v, cur, i) + emission(ctx, cur, i) - (unary(ctx, v, repl, i) + emission(ctx, repl, i)), repl };
  }).filter((x) => x.repl).sort((a, b) => a.loss - b.loss);
  for (let k = 0; k < total - cap && k < losses.length; k++) out[losses[k].i] = losses[k].repl!.chord;
  return out;
}

/** Best loop template (repeated every 4 slots) that is allowed in every slot, with its score; null when none fits. */
function bestLoop(ctx: Ctx, v: VariantId, locks: Record<number, Chord> | undefined, free: Chord[]): Chord[] | null {
  if (v === 'C' || (ctx.inp.simplicity === 'simplu' && v === 'A')) return null;
  const set = LOOPS[ctx.inp.genre];
  const loops = ctx.inp.key.mode === 'major' ? set.major : set.minor;
  const n = ctx.slots.length;
  if (!loops.length || n < 4) return null;
  const pools = ctx.slots.map((_, i) => pickPool(ctx, v, i, locks));
  const perSlot = ctx.inp.key.mode === 'major' ? set.bonusMajor ?? set.bonus : set.bonus;
  let best: Chord[] | null = null, bs = scoreChords(ctx, v, free) + (free.every((c, i) => loops.some((l) => c.roman === l[i % 4])) ? perSlot * n : 0);
  for (const [li, loop] of loops.entries()) {
    const chords: Chord[] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const hit = pools[i].find((c) => c.chord.roman === loop[i % 4]);
      if (!hit || strongClash(ctx, hit.chord, i)) ok = false; else chords.push(hit.chord);
    }
    if (!ok) continue;
    const s = scoreChords(ctx, v, chords) + perSlot * n + (loops.length - li) * 1.5 + (ctx.inp.key.mode === 'minor' && set.topMinor && set.topMinor.loop.join() === loop.join() ? set.topMinor.bonus : 0);
    if (s > bs) { bs = s; best = chords; }
  }
  return best;
}

/** A chord tone a semitone from a held, strong-beat sung note. */
function strongClash(ctx: Ctx, c: Chord, i: number): boolean {
  const pcs = chordPcs(c);
  return ctx.samples[i].some((s) => s.pc !== null && s.long && s.strong && pcs.some((p) => { const d = (((p - s.pc!) % 12) + 12) % 12; return d === 1 || d === 11; }));
}

function scoreChords(ctx: Ctx, v: VariantId, chords: Chord[]): number {
  let s = 0;
  let prev: Cand | null = null;
  chords.forEach((c, i) => {
    const cand = candFromChord(c, ctx.inp.key);
    s += unary(ctx, v, cand, i) + emission(ctx, cand, i);
    if (prev) s += transition(ctx, prev, cand, i);
    prev = cand;
  });
  return s;
}

/** Harmonic rhythm is data driven: one chord per bar unless two per bar clearly fits the melody better (per-change penalty). */
export function pickRate(inp: HarmonizeInput): 0.5 | 1 | 2 {
  if (inp.sig.den !== 4 || (inp.sig.num !== 4 && inp.sig.num !== 2)) return 1;
  const margin = inp.genre === 'imn' ? 2 : inp.genre === 'cantare' || inp.genre === 'popular' ? 12 : 40;
  const score = (r: 1 | 2) => {
    const ctx = makeCtx({ ...inp, rate: r, locks: undefined });
    const chords = viterbi(ctx, 'A', undefined, [], 0);
    return scoreChords(ctx, 'A', chords) - 1.2 * (ctx.slots.length - inp.bars);
  };
  const s1 = score(1), s2 = score(2);
  return s2 > s1 + margin ? 2 : 1;
}

export function harmonize(inp0: HarmonizeInput): HarmonizeResult {
  const inp = inp0.rate === undefined || inp0.rate === 'auto'
    ? { ...inp0, rate: inp0.simplicity === 'simplu' || inp0.simplicity === 'normal' ? (1 as const) : pickRate(inp0) }
    : inp0;
  const ctx = makeCtx(inp);
  if (!ctx.slots.length) return { slots: [], variants: { A: [], B: [], C: [] } };
  const locks = inp.locks ?? {};
  const run = (v: VariantId, avoid: Chord[][], pen: number) => {
    const free = viterbi(ctx, v, locks[v], avoid, pen);
    const loop = avoid.length === 0 ? bestLoop(ctx, v, locks[v], free) : null;
    return capSus(ctx, v, loop ?? free, locks[v]);
  };
  const A = run('A', [], 0);
  let pen = 0.7;
  let B = A, C = A;
  const skip = new Set<number>();
  for (const v of VARIANTS) for (const k of Object.keys(locks[v] ?? {})) skip.add(Number(k));
  for (let it = 0; it < 6; it++) {
    B = run('B', [A], pen);
    C = run('C', [A, B], pen);
    if (variantDiff(A, B, skip) >= 0.3 && variantDiff(A, C, skip) >= 0.3 && variantDiff(B, C, skip) >= 0.3) break;
    pen *= 1.6;
  }
  return { slots: ctx.slots, variants: { A, B, C } };
}

export interface RankedAlt {
  chord: Chord;
  score: number;
  kind: Cand['kind'];
  inTop: boolean;
}

/** Ranked alternatives for one slot of a variant (neighbours fixed). Full pool, best first; `inTop` marks the best 6. */
export function rankSlot(inp: HarmonizeInput, variant: VariantId, chords: Chord[], idx: number): RankedAlt[] {
  const ctx = makeCtx(inp);
  const prev = idx > 0 ? candFromChord(chords[idx - 1], inp.key) : null;
  const next = idx + 1 < chords.length ? candFromChord(chords[idx + 1], inp.key) : null;
  const plagalOk = GENRE_BIAS[inp.genre].plagalAmen && idx >= ctx.slots.length - 2;
  const alts = ctx.pool.map((c) => {
    let s = unary(ctx, variant, c, idx) + emission(ctx, c, idx);
    if (prev) s += transition(ctx, prev, c, idx);
    if (next) s += transition(ctx, c, next, idx + 1);
    if (!cadenceAllows(c, ctx.roles[idx], inp.key, plagalOk, 'C', isNatural(inp))) s -= 3;
    return { chord: c.chord, score: s, kind: c.kind, inTop: false };
  });
  alts.sort((a, b) => b.score - a.score);
  alts.slice(0, 6).forEach((a) => { a.inTop = true; });
  return alts;
}

export function notesSignature(notes: Note[]): string {
  let h = 0;
  for (const n of notes) h = (h * 31 + n.midi * 7 + Math.round(n.startSec * 100) + Math.round(n.durSec * 50)) % 1_000_000_007;
  return `${notes.length}:${h}`;
}

/** Test/diagnostic helper: is the cadence at phrase end valid? */
export function cadenceValid(prev: Chord | null, last: Chord, key: KeySig, kind: CadenceKind | 'any', plagalOk: boolean, natural = false): boolean {
  const rel = (c: Chord) => (((c.root - key.tonic) % 12) + 12) % 12;
  const isV = (c: Chord) => rel(c) === 7 && (c.quality === 'maj' || c.quality === 'dom7' || c.quality === 'sus4') || rel(c) === 11 && (c.quality === 'dim' || c.quality === 'hdim7' || c.quality === 'dim7');
  const isTonic = (c: Chord) => rel(c) === 0 && c.quality !== 'dom7' && c.quality !== 'sus4';
  if (kind === 'half') return rel(last) === 7 || (natural && rel(last) === 10);
  if (natural && prev && last.quality !== 'dom7' && last.quality !== 'sus4') {
    // modal cadence of modern genres in natural minor: v / bVII / bVI / iv -> i, or the i-bVII-bVI-bVII loop closing on bVII
    const pr = rel(prev), lr = rel(last);
    if ([7, 10, 8, 5].includes(pr) && (lr === 0 || (lr === 10 && pr !== 10))) return true;
  }
  if (!prev) return isTonic(last);
  if (isV(prev) && isTonic(last)) return true;
  if (isV(prev) && (key.mode === 'major' ? rel(last) === 9 : rel(last) === 8)) return true;
  if (plagalOk && rel(prev) === 5 && isTonic(last)) return true;
  return false;
}
