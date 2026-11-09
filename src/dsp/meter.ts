/** Tempo & meter assistant (X0b): BPM, meter (top 2 with confidence), bar count and first downbeat from vocal onsets and/or taps.
 *  Pure TypeScript. BPM is reported in the project's unit (pulses of the denominator: quarter for x/4, eighth for x/8). */
import type { TimeSig } from '../model/types';
import { TIME_SIGS } from '../music/timesig';

export interface OnsetIn { startSec: number; durSec: number; midi: number; velocity?: number }
export interface TapIn { t: number; /** the user tapped "1" (downbeat) */ down?: boolean }

export interface MeterOption {
  sig: TimeSig;
  id: string;
  label: string;
  bpm: number;
  bars: number;
  /** time of the first downbeat (the first stressed note) */
  firstDownbeatSec: number;
  /** anacrusis: seconds of pickup notes before the first downbeat (0 = the song starts on the downbeat) */
  pickupSec: number;
  /** the pickup is shifted into a short bar in front, so `bars` already includes it */
  confidence: number;
  /** internal ranking score */
  score?: number;
  explanation: string;
}

export interface MeterResult {
  /** pulse (fine grid) period in seconds */
  pulseSec: number;
  options: MeterOption[];
  source: 'taps' | 'onsets' | 'both';
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

interface Tmpl { id: string; sig: TimeSig; L: number; w: number[]; denPulses: number }

function templates(): Tmpl[] {
  const out: Tmpl[] = [];
  for (const ts of TIME_SIGS) {
    if (ts.id === '12/8') continue; // compound feel is detected separately (subdivisionFeel), not by the bar templates
    const sig = ts.sig;
    // pulse = eighth note
    const L = sig.den === 8 ? sig.num : sig.num * 2;
    const w = new Array(L).fill(0.2);
    if (sig.den === 8) {
      let p = 0;
      sig.grouping.forEach((g, i) => { w[p] = i === 0 ? 1 : 0.7; p += g; });
    } else {
      for (let b = 0; b < sig.num; b++) w[b * 2] = b === 0 ? 1 : sig.num === 4 && b === 2 ? 0.75 : 0.5;
    }
    out.push({ id: ts.id, sig, L, w, denPulses: sig.den === 8 ? 1 : 2 });
  }
  return out;
}
const TMPL = templates();

function strengths(notes: OnsetIn[]): number[] {
  return notes.map((n, i) => {
    const prev = notes[i - 1], next = notes[i + 1];
    const gap = prev ? n.startSec - (prev.startSec + prev.durSec) : 1;
    let s = 0.5 + Math.min(1.4, n.durSec / 0.45) * 0.6 + (n.velocity ?? 0.7) * 0.3;
    if (prev && next && n.midi > prev.midi && n.midi >= next.midi) s += 0.25; // pitch peak
    if (gap > 0.35) s += 0.5; // phrase start
    return s;
  });
}

/** fine pulse period: onsets align to an integer grid of it */
function estimatePulse(on: number[], hint?: number[]): number {
  let best = 0.3, bs = -1;
  for (let p = 0.14; p <= 0.62; p *= 1.006) {
    let c = 0, s = 0;
    for (const t of on) { const a = (2 * Math.PI * t) / p; c += Math.cos(a); s += Math.sin(a); }
    const R = Math.hypot(c, s) / Math.max(1, on.length);
    let score = R * Math.exp(-((Math.log2(p / 0.3)) ** 2) / (2 * 0.55 * 0.55));
    // prefer periods that explain most inter-onset intervals as small integers
    let hit = 0;
    for (let i = 1; i < on.length; i++) { const r = (on[i] - on[i - 1]) / p; if (Math.abs(r - Math.round(r)) < 0.18 && r > 0.8) hit++; }
    score *= 0.6 + 0.4 * (hit / Math.max(1, on.length - 1));
    if (hint?.length) for (const h of hint) { const r = h / p; if (Math.abs(r - Math.round(r)) < 0.06 && Math.round(r) >= 1 && Math.round(r) <= 4) score *= 1.25; }
    if (score > bs) { bs = score; best = p; }
  }
  // refine on the circular mean of the phase
  return best;
}

function bestPhaseGrid(on: number[], p: number): number {
  let c = 0, s = 0;
  for (const t of on) { const a = (2 * Math.PI * t) / p; c += Math.cos(a); s += Math.sin(a); }
  const ph = Math.atan2(s, c) / (2 * Math.PI);
  return (ph < 0 ? ph + 1 : ph) * p;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
}

function explain(t: Tmpl, conf: number): string {
  const s = t.sig;
  const groups = s.grouping.join('+');
  const base = s.den === 8
    ? `Accentele cad din ${groups} în ${groups} pulsații de optime (${s.num}/8), deci o măsură ${s.num === 6 ? 'compusă, cu două timpuri ternare (se simte „1-2-3, 4-5-6”)' : s.num === 9 ? 'cu trei timpuri ternare' : 'asimetrică, de tip popular (' + groups + ')'}.`
    : s.num === 4 ? 'Accentul principal revine la fiecare patru timpuri, cu un accent mai mic pe timpul 3 („1-2-3-4”).'
    : s.num === 3 ? 'Accentul revine la fiecare trei timpuri („1-2-3”), ca într-un vals.'
    : 'Accentul revine la fiecare doi timpuri („1-2”), ca într-un marș.';
  return `${base} ${conf >= 0.6 ? 'Se potrivește clar cu felul în care cânți.' : 'Potrivirea nu e sigură; ascultă varianta și alege după ureche.'}`;
}

/** Subdivision feel of the sung onsets against a beat: strength of the beat/3 (compound / triplet) vs the beat/2 (simple) periodicity. */
export function subdivisionFeel(onsets: number[], beatSec: number, t0 = 0): { triplet: number; duple: number; compound: boolean } {
  const R = (k: number) => {
    let c = 0, s = 0;
    for (const t of onsets) { const a = 2 * Math.PI * k * ((t - t0) / beatSec); c += Math.cos(a); s += Math.sin(a); }
    return onsets.length ? Math.hypot(c, s) / onsets.length : 0;
  };
  const triplet = R(3), duple = R(2);
  return { triplet, duple, compound: triplet > 0.3 && triplet > duple * 1.25 };
}

/** Meter options; a sung triplet / compound feel on a 4-beat bar adds 12/8 (dotted-quarter beats) in front. BPM of 12/8 is in eighths (3 per beat). */
export function detectMeter(input: { notes?: OnsetIn[]; taps?: TapIn[]; durationSec?: number }): MeterResult | null {
  const r = detectMeterBase(input);
  if (!r || !input.notes?.length) return r;
  const top = r.options.find((o) => o.sig.den === 4 && o.sig.num === 4) ?? null;
  if (!top) return input.taps?.length ? r : eighthArbitration(r, input.notes);
  const beat = 60 / top.bpm;
  const feel = subdivisionFeel(input.notes.map((n) => n.startSec), beat, top.firstDownbeatSec);
  if (!feel.compound) return input.taps?.length ? r : eighthArbitration(r, input.notes);
  const sig = TIME_SIGS.find((t) => t.id === '12/8')!.sig;
  const opt: MeterOption = { ...top, sig, id: '12/8', label: '12/8', bpm: Math.round(top.bpm * 3), explanation: `Cântarea se împarte în trei (balans de 12/8): fiecare timp are trei optimi. ${top.explanation}`, confidence: Math.min(0.95, 0.5 + feel.triplet), score: (top.score ?? 0) + 0.5 };
  return { ...r, options: [opt, ...r.options.filter((o) => o !== top)].slice(0, 2) };
}

/** onset periodicity at k periods of the eighth pulse e (phase free) */
const periodicity = (on: number[], period: number) => { let c = 0, sn = 0; for (const t of on) { const a = (2 * Math.PI * t) / period; c += Math.cos(a); sn += Math.sin(a); } return on.length ? Math.hypot(c, sn) / on.length : 0; };

/**
 * 6-eighth bars: 3/4 (two-eighth groups) and 6/8 (three-eighth groups) share the bar and the eighth pulse, and a 4/4 / 2/4 reading of the same
 * onsets is the usual wrong answer for them. Fit the eighth pulse, compare the onset periodicity at 3 eighths with 2 eighths (compound or simple),
 * and use the repeated phrase (a whole number of 2, 4 or 8 bars) to tell a 6-eighth bar from an 8-eighth one.
 */
function eighthArbitration(r: MeterResult, notes: OnsetIn[]): MeterResult {
  const top = r.options[0];
  // a detector pick with a clean template fit (score >= 1.03) is kept; the 6-eighth readings are only weighed against a poor one
  if (!top || notes.length < 12 || (top.sig.den === 8 && top.sig.num !== 6) || top.sig.num === 12 || (top.score ?? 0) >= 1.03) return r;
  const on = notes.map((n) => n.startSec);
  // the detector's pulse may be an eighth, or half a dotted quarter (1.5 eighths): take the smallest candidate pulse the onsets really sit on
  const fit = (nom: number, ms = [2 / 3, 1, 4 / 3]) => ms.map((m) => { let e = nom * m, best = -1; for (let k = -40; k <= 40; k++) { const c = nom * m * (1 + k * 0.001); const v = periodicity(on, c); if (v > best) { best = v; e = c; } } return { e, v: best }; });
  const nom = (o: MeterOption) => (o.sig.den === 8 ? 60 / o.bpm : 30 / o.bpm);
  let cands = fit(nom(top));
  const extended = Math.max(...cands.map((c) => c.v)) < 0.6;
  if (extended) cands = cands.concat(...r.options.slice(1).map((o) => fit(nom(o), [1]))); // the detector's pulse may be a phrase-level guess: try the runner-up's too
  const vmax = Math.max(...cands.map((c) => c.v));
  const pick = cands.filter((c) => c.v >= 0.9 * vmax).sort((a, b) => a.e - b.e)[0], e = pick.e;
  if (extended && pick.v < 0.5) return r; // no pulse the onsets really sit on
  const p2 = periodicity(on, 2 * e), p3 = periodicity(on, 3 * e);
  if (Math.max(p2, p3) < 0.45) return r; // the onsets do not sit on a clear eighth grid (a loosely sung or noisy take): no basis to overrule the detector
  const compound = p3 > 0.3 && p3 > p2 * 1.25;
  const ph = phrasePeriod(notes);
  const fits = (bar: number) => { if (!ph || ph.strength < 0.3) return 0; const bars = ph.sec / (bar * e); return Math.abs(bars - Math.round(bars)) < 0.12 && [1, 2, 4, 8].includes(Math.round(bars)) ? 1 : 0; };
  const six = fits(6), eight = fits(8);
  // keep the detector's answer unless the evidence for a 6-eighth bar is clear
  const a68 = detectMeterBase({ notes, force: { pulse: e, only: ['6/8'] } })?.options[0], a34 = detectMeterBase({ notes, force: { pulse: e, only: ['3/4'] } })?.options[0];
  // a 6-eighth bar: clear from the phrase, or (no usable phrase) when a 6-eighth template explains the onsets clearly better than the detector's pick
  const bestSix = Math.max(a68?.score ?? -9, a34?.score ?? -9);
  const sixBar = (extended && !(six === 1 && eight === 0) && !(compound && p3 >= 0.65 && p3 > 1.5 * p2 && (a68?.score ?? 0) > (top.score ?? 0) + 0.1)) ? false : (compound ? six >= eight : six > eight) || (six === 0 && eight === 0 && bestSix > (top.score ?? 0) + 0.1);
  if (!sixBar) return r;
  const wantCompound = compound || (!!a68 && !!a34 && (a68.score ?? 0) > (a34.score ?? 0) + 0.05);
  const id = wantCompound ? '6/8' : '3/4';
  const alt = wantCompound ? a68 : a34;
  if (!alt) return r;
  const opt: MeterOption = { ...alt, confidence: Math.max(0.55, alt.confidence), explanation: wantCompound ? `Cântarea se împarte în trei (6/8): grupe de trei optimi. ${alt.explanation}` : alt.explanation };
  return { ...r, options: [opt, ...r.options.filter((o) => o.id !== id)].slice(0, 2) };
}

function detectMeterBase(input: { notes?: OnsetIn[]; taps?: TapIn[]; durationSec?: number; force?: { pulse: number; only: string[] } }): MeterResult | null {
  const notes = (input.notes ?? []).filter((n) => n.durSec >= 0.08).sort((a, b) => a.startSec - b.startSec);
  const taps = [...(input.taps ?? [])].sort((a, b) => a.t - b.t);
  if (notes.length < 6 && taps.length < 4) return null;
  const tapIv = taps.slice(1).map((t, i) => t.t - taps[i].t).filter((d) => d > 0.2 && d < 2);
  const tactus = tapIv.length >= 3 ? median(tapIv) : 0;
  const on = notes.map((n) => n.startSec);

  // ---------------------------------------------------------------- taps alone
  if (notes.length < 6) {
    const downs = taps.filter((t) => t.down);
    let beatsPerBar = 0;
    if (downs.length >= 2) {
      const di = downs.slice(1).map((d, i) => d.t - downs[i].t);
      beatsPerBar = Math.round(median(di) / tactus);
    }
    const first = (downs[0] ?? taps[0]).t;
    const last = taps[taps.length - 1].t;
    const mk = (id: string, perBar: number, conf: number, why: string): MeterOption => {
      const t = TMPL.find((x) => x.id === id)!;
      // taps mark the main beat: a quarter in x/4, a dotted quarter (3 eighths) in 6/8
      const bpm = t.sig.den === 8 ? (60 / tactus) * 3 : 60 / tactus;
      const bars = Math.max(1, Math.round((last - first) / (perBar * tactus)));
      return { sig: t.sig, id, label: id, bpm: Math.round(bpm), bars, firstDownbeatSec: first, pickupSec: 0, confidence: conf, explanation: why };
    };
    const opts: MeterOption[] = [];
    if (beatsPerBar === 2) {
      opts.push(mk('2/4', 2, 0.55, 'Ai bătut „1” la fiecare două timpuri: marș (2/4).'));
      opts.push(mk('6/8', 2, 0.4, 'La fel de bine pot fi două timpuri ternare (6/8). Ascultă ambele variante.'));
    } else if (beatsPerBar === 3) {
      opts.push(mk('3/4', 3, 0.9, 'Ai bătut „1” la fiecare trei timpuri: vals (3/4).'));
      opts.push(mk('4/4', 4, 0.2, 'Variantă alternativă, mai puțin probabilă.'));
    } else if (beatsPerBar === 4) {
      opts.push(mk('4/4', 4, 0.9, 'Ai bătut „1” la fiecare patru timpuri (4/4).'));
      opts.push(mk('2/4', 2, 0.25, 'Variantă alternativă, mai puțin probabilă.'));
    } else {
      opts.push(mk('4/4', 4, 0.4, 'Fără accente bătute nu pot ști măsura; 4/4 e cea mai frecventă. Bate „1” pe primul timp al fiecărei măsuri.'));
      opts.push(mk('3/4', 3, 0.3, 'Alternativă: vals (3/4).'));
    }
    return { pulseSec: tactus / 2, options: opts, source: 'taps' };
  }

  // ---------------------------------------------------------------- onsets (optionally with taps)
  const runOnsets = (p: number, only?: string[]): MeterResult | null => {
    const g0 = bestPhaseGrid(on, p);
    const str = strengths(notes);
    const first = on[0];
    const lastOn = on[on.length - 1];
    const i0 = Math.floor((first - g0) / p + 0.5);
    const iN = Math.floor((lastOn - g0) / p + 0.5);
    const total = iN - i0 + 1;
    const acc = new Array(total).fill(0);
    notes.forEach((n, k) => { const i = Math.round((n.startSec - g0) / p) - i0; if (i >= 0 && i < total) acc[i] += str[k]; });

    // phrase lengths in pulses (breath gaps)
    const starts: number[] = [];
    notes.forEach((n, k) => {
      const prev = notes[k - 1];
      if (k === 0 || n.startSec - (prev.startSec + prev.durSec) >= 1.0 * p) starts.push(Math.round((n.startSec - g0) / p));
    });
    const phrases = starts.slice(1).map((v, i) => v - starts[i]).filter((d) => d >= 4);
    const scored: { t: Tmpl; phase: number; r: number }[] = [];
    for (const t of TMPL) {
      if (only && !only.includes(t.id)) continue;
      if (total < t.L * 2) continue;
      let br = -2, bp = 0;
      for (let ph = 0; ph < t.L; ph++) {
        const folded = new Array(t.L).fill(0), cnt = new Array(t.L).fill(0);
        for (let i = 0; i < total; i++) { const k = (((i - ph) % t.L) + t.L) % t.L; folded[k] += acc[i]; cnt[k]++; }
        const prof = folded.map((v, k) => v / Math.max(1, cnt[k]));
        let r = pearson(prof, t.w);
        r -= 0.01 * t.L;
        if (starts.length >= 2) r += 0.25 * (starts.filter((v) => (((v - i0 - ph) % t.L) + t.L) % t.L === 0).length / starts.length);
        if (t.sig.den === 8 && t.sig.num !== 6) r -= 0.08; // asymmetric meters only when clearly better
        // phrases of folk / worship songs last 2, 4 or 8 bars
        if (phrases.length >= 1) {
          const bars = median(phrases) / t.L;
          if (Math.abs(bars - Math.round(bars)) < 0.12) r += [2, 4, 8].includes(Math.round(bars)) ? 0.1 : -0.12;
        }
        // x/4 vs 2x/4: if alternate bars start with a clearly different stress the longer bar is the real one
        if (t.id === '2/4' || t.id === '4/4') {
          const bl = t.L, ev: number[] = [], od: number[] = [];
          for (let i = ph; i < total; i += bl) ((Math.floor((i - ph) / bl) % 2) ? od : ev).push(acc[i]);
          const alt = mean(ev) / Math.max(1e-6, mean(od));
          const strong = Math.max(alt, 1 / alt) > 1.12;
          if (t.id === '2/4') r += strong ? -0.25 : 0.03;
          else if (!phrases.length || Math.abs(median(phrases) / t.L - Math.round(median(phrases) / t.L)) < 0.12) r += strong ? 0.12 : -0.05;
        }
        if (r > br) { br = r; bp = ph; }
      }
      scored.push({ t, phase: bp, r: br });
    }
    if (!scored.length) return null;
    // the user's tapped "1" settles the downbeat phase and favours the matching bar length
    scored.sort((a, b) => b.r - a.r);
    const ex = scored.map((s) => Math.exp(s.r * 5));
    const sum = ex.reduce((a, b) => a + b, 0);
    const opts: MeterOption[] = [];
    const seen = new Set<string>();
    scored.forEach((s, k) => {
      if (opts.length >= 2) return;
      const key = s.t.sig.num + '/' + s.t.sig.den;
      if (seen.has(key)) return;
      seen.add(key);
      const barPulses = s.t.L;
      const barSec = barPulses * p;
      // first downbeat: first pulse of phase `phase` not before the first onset (minus half a pulse)
      let db = g0 + (i0 + s.phase) * p;
      while (db < first - 0.5 * p) db += barPulses * p;
      while (db - barSec >= first - 0.5 * p) db -= barSec;
      const bars = Math.max(1, Math.floor((lastOn - db) / barSec + 0.15) + 1);
      const bpm = s.t.sig.den === 8 ? 60 / p : 60 / (2 * p);
      const conf = ex[k] / sum;
      const gap = db - first;
      const pickupSec = gap > 0.4 * p && gap < barSec - 0.4 * p ? gap : 0;
      opts.push({ sig: s.t.sig, id: s.t.id, label: s.t.id.replace(/[ab]$/, ''), bpm: Math.round(bpm), bars: bars + (pickupSec > 0 ? 1 : 0), firstDownbeatSec: db, pickupSec, confidence: conf, score: s.r, explanation: explain(s.t, conf) });
    });

    return { pulseSec: p, options: opts, source: tapIv.length >= 3 ? 'both' : 'onsets' };
  };

  // real singing: the syllable rate is not the beat. Repeated phrases (self-similarity of the pitch contour) fix the bar length;
  // combined with a 60-110 BPM prior and a 4/4 prior this gives the tempo and the meter.
  if (input.force) return runOnsets(input.force.pulse, input.force.only);
  const classic = runOnsets(estimatePulse(on, tactus ? [tactus, tactus / 2, tactus / 3, tactus * 2 / 3] : undefined));
  const ph = tapIv.length >= 3 ? null : phrasePeriod(notes);
  if (!ph || ph.strength < 0.45 || !classic || classic.options[0].confidence >= 0.6) return classic;
  const prior = (o: MeterOption, bars?: number) => (o.id === '4/4' ? 0.2 : 0) + (bars === 4 ? 0.05 : 0) + (bars !== undefined ? 0.1 : 0);
  const pool: { opt: MeterOption; total: number }[] = classic.options.map((o) => ({ opt: o, total: (o.score ?? 0) + prior(o) }));
  for (const [id, num] of [['4/4', 4], ['3/4', 3], ['2/4', 2]] as const) {
    for (const bars of [2, 4, 8]) {
      const beat = ph.sec / (bars * num);
      const bpm = 60 / beat;
      if (bpm < 60 || bpm > 110) continue;
      const o = runOnsets(beat / 2, [id])?.options[0];
      if (!o) continue;
      pool.push({ opt: { ...o, explanation: phraseWhy(o.explanation, ph.sec, bars) }, total: (o.score ?? 0) + prior(o, bars) + 0.35 * ph.strength });
    }
  }
  pool.sort((a, b) => b.total - a.total);
  const best: typeof pool = [];
  for (const c of pool) if (!best.some((x) => x.opt.id === c.opt.id) && best.length < 2) best.push(c);
  const ex = best.map((c) => Math.exp(c.total * 5)), sum = ex.reduce((x, y) => x + y, 0);
  return { pulseSec: 60 / best[0].opt.bpm / 2, options: best.map((c, k) => ({ ...c.opt, confidence: ex[k] / sum })), source: 'onsets' };
}

const phraseWhy = (base: string, sec: number, bars: number) => `Cântarea repetă o frază la fiecare ${sec.toFixed(1)} s, adică ${bars} măsuri. ${base}`;

/** Period (seconds) of the repeated musical phrase: self-similarity of the sung pitch contour. */
export function phrasePeriod(notes: OnsetIn[]): { sec: number; strength: number } | null {
  if (notes.length < 12) return null;
  const dt = 0.05;
  const total = Math.ceil((notes[notes.length - 1].startSec + notes[notes.length - 1].durSec) / dt) + 1;
  const f = new Float32Array(total).fill(NaN);
  for (const n of notes) {
    const a = Math.floor(n.startSec / dt), b = Math.max(a + 1, Math.floor((n.startSec + n.durSec) / dt));
    for (let i = a; i < b && i < total; i++) f[i] = n.midi;
  }
  const voiced = f.reduce((c, v) => c + (Number.isNaN(v) ? 0 : 1), 0);
  const minLag = Math.round(3 / dt), maxLag = Math.floor(total * 0.62);
  if (maxLag <= minLag || voiced < 40) return null;
  const sc = new Float32Array(maxLag + 2);
  for (let L = minLag; L <= maxLag; L++) {
    let hit = 0, vo = 0;
    for (let i = 0; i + L < total; i++) {
      if (Number.isNaN(f[i])) continue;
      vo++;
      const q = f[i + L];
      if (!Number.isNaN(q) && Math.abs(q - f[i]) <= 1) hit++;
    }
    sc[L] = (total - L) >= 0.35 * total && vo > 20 ? hit / vo : 0;
  }
  let bl = minLag;
  for (let L = minLag; L <= maxLag; L++) if (sc[L] > sc[bl]) bl = L;
  if (sc[bl] < 0.18) return null;
  // the shortest repetition that is almost as good (a phrase that repeats inside a longer one)
  let best = bl;
  for (let L = minLag; L < bl; L++) if (sc[L] >= 0.8 * sc[bl] && sc[L] >= sc[L - 1] && sc[L] >= sc[L + 1]) { best = L; break; }
  const y0 = sc[best - 1], y1 = sc[best], y2 = sc[best + 1];
  const off = y0 - 2 * y1 + y2 !== 0 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
  return { sec: (best + Math.max(-1, Math.min(1, off))) * dt, strength: sc[best] };
}

