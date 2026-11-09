import type {
  ChordSlotIn, Hook, MelodyDiagnostics, MelodyInput, MelodyResult, MeterIn, OutNote, OutTrack, SectionIn, VocalNoteIn,
} from './types';
import {
  EMOTIONS, GENRES, makeRng, rangeOf, type EmotionProfile, type GenreProfile, type Rng,
} from './data';
import {
  extractHook, fragmentMotif, hookToMotif, invertMotif, medianPitch, scaleMidis, scalePcs, sequenceMotif, shiftDiatonic,
  type Motif,
} from './motif';

const EPS = 1e-6;
const STRONG_TOL = 0.03;
const FORBID = new Set([0, 1, 6, 7, 11]);
const CONS = new Set([3, 4, 8, 9]);

interface Sec extends SectionIn { end: number }

export function strongPositions(m: MeterIn): number[] {
  const def: Record<string, number[]> = {
    '4/4': [2, 2], '2/4': [2], '3/4': [3], '6/8': [3, 3], '7/8': [3, 2, 2], '5/8': [3, 2], '9/8': [3, 3, 3], '12/8': [3, 3, 3, 3],
  };
  let g = (m.grouping ?? []).slice();
  if (!g.length || g.reduce((a, b) => a + b, 0) !== m.num) g = def[`${m.num}/${m.den}`] ?? [m.num];
  if (g.length === 1 && g[0] === 4 && m.den === 4) g = [2, 2];
  const out: number[] = [];
  let c = 0;
  for (const x of g) { out.push(c); c += x; }
  return out;
}

interface Ctx {
  inp: MelodyInput;
  beat: number; unit: number; bar: number; num: number;
  strongPos: Set<number>;
  sections: Sec[];
  slots: ChordSlotIn[];
  vocal: VocalNoteIn[];
  vStarts: number[];
  maxVDur: number;
  pcs: number[]; pcSet: Set<number>; scale: number[];
  ornPcs: number[]; ornScale: number[];
  prof: GenreProfile; emo: EmotionProfile; rng: Rng;
  tonic: number; minorKey: boolean;
  median: number; cls: 'low' | 'mid' | 'high';
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

function buildCtx(inp: MelodyInput): Ctx {
  const unit = 240 / (inp.bpm * inp.meter.den);
  const bar = unit * inp.meter.num;
  const sections: Sec[] = inp.sections.map((s) => ({ ...s, end: s.startSec + s.bars * bar })).sort((a, b) => a.startSec - b.startSec);
  const slots = sections.flatMap((s) => s.chords).slice().sort((a, b) => a.startSec - b.startSec);
  const vocal = inp.vocalNotes.slice().sort((a, b) => a.startSec - b.startSec);
  const prof = GENRES[inp.genre];
  const minorKey = inp.key.mode !== 'major';
  const harmOrn = prof.harmonicMinorOrnaments;
  const pcs = scalePcs(inp.key, false);
  const ornPcs = scalePcs(inp.key, harmOrn);
  const mc = (inp.vocalRange.low + inp.vocalRange.high) / 2;
  const median = vocal.length ? medianPitch(vocal.map((n) => n.midi)) : mc;
  return {
    inp, beat: 60 / inp.bpm, unit, bar, num: inp.meter.num,
    strongPos: new Set(strongPositions(inp.meter)), sections, slots, vocal,
    vStarts: vocal.map((v) => v.startSec), maxVDur: vocal.reduce((m, v) => Math.max(m, v.durSec), 0),
    pcs, pcSet: new Set(pcs), scale: scaleMidis(pcs), ornPcs, ornScale: scaleMidis(ornPcs),
    prof, emo: EMOTIONS[inp.emotion] ?? EMOTIONS.nostalgic, rng: makeRng(inp.seed),
    tonic: inp.key.tonic, minorKey, median,
    cls: mc <= 57 ? 'low' : mc >= 67 ? 'high' : 'mid',
  };
}

const sectionAt = (c: Ctx, t: number): Sec | undefined => {
  for (const s of c.sections) if (t >= s.startSec - EPS && t < s.end - EPS) return s;
  return undefined;
};
function chordAt(c: Ctx, t: number): ChordSlotIn | undefined {
  const sl = c.slots;
  if (!sl.length) return undefined;
  let lo = 0, hi = sl.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (sl[m].startSec <= t + EPS) { r = m; lo = m + 1; } else hi = m - 1; }
  return sl[r];
}
function isStrong(c: Ctx, t: number): boolean {
  const s = sectionAt(c, t);
  if (!s) return false;
  const u = (t - s.startSec) / c.unit;
  const r = Math.round(u);
  if (Math.abs(u - r) * c.unit > STRONG_TOL) return false;
  return c.strongPos.has(((r % c.num) + c.num) % c.num);
}
const isChordTone = (c: Ctx, t: number, p: number) => {
  const ch = chordAt(c, t);
  return !ch || ch.pcs.includes(((p % 12) + 12) % 12);
};
function strongTimes(c: Ctx, s: Sec): number[] {
  const out: number[] = [];
  const pos = [...c.strongPos].sort((a, b) => a - b);
  for (let b = 0; b < s.bars; b++) for (const p of pos) out.push(s.startSec + (b * c.num + p) * c.unit);
  return out;
}
function vocalIn(c: Ctx, t0: number, t1: number): VocalNoteIn[] {
  const out: VocalNoteIn[] = [];
  for (let i = lowerBound(c.vStarts, t0 - c.maxVDur - EPS); i < c.vocal.length && c.vocal[i].startSec < t1 - 1e-4; i++) {
    if (c.vocal[i].startSec + c.vocal[i].durSec > t0 + 1e-4) out.push(c.vocal[i]);
  }
  return out;
}
const circ = (a: number, b: number) => { const x = (((a - b) % 12) + 12) % 12; return Math.min(x, 12 - x); };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function velOf(c: Ctx, energy: number, strong: boolean, scale = 1): number {
  const v = (c.emo.velocity + (energy - 3) * 4 + (strong ? 6 : 0) + c.rng.int(-3, 3)) * scale;
  return clamp(Math.round(v), 28, 120);
}

