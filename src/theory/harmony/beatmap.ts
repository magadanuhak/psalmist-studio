/** Beat map: the singer's actual beat times, tracked from vocal onsets (phase-locked loop, tempo drift limited to +-15%). */
export interface BeatMap {
  /** time in seconds of (fractional) beat b, counted from the section start */
  timeOfBeat(b: number): number;
  beatOfTime(t: number): number;
  times: number[];
}

export function linearBeatMap(bpm: number): BeatMap {
  const nom = 60 / bpm;
  return { timeOfBeat: (b) => b * nom, beatOfTime: (t) => t / nom, times: [] };
}

export function buildBeatMap(onsets: number[], bpm: number, totalBeats: number): BeatMap {
  const nom = 60 / bpm;
  const ons = [...onsets].sort((a, b) => a - b);
  if (ons.length < 4) return linearBeatMap(bpm);
  // imported audio may start off-grid: lock the first beat to the first onset when it is close to the start
  const times: number[] = [ons[0] < 0.75 * nom ? ons[0] : 0];
  let s = nom;
  let ptr = 0;
  const lo = nom * 0.85, hi = nom * 1.15;
  const n = Math.ceil(totalBeats) + 2;
  for (let i = 1; i <= n; i++) {
    const e = times[i - 1] + s;
    const win = 0.22 * s;
    while (ptr < ons.length && ons[ptr] < e - win) ptr++;
    let best = -1, bd = Infinity;
    for (let k = ptr; k < ons.length && ons[k] <= e + win; k++) {
      const d = Math.abs(ons[k] - e);
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) {
      const err = ons[best] - e;
      times.push(e + 0.6 * err);
      s = Math.min(hi, Math.max(lo, s + 0.25 * err));
    } else {
      times.push(e);
    }
  }
  const last = times.length - 1;
  const timeOfBeat = (b: number) => {
    if (b <= 0) return times[0] + b * nom;
    if (b >= last) return times[last] + (b - last) * s;
    const i = Math.floor(b);
    return times[i] + (times[i + 1] - times[i]) * (b - i);
  };
  const beatOfTime = (t: number) => {
    if (t <= times[0]) return (t - times[0]) / nom;
    if (t >= times[last]) return last + (t - times[last]) / s;
    let a = 0, b = last;
    while (b - a > 1) { const m = (a + b) >> 1; if (times[m] <= t) a = m; else b = m; }
    return a + (t - times[a]) / (times[a + 1] - times[a]);
  };
  return { timeOfBeat, beatOfTime, times };
}
