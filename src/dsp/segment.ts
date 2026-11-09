import type { Note, Pause, PitchTrack } from '../model/types';
import { hzToMidiF } from '../music/theory';
import { uid } from '../model/id';

export interface SegmentOptions {
  bpm: number;
  audio?: Float32Array;
  sampleRate?: number;
  /** Potts penalty per segment, in semitone^2 * frames. */
  penalty?: number;
}

interface Seg { a: number; b: number; hardStart: boolean; med: number }

function median(v: number[]): number {
  if (!v.length) return NaN;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stableMedian(m: Float64Array, a: number, b: number): number {
  const len = b - a;
  const pad = Math.floor(len * 0.2);
  const lo = len >= 5 ? a + pad : a, hi = len >= 5 ? b - pad : b;
  const vals: number[] = [];
  for (let i = lo; i < hi; i++) if (!Number.isNaN(m[i])) vals.push(m[i]);
  return median(vals);
}

/** Split a voiced sub-run [a,b) into piecewise-constant segments (least squares with per-segment penalty). */
function potts(m: Float64Array, a: number, b: number, lambda: number): number[] {
  const n = b - a;
  const s1 = new Float64Array(n + 1), s2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = m[a + i];
    s1[i + 1] = s1[i] + v;
    s2[i + 1] = s2[i] + v * v;
  }
  const cost = (i: number, j: number) => {
    const len = j - i, sum = s1[j] - s1[i];
    return s2[j] - s2[i] - (sum * sum) / len;
  };
  const best = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1);
  best[0] = -lambda;
  const L = 400;
  for (let j = 1; j <= n; j++) {
    for (let i = Math.max(0, j - L); i < j; i++) {
      const c = best[i] + cost(i, j) + lambda;
      if (c < best[j]) { best[j] = c; from[j] = i; }
    }
  }
  const cuts: number[] = [];
  for (let j = n; j > 0; j = from[j]) cuts.push(a + from[j]);
  return cuts.reverse(); // segment starts
}

/** true when energy at 2*f0 dominates energy at f0 (tracker likely locked on a sub-harmonic). Without audio: false. */
function octaveUnderEnergy(audio: Float32Array | undefined, sr: number | undefined, t0: number, t1: number, f0: number): boolean {
  if (!audio || !sr) return false;
  const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(audio.length, Math.floor(t1 * sr));
  if (b - a < 256) return false;
  const g = (f: number) => {
    const w = 2 * Math.PI * f / sr;
    let re = 0, im = 0;
    for (let i = a; i < b; i++) { const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a)); re += audio[i] * win * Math.cos(w * (i - a)); im -= audio[i] * win * Math.sin(w * (i - a)); }
    return Math.hypot(re, im);
  };
  return g(2 * f0) > 0.72 * g(f0);
}