/** Candidate pitches for a note at time t: chord tones on strong beats, scale tones (or chord tones) otherwise. */
function candidates(c: Ctx, t: number, lo: number, hi: number, strong: boolean, scaleSet: Set<number>): number[] {
  const ch = chordAt(c, t);
  const out: number[] = [];
  for (let p = lo; p <= hi; p++) {
    const pc = p % 12;
    const ct = !ch || ch.pcs.includes(pc);
    if (strong ? ct : ct || scaleSet.has(pc)) out.push(p);
  }
  return out;
}

const stepOk = (c: Ctx, a: number, b: number) => {
  const d = Math.abs(a - b);
  if (d <= 2) return true;
  // augmented second of harmonic minor (b6 -> 7)
  return d === 3 && c.minorKey && ((Math.min(a, b) - c.tonic + 120) % 12) === 8 && ((Math.max(a, b) - c.tonic + 120) % 12) === 11;
};

/** Viterbi line fitting: chord tones on strong beats, stepwise on weak beats, closeness to contour targets, lead-in to a pitch. */
function fitLine(c: Ctx, targets: number[], times: number[], lo: number, hi: number, leadPitch: number | null): number[] {
  const n = targets.length;
  const strongF = times.map((t) => isStrong(c, t));
  const cand: number[][] = times.map((t, i) => {
    let l = candidates(c, t, lo, hi, strongF[i], c.pcSet);
    if (!l.length) l = candidates(c, t, lo - 6, hi + 6, strongF[i], c.pcSet);
    if (!l.length) l = [Math.round(targets[i])];
    return l;
  });
  const cost: number[][] = [], back: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [], br: number[] = [];
    for (let j = 0; j < cand[i].length; j++) {
      const p = cand[i][j];
      let e = Math.abs(p - targets[i]);
      if (i === n - 1 && leadPitch !== null) e += 4 * Math.max(0, circ(p, leadPitch) - 2);
      if (i === 0) { row.push(e); br.push(-1); continue; }
      let bestC = Infinity, bj = 0;
      for (let k = 0; k < cand[i - 1].length; k++) {
        const pp = cand[i - 1][k];
        const d = Math.abs(p - pp);
        let tr: number;
        if (!strongF[i]) tr = stepOk(c, pp, p) ? 0.4 * d : 30 + 10 * (d - 2);
        else tr = 0.3 * d + (d === 0 ? 0.3 : 0);
        const tot = cost[i - 1][k] + tr;
        if (tot < bestC) { bestC = tot; bj = k; }
      }
      row.push(bestC + e); br.push(bj);
    }
    cost.push(row); back.push(br);
  }
  let j = 0;
  for (let k = 1; k < cost[n - 1].length; k++) if (cost[n - 1][k] < cost[n - 1][j]) j = k;
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = cand[i][j]; j = back[i][j]; }
  return out;
}

