/** Piecewise tempo map from tracker downbeats (e.g. Beat This! via /beats): a live, unclicked song drifts, so a single linear fit is wrong somewhere.
 *  Bar k = [downbeat_k, downbeat_k+1]; downbeats the tracker missed are interpolated between their neighbours. */

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Regular-spaced downbeat times: gaps (missed downbeats) are filled by linear interpolation; spurious extra downbeats closer than 0.6 x the median gap are dropped. */
export function fillDownbeats(downbeats: number[]): number[] {
  const d = [...downbeats].sort((a, b) => a - b);
  if (d.length < 3) return d;
  const gaps = d.slice(1).map((x, i) => x - d[i]);
  const g = median(gaps);
  const out: number[] = [d[0]];
  for (let i = 1; i < d.length; i++) {
    const gap = d[i] - out[out.length - 1];
    if (gap < 0.6 * g) continue;
    const n = Math.max(1, Math.round(gap / g));
    const from = out[out.length - 1];
    for (let k = 1; k < n; k++) out.push(from + (gap * k) / n);
    out.push(d[i]);
  }
  return out;
}

/** Bar-line times from downbeats: `perBar` = how many tracker downbeats make one bar (2 for a 12/8 bar the tracker reads as two 6/8 bars), `parity` = which one starts a bar. */
export function barsFromDownbeats(downbeats: number[], perBar = 1, parity = 0): number[] {
  const f = fillDownbeats(downbeats);
  const out: number[] = [];
  for (let i = parity; i < f.length; i += perBar) out.push(f[i]);
  return out;
}

/** which parity puts a bar line closest to `anchor` (e.g. the first sung phrase or a linear estimate) */
export function bestParity(downbeats: number[], perBar: number, anchor: number): number {
  const f = fillDownbeats(downbeats);
  let best = 0, bd = Infinity;
  for (let p = 0; p < perBar; p++) { const t = f[p] ?? Infinity; const k = Math.round((anchor - t) / ((f[f.length - 1] - f[0]) / Math.max(1, f.length - 1) * perBar)); const near = Math.abs(t + k * ((f[f.length - 1] - f[0]) / Math.max(1, f.length - 1)) * perBar - anchor); if (near < bd) { bd = near; best = p; } }
  return best;
}

/** project-time bar map (bar 0 = 0 s) for `setTempoMap`, plus the original-timeline time of bar 0 */
export function tempoMapFromBars(bars: number[], nBars: number): { map: number[]; t0: number } {
  const b = bars.slice(0, nBars + 1);
  return { map: b.map((x) => x - b[0]), t0: b[0] };
}