export function segmentNotes(
  track: PitchTrack,
  opts: SegmentOptions,
): { notes: Note[]; pauses: Pause[]; tuningCents: number; tuningConcentration: number } {
  const { hz, hopSec, rms } = track;
  const n = hz.length;
  const lambda = opts.penalty ?? 3.2;
  const m = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (hz[i] > 0) m[i] = hzToMidiF(hz[i]);

  // fill tiny unvoiced gaps (<=2 frames)
  for (let i = 1; i < n - 1; i++) {
    if (Number.isNaN(m[i])) {
      let j = i;
      while (j < n && Number.isNaN(m[j])) j++;
      if (j - i <= 2 && j < n && Math.abs(m[i - 1] - m[j]) < 0.8) {
        for (let k = i; k < j; k++) m[k] = m[i - 1] + ((m[j] - m[i - 1]) * (k - i + 1)) / (j - i + 1);
      }
      i = j;
    }
  }
  // 5-frame median to remove spikes
  const mf = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(m[i])) continue;
    const w: number[] = [];
    for (let k = -2; k <= 2; k++) { const v = m[i + k]; if (v !== undefined && !Number.isNaN(v)) w.push(v); }
    mf[i] = median(w);
  }

  // energy envelope in dB (3-frame average)
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = -1; k <= 1; k++) if (i + k >= 0 && i + k < n) { s += rms[i + k]; c++; }
    env[i] = 20 * Math.log10(s / c + 1e-9);
  }

  const segs: Seg[] = [];
  let i = 0;
  while (i < n) {
    if (Number.isNaN(mf[i])) { i++; continue; }
    let j = i;
    while (j < n && !Number.isNaN(mf[j])) j++;
    // run [i, j): find energy valleys
    const splits: number[] = [i];
    for (let k = i + 4; k < j - 4; k++) {
      let isMin = true;
      for (let q = -4; q <= 4; q++) if (env[k + q] < env[k]) { isMin = false; break; }
      if (!isMin) continue;
      let lmax = -Infinity, rmax = -Infinity;
      for (let q = Math.max(i, k - 20); q <= k; q++) lmax = Math.max(lmax, env[q]);
      for (let q = k; q < Math.min(j, k + 20); q++) rmax = Math.max(rmax, env[q]);
      if (Math.min(lmax, rmax) - env[k] >= 5 && k - splits[splits.length - 1] > 6) splits.push(k);
    }
    splits.push(j);
    for (let s = 0; s < splits.length - 1; s++) {
      const a = splits[s], b = splits[s + 1];
      if (b - a < 1) continue;
      const cuts = potts(mf, a, b, lambda);
      for (let c = 0; c < cuts.length; c++) {
        const sa = cuts[c], sb = c + 1 < cuts.length ? cuts[c + 1] : b;
        segs.push({ a: sa, b: sb, hardStart: c === 0, med: NaN });
      }
    }
    i = j;
  }

  // absorb glide/short segments (<60 ms) into the nearest-pitch neighbour (same run only)
  const minFrames = Math.round(0.06 / hopSec);
  const glideFrames = Math.round(0.13 / hopSec);
  const adjacent = (x: Seg, y: Seg) => x.b === y.a;
  const recompute = (s: Seg) => { s.med = stableMedian(mf, s.a, s.b); };
  segs.forEach(recompute);
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const prev = k > 0 && adjacent(segs[k - 1], s) && !s.hardStart ? segs[k - 1] : null;
      const next = k + 1 < segs.length && adjacent(s, segs[k + 1]) && !segs[k + 1].hardStart ? segs[k + 1] : null;
      const len = s.b - s.a;
      // transitional glide: short segment lying strictly between two clearly different neighbours
      const lo = prev && next ? Math.min(prev.med, next.med) : 0, hi = prev && next ? Math.max(prev.med, next.med) : 0;
      const glide = !!(prev && next) && len < glideFrames && hi - lo > 1.6 && s.med > lo + 0.4 && s.med < hi - 0.4;
      // onset scoop after an articulation dip: short lead-in that differs from the note that follows
      const lead = !prev && !!next && len < 9 && Math.abs(s.med - next.med) > 0.8;
      if (len >= minFrames && !glide && !lead) continue;
      let target: Seg | null = null;
      if (prev && next) target = Math.abs(prev.med - s.med) <= Math.abs(next.med - s.med) ? prev : next;
      else target = prev ?? next;
      if (!target) continue;
      if (target === prev) { prev.b = s.b; } else { next!.a = s.a; next!.hardStart = s.hardStart; }
      segs.splice(k, 1);
      recompute(target);
      changed = true;
      break;
    }
  }
  // merge neighbours with same rounded pitch when not separated by a hard boundary / gap
  for (let k = 1; k < segs.length; k++) {
    const p = segs[k - 1], s = segs[k];
    if (adjacent(p, s) && !s.hardStart && Math.round(p.med) === Math.round(s.med)) {
      p.b = s.b;
      segs.splice(k, 1);
      recompute(p);
      k--;
    }
  }

  // glide-aware onsets: a note starts where the pitch first leaves the previous note
  for (let k = 1; k < segs.length; k++) {
    const p = segs[k - 1], s = segs[k];
    if (!adjacent(p, s)) continue;
    let b = s.a;
    while (b - 1 > p.a + 3 && Math.abs(mf[b - 1] - p.med) > 0.3 && Math.abs(mf[b - 1] - s.med) > 0.3 && s.a - b < 12) b--;
    if (b < s.a) { s.a = b; p.b = b; }
  }

  const sorted = Array.from(rms).sort((x, y) => x - y);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const beatSec = 60 / opts.bpm;

  // --- octave-error correction against the local median of neighbouring notes
  const live = segs.filter((q) => (q.b - q.a) * hopSec >= 0.06 && !Number.isNaN(q.med));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < live.length; i++) {
      const vals: number[] = [];
      for (let k = Math.max(0, i - 3); k <= Math.min(live.length - 1, i + 3); k++) if (k !== i) vals.push(live[k].med);
      if (vals.length < 2) continue;
      const m = median(vals);
      if (m - live[i].med >= 10) live[i].med += 12;
      else if (live[i].med - m >= 10) live[i].med -= 12;
    }
  }
  // low outliers (sub-harmonic / vocal-fry onsets) well under the voice's typical register: back up one octave
  if (live.length >= 4) {
    const wm = median(live.flatMap((q) => Array((Math.max(1, Math.round((q.b - q.a) * hopSec * 10)))).fill(q.med)));
    for (const q of live) {
      if (wm - q.med >= 6 && (q.b - q.a) * hopSec < 0.6 && q.med + 12 <= wm + 7 && octaveUnderEnergy(opts.audio, opts.sampleRate, q.a * hopSec, q.b * hopSec, 440 * Math.pow(2, (q.med - 69) / 12))) q.med += 12;
    }
  }
  // --- scoops: very short notes right before their target merge into the following note
  const scoopMax = Math.max(0.1, beatSec / 4);
  for (let i = 0; i + 1 < live.length; ) {
    const q = live[i], nx = live[i + 1];
    const qd = (q.b - q.a) * hopSec;
    if (qd < scoopMax && Math.abs(nx.med - q.med) <= (qd < 0.1 ? 6 : 3) && (nx.a - q.b) * hopSec <= 0.2 && !nx.hardStart) {
      nx.a = q.a;
      live.splice(i, 1);
    } else i++;
  }

  // --- unstable intonation: a short note hovering a semitone off between two equal neighbours is the same note
  for (let i = 1; i + 1 < live.length; ) {
    const pv = live[i - 1], q = live[i], nx = live[i + 1];
    const dq = (q.b - q.a) * hopSec;
    if (dq < 0.4 && Math.abs(q.med - (pv.med + nx.med) / 2) >= 0.6 && Math.abs(pv.med - nx.med) <= 0.7 && Math.abs(q.med - (pv.med + nx.med) / 2) <= 1.6 && nx.a - q.b <= 3 && q.a - pv.b <= 3) {
      const dp = pv.b - pv.a, dn = nx.b - nx.a;
      pv.med = (pv.med * dp + nx.med * dn) / (dp + dn);
      pv.b = nx.b;
      live.splice(i, 2);
    } else i++;
  }
  // --- global tuning: duration-weighted circular mean of the cents deviation (period = 1 semitone)
  let cs = 0, sn = 0, wsum = 0;
  for (const q of live) {
    const w = (q.b - q.a) * hopSec;
    const ang = 2 * Math.PI * (q.med - Math.floor(q.med));
    cs += w * Math.cos(ang); sn += w * Math.sin(ang); wsum += w;
  }
  const concentration = wsum > 0 ? Math.hypot(cs, sn) / wsum : 0;
  let tuning = 0;
  if (live.length >= 3 && concentration >= 0.3) {
    tuning = Math.round((Math.atan2(sn, cs) / (2 * Math.PI)) * 100);
  }

  const notes: Note[] = [];
  for (const q of live) {
    const adj = q.med - tuning / 100;
    const midi = Math.round(adj);
    let r = 0, pv = 0, cnt = 0;
    for (let k = q.a; k < q.b; k++) { r += rms[k]; pv += track.voicedProb[k]; cnt++; }
    r /= cnt; pv /= cnt;
    const lvl = 20 * Math.log10(r / ref + 1e-6);
    notes.push({
      id: uid(),
      midi,
      startSec: q.a * hopSec,
      durSec: (q.b - q.a) * hopSec,
      velocity: Math.max(0.25, Math.min(1, 0.85 + lvl / 30)),
      centsDev: Math.round((adj - midi) * 100),
      confidence: Math.max(0, Math.min(1, pv)),
    });
  }

  const total = n * hopSec;
  const beat = 60 / opts.bpm;
  const pauses: Pause[] = [];
  let cursor = 0;
  for (const nt of notes) {
    if (nt.startSec - cursor >= beat / 2) pauses.push({ startSec: cursor, durSec: nt.startSec - cursor });
    cursor = nt.startSec + nt.durSec;
  }
  if (total - cursor >= beat / 2 && notes.length) pauses.push({ startSec: cursor, durSec: total - cursor });
  return { notes, pauses, tuningCents: tuning, tuningConcentration: concentration };
}