interface Fit { pitches: number[]; times: number[]; score: number; viol: number }
function scorePitches(c: Ctx, ps: number[], times: number[], center: number, lo: number, hi: number): number {
  let viol = 0, off = 0, sum = 0;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] < lo || ps[i] > hi) return Infinity;
    sum += ps[i];
    if (!c.pcSet.has(ps[i] % 12)) off++;
    if (isStrong(c, times[i]) && !isChordTone(c, times[i], ps[i])) viol++;
  }
  return viol * 12 + off * 3 + Math.abs(sum / ps.length - center) * 0.3;
}
function nudge(c: Ctx, ps: number[], times: number[], lo: number, hi: number): number[] {
  return ps.map((p, i) => {
    if (!isStrong(c, times[i]) || isChordTone(c, times[i], p)) return p;
    const l = candidates(c, times[i], lo, hi, true, c.pcSet);
    let b = p, bd = Infinity;
    for (const q of l) { const d = Math.abs(q - p) + (q > p ? 0.01 : 0); if (d < bd) { bd = d; b = q; } }
    return b;
  });
}
/** Chromatic transposition of a phrase (intervals preserved), best start & shift for chord-tone-on-strong-beat. */
function fitChromatic(c: Ctx, pitches: number[], rel: number[], starts: number[], center: number, lo: number, hi: number, minMatch = 0): Fit {
  const m = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  let best: Fit | null = null;
  for (let si = 0; si < starts.length; si++) {
    const times = rel.map((r) => starts[si] + r);
    for (let s = -16; s <= 16; s++) {
      const ps = pitches.map((p) => p + s);
      const sc = scorePitches(c, ps, times, center, lo, hi) + Math.abs(s) * 0.02 + si * 0.05;
      if (!best || sc < best.score) best = { pitches: ps, times, score: sc, viol: 0 };
    }
  }
  if (!best || !isFinite(best.score)) {
    const s = Math.round(center - m);
    const times = rel.map((r) => starts[0] + r);
    best = { pitches: pitches.map((p) => clamp(p + s, lo, hi)), times, score: Infinity, viol: 0 };
  }
  let ps = nudge(c, best.pitches, best.times, lo, hi);
  if (minMatch > 0 && pitches.length > 1) {
    let m = 0;
    for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] === pitches[i] - pitches[i - 1]) m++;
    if (m / (ps.length - 1) < minMatch) ps = best.pitches; // keep the hook's intervals intact rather than nudging
  }
  const viol = ps.filter((p, i) => isStrong(c, best!.times[i]) && !isChordTone(c, best!.times[i], p)).length;
  return { ...best, pitches: ps, viol };
}

/** Quantise relative onsets/durations (seconds) to half-units, strictly increasing. */
function quantRel(c: Ctx, m: Motif): { rel: number[]; dur: number[] } {
  const q = c.unit / 2;
  const rel: number[] = [];
  m.onsets.forEach((o, i) => {
    let r = Math.round((o * c.beat) / q) * q;
    if (i > 0 && r <= rel[i - 1] + EPS) r = rel[i - 1] + q;
    rel.push(r);
  });
  const dur = m.durs.map((d, i) => {
    const next = i + 1 < rel.length ? rel[i + 1] - rel[i] : Infinity;
    return Math.max(q, Math.min(Math.round((d * c.beat) / q) * q, next));
  });
  return { rel, dur };
}

function stepNeighbor(p: number, dir: number, scale: number[]): number {
  const a = shiftDiatonic(p, dir, scale), b = shiftDiatonic(p, -dir, scale);
  return Math.abs(a - p) <= 2 || Math.abs(b - p) > 2 ? a : b;
}

function foldRange(p: number, lo: number, hi: number): number {
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return p;
}

interface Programs { lead: number; answers: number; counter: number }
function choosePrograms(c: Ctx, counterWin: [number, number]): Programs {
  const g = c.prof;
  const energetic = ['energic', 'vesel', 'lauda', 'biruinta', 'epic'].includes(c.inp.emotion);
  let answers = g.answerPrograms[0];
  if (c.inp.genre === 'worship') answers = energetic ? 27 : 0;
  else if (c.inp.genre === 'popular') answers = c.rng.pick(g.answerPrograms);
  const lead = g.leadPrograms[0];
  let counter = g.counterPrograms[g.counterPrograms.length - 1];
  for (const p of g.counterPrograms) {
    const r = rangeOf(p);
    if (r.low <= counterWin[0] && r.high >= counterWin[1]) { counter = p; break; }
  }
  return { lead, answers, counter };
}

/** candidate statement starts: strong beats first, then every half unit (pick-ups), all fitting before `limit` */
function startCands(c: Ctx, s: Sec, span: number, limit: number, from: number): number[] {
  const out = strongTimes(c, s).filter((t) => t >= from - EPS && t + span <= limit - EPS).slice(0, 6);
  const half = c.unit / 2;
  for (let t = from; t + span <= limit - EPS && out.length < 60; t += half) if (!out.some((x) => Math.abs(x - t) < 1e-4)) out.push(t);
  return out;
}

