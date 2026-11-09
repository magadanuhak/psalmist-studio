/** Tempo map: the singer's beat times (taps or a tracker) smoothed into a drift curve, so the accompaniment breathes with the voice instead of following a straight grid.
 *  `map[k]` = song time of bar k's downbeat; the nominal grid is k * barSec. Everything the arrangement schedules is warped through it (piecewise linear per bar). */
import type { Arrangement, ArrNote } from './types';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Smoothed drift (seconds) of observed pulses against a straight grid of period `h`; `phase` = grid offset. Moving median then moving mean over `win` pulses. */
export function smoothDrift(times: number[], h: number, phase: number, win = 7): { t: number; d: number }[] {
  const raw = times.map((t) => ({ t, r: ((((t - phase) % h) + 1.5 * h) % h) - 0.5 * h }));
  // unwrap: consecutive pulses change their residual slowly, so remove the +-h jumps of the modulo
  for (let i = 1; i < raw.length; i++) { while (raw[i].r - raw[i - 1].r > h / 2) raw[i].r -= h; while (raw[i].r - raw[i - 1].r < -h / 2) raw[i].r += h; }
  const med = raw.map((_, i) => median(raw.slice(Math.max(0, i - (win >> 1)), i + (win >> 1) + 1).map((x) => x.r)));
  return raw.map((x, i) => { const a = med.slice(Math.max(0, i - 2), i + 3); return { t: x.t, d: a.reduce((s, v) => s + v, 0) / a.length }; });
}

/** Bar-line times for `nBars` bars: the straight grid (t0 + k*barSec) plus the smoothed drift of the observed pulses at that moment (clamped to +-0.4 s). */
export function tempoMapFromPulses(pulses: number[], pulsesPerBar: number, barSec: number, t0: number, nBars: number): number[] {
  const h = barSec / pulsesPerBar;
  const circ = (() => { let c = 0, s = 0; for (const t of pulses) { const a = (2 * Math.PI * (t - t0)) / h; c += Math.cos(a); s += Math.sin(a); } return Math.atan2(s, c) / (2 * Math.PI) * h; })();
  const dr = smoothDrift(pulses, h, t0 + circ);
  const at = (t: number) => {
    if (!dr.length) return 0;
    if (t <= dr[0].t) return dr[0].d;
    for (let i = 1; i < dr.length; i++) if (t <= dr[i].t) { const f = (t - dr[i - 1].t) / (dr[i].t - dr[i - 1].t || 1); return dr[i - 1].d * (1 - f) + dr[i].d * f; }
    return dr[dr.length - 1].d;
  };
  return Array.from({ length: nBars + 1 }, (_, k) => k * barSec + Math.max(-0.4, Math.min(0.4, at(t0 + k * barSec))));
}

/** nominal time -> mapped time (piecewise linear between bar lines; the last bar's length continues beyond the map) */
export function warpTime(map: readonly number[], barSec: number, t: number): number {
  if (map.length < 2) return t;
  const k = Math.max(0, Math.min(map.length - 2, Math.floor(t / barSec)));
  const f = (t - k * barSec) / barSec;
  return map[k] + (map[k + 1] - map[k]) * f;
}

export function warpArrangement(arr: Arrangement, map: readonly number[], barSec: number): Arrangement {
  if (map.length < 2) return arr;
  const w = (t: number) => warpTime(map, barSec, t);
  const note = (n: ArrNote): ArrNote => { const a = w(n.startSec), b = w(n.startSec + n.durSec); return { ...n, startSec: a, durSec: Math.max(0.02, b - a) }; };
  return {
    ...arr,
    tracks: arr.tracks.map((t) => ({ ...t, notes: t.notes.map(note) })),
    plan: arr.plan.map((s) => { const a = w(s.startSec), b = w(s.startSec + s.durSec); return { ...s, startSec: a, durSec: b - a }; }),
    markers: arr.markers.map((m) => ({ ...m, time: w(m.time) })),
    transitions: arr.transitions.map((x) => ({ ...x, timeSec: w(x.timeSec) })),
    songSec: w(arr.songSec),
  };
}

/** Offsets (seconds) between observed pulses and our scheduled pulses: straight grid vs tempo-mapped grid. Phase = the grid's best offset against the pulses. */
export function pulseOffsets(pulses: number[], pulsesPerBar: number, barSec: number, t0: number, map: readonly number[]): { linear: number[]; mapped: number[] } {
  const h = barSec / pulsesPerBar;
  let c = 0, s = 0;
  for (const t of pulses) { const a = (2 * Math.PI * (t - t0)) / h; c += Math.cos(a); s += Math.sin(a); }
  const phase = (Math.atan2(s, c) / (2 * Math.PI)) * h;
  const linear: number[] = [], mapped: number[] = [];
  for (const t of pulses) {
    const u = t - t0 - phase;
    const k = Math.round(u / h);
    linear.push(Math.abs(u - k * h));
    let best = Infinity;
    for (let j = k - 4; j <= k + 4; j++) best = Math.min(best, Math.abs(t - t0 - (warpTime(map, barSec, j * h + phase) )));
    mapped.push(best);
  }
  return { linear, mapped };
}