/* ------------------------------------------------------------------ lead: intro / bridge / outro */
function genLead(c: Ctx, hook: Hook, prog: number, out: { ritard: MelodyDiagnostics['ritardando'] }): OutNote[] {
  const notes: OutNote[] = [];
  const r = rangeOf(prog);
  const offset = c.cls === 'low' ? 12 : 0;
  const center = clamp(c.median + offset + c.emo.register, r.low + 7, r.high - 7);
  const lo = Math.max(r.low, Math.round(center - 11)), hi = Math.min(r.high, Math.round(center + 13));
  const motif = hookToMotif(hook);
  const q = quantRel(c, motif);
  const span = q.rel[q.rel.length - 1] + q.dur[q.dur.length - 1];

  const put = (p: number, t: number, d: number, energy: number, vs = 1) =>
    notes.push({ midi: p, startSec: t, durSec: Math.max(0.05, d), vel: velOf(c, energy, isStrong(c, t), vs) });

  const statement = (starts: number[], limitEnd: number, energy: number, vs = 1, optional = false): { end: number; ps: number[] } => {
    const f = fitChromatic(c, hook.pitches, q.rel, starts, center, lo, hi, 0.9);
    if (optional && f.viol > 0) return { end: limitEnd, ps: [] };
    let end = f.times[0];
    const ps: number[] = [];
    for (let i = 0; i < f.pitches.length; i++) {
      const t = f.times[i];
      if (t >= limitEnd - c.unit * 0.25) break;
      const nextT = i + 1 < f.times.length ? Math.min(f.times[i + 1], limitEnd) : limitEnd;
      const d = Math.min(q.dur[i], nextT - t) * clamp(c.emo.articulation + 0.1, 0.7, 1);
      put(f.pitches[i], t, d, energy, vs);
      ps.push(f.pitches[i]);
      end = t + q.dur[i];
    }
    return { end, ps };
  };

  for (const s of c.sections) {
    if (s.type === 'intro') {
      const limit = s.end - 1.5 * c.unit;
      const first = startCands(c, s, span, limit, s.startSec);
      const st = statement(first, limit, s.energy);
      let lastP = st.ps[st.ps.length - 1] ?? center;
      if (s.energy >= 3 && s.bars >= 4 && st.end + span + c.bar * 0.5 < limit) {
        const nb = Math.ceil((st.end - s.startSec) / c.bar - EPS);
        const starts = startCands(c, s, span, limit, s.startSec + nb * c.bar);
        if (starts.length) { const st2 = statement(starts, limit, s.energy, 1.05, true); lastP = st2.ps[st2.ps.length - 1] ?? lastP; }
      }
      const nv = c.vocal.find((v) => v.startSec >= s.end - 1e-3);
      if (nv) {
        let target = nv.midi + offset;
        target = foldRange(target, lo, hi);
        if (Math.abs(target + 12 - lastP) < Math.abs(target - lastP) && target + 12 <= hi) target += 12;
        const dir = lastP >= target ? 1 : -1;
        const n1 = stepNeighbor(target, dir, c.scale);
        const n0 = stepNeighbor(n1, dir, c.scale);
        const lastOn = notes.length ? notes[notes.length - 1].startSec : s.startSec;
        if (lastOn < s.end - 1.5 * c.unit - EPS) {
          put(n0, s.end - 1.5 * c.unit, c.unit * 0.45, s.energy, 0.9);
          put(n1, s.end - c.unit, c.unit - c.beat / 4 - 0.01, s.energy, 0.95);
        }
      }
    } else if (s.type === 'bridge') {
      const lastBar = s.end - c.bar;
      interface Pat { pitches: number[]; rel: number[]; dur: number[] }
      const full: Pat = { pitches: hook.pitches, rel: q.rel, dur: q.dur };
      const fcount = Math.min(3, Math.max(2, hook.pitches.length - 1));
      const fm = fragmentMotif(hookToMotif(hook), Math.max(0, hook.pitches.length - fcount), fcount);
      const fq = quantRel(c, fm);
      const frag: Pat = { pitches: fm.pitches, rel: fq.rel, dur: fq.dur };
      const spanOf = (p: Pat) => p.rel[p.rel.length - 1] + p.dur[p.dur.length - 1];
      const fitSpan = (p: Pat) => p.rel[p.rel.length - 1] + Math.min(p.dur[p.dur.length - 1], c.beat);
      let prevPeak = -Infinity, prevSteps = 0, peak = -Infinity, nextStart = s.startSec;
      for (let k = 0; k < 4; k++) {
        let pat = full;
        if (nextStart + fitSpan(pat) > lastBar + EPS) pat = frag;
        if (nextStart + fitSpan(pat) > lastBar + EPS) break;
        const pm = pat.pitches.reduce((a2, b2) => a2 + b2, 0) / pat.pitches.length;
        const base = 12 * Math.round((center - pm) / 12);
        const stepsList: number[] = [];
        if (k === 0) for (let d = -4; d <= 4; d++) stepsList.push(d);
        else for (let d = 1; d <= 5; d++) stepsList.push(prevSteps + d);
        let bestS: { steps: number; ps: number[]; sc: number; start: number } | null = null;
        for (let si = 0; si < 8; si++) {
          const st0 = nextStart + (si * c.unit) / 2;
          if (st0 + fitSpan(pat) > lastBar + EPS) break;
          const tms = pat.rel.map((x) => st0 + x);
          for (const steps of stepsList) {
            const ps = pat.pitches.map((p) => shiftDiatonic(p + base, steps, c.scale));
            if (k > 0 && Math.max(...ps) < prevPeak + 1) continue;
            const sc = scorePitches(c, ps, tms, center + k * 1.5, lo, Math.min(hi + 6, r.high)) + si * 0.2 + (k > 0 ? Math.abs(steps - prevSteps - 1) * 0.1 : 0);
            if (!bestS || sc < bestS.sc) bestS = { steps, ps, sc, start: st0 };
          }
        }
        if (!bestS) {
          const steps = prevSteps + 3;
          bestS = { steps, ps: pat.pitches.map((p) => shiftDiatonic(p + base, steps, c.scale)), sc: Infinity, start: nextStart };
        }
        const start = bestS.start;
        const times = pat.rel.map((x) => start + x);
        const ps = nudge(c, bestS.ps, times, lo, Math.min(hi + 6, r.high));
        prevSteps = bestS.steps;
        prevPeak = Math.max(...ps);
        for (let i = 0; i < ps.length; i++) {
          const nextT = i + 1 < times.length ? Math.min(times[i + 1], lastBar) : lastBar;
          put(ps[i], times[i], Math.min(pat.dur[i], nextT - times[i]) * 0.95, Math.min(5, s.energy + (k > 0 ? 1 : 0)), 1 + 0.08 * k);
          peak = Math.max(peak, ps[i]);
        }
                nextStart = s.startSec + Math.ceil((start + spanOf(pat) - s.startSec) / c.unit - EPS) * c.unit;
      }
      const holdStart = lastBar;
      if (holdStart < s.end - c.unit * 0.5) {
        const dom = (c.tonic + 7) % 12;
        const p = Math.round(Number.isFinite(peak) ? peak : center);
        let bp = p, bd = Infinity;
        for (let x = p - 12; x <= p + 12; x++) if (x % 12 === dom) { const d = Math.abs(x - (p - 2)); if (d < bd && x >= r.low && x <= r.high) { bd = d; bp = x; } }
        put(bp, holdStart, (s.end - holdStart) * 0.97, Math.min(5, s.energy + 1), 1.12);
      }
    } else if (s.type === 'outro') {
      const refrens = c.sections.filter((x) => x.type === 'refren');
      const lastR = refrens[refrens.length - 1];
      let pitches = hook.pitches, rel = q.rel, dur = q.dur, off = 0;
      if (lastR) {
        const ns = c.vocal.filter((v) => v.startSec >= lastR.startSec - EPS && v.startSec < lastR.end - EPS);
        let a = ns.length - 1;
        while (a > 0 && ns[a].startSec - (ns[a - 1].startSec + ns[a - 1].durSec) < c.beat * 0.99 && ns.length - a < 6) a--;
        const ph = ns.slice(a);
        if (ph.length >= 3) {
          const mo: Motif = { pitches: ph.map((n) => n.midi), onsets: ph.map((n) => (n.startSec - ph[0].startSec) / c.beat), durs: ph.map((n) => n.durSec / c.beat) };
          const qq = quantRel(c, mo);
          pitches = mo.pitches; rel = qq.rel; dur = qq.dur;
          const pu = Math.round((ph[0].startSec - lastR.startSec) / c.unit);
          off = (((pu % c.num) + c.num) % c.num) * c.unit;
        }
      }
      const holdStart = s.bars >= 2 ? s.end - c.bar : s.startSec;
      let lastP = center;
      if (s.bars >= 2) {
        const starts = [s.startSec + off, s.startSec].filter((x, i, arr) => arr.indexOf(x) === i);
        const f = fitChromatic(c, pitches, rel, starts, center, lo, hi);
        for (let i = 0; i < f.pitches.length; i++) {
          if (f.times[i] >= holdStart - c.unit * 0.25) break;
          const nextT = i + 1 < f.times.length ? Math.min(f.times[i + 1], holdStart) : holdStart;
          put(f.pitches[i], f.times[i], Math.min(dur[i], nextT - f.times[i]) * 0.95, s.energy, 0.95);
          lastP = f.pitches[i];
        }
      }
      let tp = lastP - ((lastP - c.tonic) % 12 + 12) % 12;
      const cands = [tp, tp + 12, tp - 12].filter((x) => x >= lo - 6 && x <= r.high);
      cands.sort((a, b) => Math.abs(a - lastP) - Math.abs(b - lastP));
      tp = cands[0] ?? foldRange(c.tonic + 60, lo, hi);
      put(tp, holdStart, (s.end - holdStart) * 0.98, s.energy, 0.9);
      out.ritard = { flag: true, fromSec: Math.max(s.startSec, s.end - 2 * c.bar), toSec: s.end, factor: 0.7 };
    }
  }
  return notes;
}

/* ------------------------------------------------------------------ answers in vocal pauses */
function genAnswers(c: Ctx, hook: Hook, prog: number, windows: { startSec: number; endSec: number }[]): OutNote[] {
  const notes: OutNote[] = [];
  const r = rangeOf(prog);
  const offset = c.cls === 'low' ? 12 : c.cls === 'high' ? -12 : 0;
  const centre = clamp(c.median + offset + c.emo.register, r.low + 6, r.high - 6);
  const lo = Math.max(r.low, Math.round(centre - 9)), hi = Math.min(r.high, Math.round(centre + 10));
  const pauses = c.inp.vocalPauses.slice().sort((a, b) => a.startSec - b.startSec);
  const m1 = c.beat / 8, m2 = c.beat / 4;
  const half = c.unit / 2;
  const hookM = hookToMotif(hook);
  let used = 0, seen = 0;
  for (const pz of pauses) {
    if (pz.durSec < c.beat * 0.999) continue;
    const sec = sectionAt(c, pz.startSec);
    if (!sec || sec.type === 'intro' || sec.type === 'outro' || sec.type === 'bridge' || sec.type === 'interlude') continue;
    const e = clamp(Math.round(sec.energy), 1, 5);
    const minBeats = c.prof.minimalAnswers ? [3, 1.75, 1.75, 1.5, 1][e - 1] : 1;
    if (pz.durSec / c.beat < minBeats - 1e-6) continue;
    if (e === 1 && !c.prof.minimalAnswers && (seen++ % 2 === 1)) continue;
    const pe = pz.startSec + pz.durSec;
    const ni = lowerBound(c.vStarts, pe - 1e-4);
    const next = c.vocal[ni];
    let prevEnd = pz.startSec;
    for (let k = ni - 1; k >= Math.max(0, ni - 4); k--) prevEnd = Math.max(prevEnd, c.vocal[k].startSec + c.vocal[k].durSec);
    const a = Math.max(pz.startSec, prevEnd) + m1 + 1e-3;
    let b = Math.min(pe, next ? next.startSec : pe) - m2 - 1e-3;
    let lead = next ? next.midi : null;
    if (pe > sec.end + EPS || b - a > 6 * c.beat) { b = Math.min(b, sec.end - m2, a + 6 * c.beat); lead = null; }
    if (b - a < 0.3 * c.beat) continue;
    let f = sec.startSec + Math.ceil((a - sec.startSec) / half - 1e-6) * half;
    if (f + 0.25 * c.beat > b) f = a;
    const spacing = [1.6, 1.1, 0.8, 0.55, 0.4][e - 1] / (c.prof.density * c.emo.density);
    let n = c.prof.minimalAnswers ? 1 : clamp(Math.round((b - f) / (spacing * c.beat)), 1, c.prof.maxAnswerNotes);
    n = Math.min(n, Math.max(1, Math.floor((b - f) / half)));
    const times: number[] = [f];
    const step = (b - f) / n;
    for (let i = 1; i < n; i++) {
      const t = f + Math.round((i * step) / half) * half;
      if (t > times[times.length - 1] + half * 0.99 && t < b - 0.25 * c.beat) times.push(t);
    }
    // contour source
    const prevNotes: VocalNoteIn[] = [];
    for (let k = ni - 1; k >= 0 && prevNotes.length < times.length; k--) {
      if (prevNotes.length && c.vocal[k + 1].startSec - (c.vocal[k].startSec + c.vocal[k].durSec) >= c.beat * 0.99) break;
      prevNotes.unshift(c.vocal[k]);
    }
    const lastV = c.vocal[ni - 1];
    const anchor = (lastV ? lastV.midi : centre) + offset;
    let src: number[];
    const mode = c.prof.minimalAnswers ? 0 : used % 3;
    if (mode === 1 && hookM.pitches.length >= 1) {
      const fr = fragmentMotif(hookM, 0, times.length);
      src = fr.pitches.map((p) => p - fr.pitches[0] + anchor);
    } else {
      const ps = prevNotes.map((x) => x.midi + offset);
      src = ps;
      if (mode === 2 && ps.length > 1) src = invertMotif({ pitches: ps, onsets: ps.map((_, i) => i), durs: ps.map(() => 1) }, c.scale).pitches;
    }
    while (src.length < times.length) src.push(src.length ? src[src.length - 1] + (src.length % 2 ? 2 : -1) : anchor);
    src = src.slice(src.length - times.length);
    const targets = src.map((p) => clamp(p, lo, hi));
    const leadPitch = lead;
    if (leadPitch !== null) targets[targets.length - 1] = clamp(foldNear(leadPitch + offset, targets[targets.length - 1]), lo, hi);
    const ps = fitLine(c, targets, times, lo, hi, leadPitch);
    used++;
    windows.push({ startSec: a, endSec: b });
    const ornP = c.prof.ornament * (0.35 + c.emo.ornament * 1.5);
    for (let i = 0; i < ps.length; i++) {
      const t = times[i];
      const end = i + 1 < times.length ? times[i + 1] : b;
      let d = end - t;
      d = i === ps.length - 1 ? Math.min(d, c.beat * 4) * 0.98 : d * clamp(c.emo.articulation, 0.5, 1);
      d = Math.min(d, end - t - 0.005);
      const strong = isStrong(c, t);
      const v = velOf(c, sec.energy, strong);
      const last = i === ps.length - 1;
      if (!last && d >= 0.4 * c.beat && c.rng.chance(ornP)) {
        const sc = c.ornScale;
        const o = Math.min(c.unit / 6, d / 6);
        const lower = clamp(shiftDiatonic(ps[i], -1, sc), r.low, r.high);
        if (c.rng.chance(0.6)) {
          notes.push({ midi: ps[i], startSec: t, durSec: o, vel: v }, { midi: lower, startSec: t + o, durSec: o, vel: v - 8 }, { midi: ps[i], startSec: t + 2 * o, durSec: d - 2 * o, vel: v - 4 });
        } else {
          const up = clamp(shiftDiatonic(ps[i], 1, sc), r.low, r.high);
          const alts = c.rng.int(2, 4);
          notes.push({ midi: ps[i], startSec: t, durSec: o, vel: v });
          for (let k = 1; k <= alts; k++) notes.push({ midi: k % 2 ? up : ps[i], startSec: t + k * o, durSec: o, vel: v - 6 });
          notes.push({ midi: ps[i], startSec: t + (alts + 1) * o, durSec: d - (alts + 1) * o, vel: v - 4 });
        }
      } else notes.push({ midi: ps[i], startSec: t, durSec: Math.max(0.05, d), vel: v });
    }
  }
  return notes;
}
function foldNear(p: number, ref: number): number {
  while (p - ref > 6) p -= 12;
  while (ref - p > 6) p += 12;
  return p;
}

/* ------------------------------------------------------------------ counter-melody */
function genCounter(c: Ctx, prog: number, win: [number, number], windows: { startSec: number; endSec: number }[]): OutNote[] {
  const notes: OutNote[] = [];
  const above = c.cls !== 'high';
  const [lo, hi] = win;
  const wc = (lo + hi) / 2;
  for (const s of c.sections) {
    if (!['strofa', 'prerefren', 'refren'].includes(s.type) || s.energy < c.prof.counterMinEnergy) continue;
    const span = s.energy >= 5 ? 1 : 2;
    const st = strongTimes(c, s);
    let t = s.startSec, prev: number | null = null;
    while (t < s.end - 0.3 * c.beat) {
      const strong = isStrong(c, t);
      let ti = st.findIndex((x) => x > t + 1e-4);
      if (ti < 0) ti = st.length - 1;
      const k = strong ? span : 1;
      let te = ti < 0 ? s.end : Math.min(st[Math.min(st.length - 1, ti + k - 1)] ?? s.end, s.end);
      if (ti >= 0 && st[ti] <= t + 1e-4) te = s.end;
      if (te - t < 0.5 * c.beat) { t = Math.max(te, t + 0.25 * c.beat); continue; }
      const vs = vocalIn(c, t, te);
      const vPrevIdx = vs.length ? c.vocal.indexOf(vs[0]) - 1 : -1;
      const vDir = vs.length && vPrevIdx >= 0 ? Math.sign(vs[0].midi - c.vocal[vPrevIdx].midi) : 0;
      let best: { p: number; e: number; sc: number } | null = null;
      for (const p of candidates(c, t, lo, hi, strong, c.pcSet)) {
        let e = te, ok = true;
        for (const v of vs) {
          const iv = (((p - v.midi) % 12) + 12) % 12;
          const bad = FORBID.has(iv) || (above ? p <= v.midi : p >= v.midi);
          const sounding = v.startSec <= t + 0.03;
          if (sounding) {
            if (bad || (strong && !CONS.has(iv))) { ok = false; break; }
          } else if (bad) { e = Math.min(e, v.startSec - 0.02); break; }
        }
        if (!ok || e - t < 0.5 * c.beat) continue;
        let sc = -(e - t) * 3 / c.beat + Math.abs(p - wc) * 0.12;
        if (prev !== null) {
          sc += Math.abs(p - prev) * 0.4;
          if (vDir !== 0 && Math.sign(p - prev) === vDir) sc += 2;
          if (p === prev) sc += 1;
        }
        if (vs.length) { const iv = (((p - vs[0].midi) % 12) + 12) % 12; if (!CONS.has(iv)) sc += 1.5; }
        if (!best || sc < best.sc - 1e-9) best = { p, e, sc };
      }
      if (!best) { t = te; continue; }
      notes.push({ midi: best.p, startSec: t, durSec: (best.e - t) * 0.96, vel: velOf(c, s.energy, strong, 0.8) });
      prev = best.p;
      t = best.e + (best.e < te ? 0.02 : 0);
      if (best.e >= te) t = te;
    }
  }
  void prog;
  // yield to the answers: counter rests while an answer sounds
  return notes.flatMap((n) => {
    const e = n.startSec + n.durSec;
    for (const w of windows) {
      if (n.startSec >= w.startSec - 1e-4 && n.startSec < w.endSec) return [];
      if (n.startSec < w.startSec && e > w.startSec - 0.01) {
        const d = w.startSec - 0.02 - n.startSec;
        if (d < 0.25 * c.beat) return [];
        return [{ ...n, durSec: d }];
      }
    }
    return [n];
  });
}

/* ------------------------------------------------------------------ vocal guard (margins) */
function guard(c: Ctx, n: OutNote): OutNote | null {
  const m1 = c.beat / 8, m2 = c.beat / 4;
  let cur: OutNote = n;
  for (let it = 0; it < 6; it++) {
    const hits = vocalIn(c, cur.startSec - m1, cur.startSec + cur.durSec + m2);
    if (!hits.length) return cur;
    const v = hits[0];
    if (v.startSec >= cur.startSec) {
      const d = v.startSec - m2 - cur.startSec - 1e-3;
      if (d < 0.15 * c.beat) return null;
      cur = { ...cur, durSec: d };
    } else return null;
  }
  return null;
}

/* ------------------------------------------------------------------ public */
export function generateMelodicLayers(inp: MelodyInput): MelodyResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const c = buildCtx(inp);
  const refrens = c.sections.filter((s) => s.type === 'refren').map((s) => ({ start: s.startSec, end: s.end }));
  const hook = extractHook(c.vocal, refrens, c.beat, inp.key, c.median);

  // counter register: above low/mid voices, below high voices
  const wc = c.cls === 'high' ? c.median - 13 : c.median + 13;
  const win: [number, number] = [Math.round(wc - 7), Math.round(wc + 7)];
  const prog = choosePrograms(c, win);
  const cr = rangeOf(prog.counter);
  const cw: [number, number] = [Math.max(cr.low, win[0]), Math.min(cr.high, win[1])];

  const ritard = { flag: false, fromSec: 0, toSec: 0, factor: 1 };
  const holder = { ritard };
  const leadN = genLead(c, hook, prog.lead, holder);
  const windows: { startSec: number; endSec: number }[] = [];
  const ansN = genAnswers(c, hook, prog.answers, windows);
  const ctrN = genCounter(c, prog.counter, cw, windows);

  const fin = (arr: OutNote[], gm: number, doGuard: boolean): OutNote[] => {
    const r = rangeOf(gm);
    const res: OutNote[] = [];
    for (const n of arr) {
      let x: OutNote | null = { ...n, midi: foldRange(n.midi, r.low, r.high) };
      if (doGuard) x = guard(c, x);
      if (x) res.push(x);
    }
    return res.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  };
  const lead = fin(leadN, prog.lead, true), ans = fin(ansN, prog.answers, true), ctr = fin(ctrN, prog.counter, false);
  const tracks: OutTrack[] = [
    { name: 'Hook / Lead', role: 'lead', gmProgram: prog.lead, channel: 3, notes: lead },
    { name: 'Answers', role: 'answers', gmProgram: prog.answers, channel: 4, notes: ans },
    { name: 'Counter-melody', role: 'counter', gmProgram: prog.counter, channel: 5, notes: ctr },
  ];
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    tracks,
    diagnostics: {
      hook, voiceClass: c.cls, instruments: prog,
      counts: { lead: lead.length, answers: ans.length, counter: ctr.length },
      ritardando: holder.ritard, answerWindows: windows, ms: now - t0,
    },
  };
}

export { sequenceMotif };
