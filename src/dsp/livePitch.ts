/** Real-time pitch of one audio frame (YIN with parabolic interpolation). Used by the vocal trainer: ~2048 samples in, Hz out. */
export interface LivePitch { hz: number; clarity: number; rms: number }

export function detectPitch(frame: Float32Array, sr: number, fmin = 70, fmax = 1000, minRms = 0.006): LivePitch | null {
  const n = frame.length;
  let e = 0;
  for (let i = 0; i < n; i++) e += frame[i] * frame[i];
  const rms = Math.sqrt(e / n);
  if (rms < minRms) return null;
  const tauMax = Math.min(Math.floor(sr / fmin), (n >> 1) - 2), tauMin = Math.max(2, Math.floor(sr / fmax));
  const half = n >> 1;
  const d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) { const v = frame[i] - frame[i + tau]; s += v * v; }
    d[tau] = s;
  }
  // cumulative mean normalised difference
  const cm = new Float32Array(tauMax + 2);
  cm[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; cm[tau] = run > 0 ? (d[tau] * tau) / run : 1; }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cm[tau] < 0.15) { while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
  }
  if (best < 0) {
    // no clear dip: take the global minimum if it is reasonably periodic
    let m = 1, mt = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; mt = tau; }
    if (mt < 0 || m > 0.3) return null;
    best = mt;
  }
  const a = cm[best - 1], b = cm[best], c = cm[best + 1];
  const den = a - 2 * b + c;
  const shift = Math.abs(den) > 1e-9 ? (a - c) / (2 * den) : 0;
  const tau = best + Math.max(-1, Math.min(1, shift));
  return { hz: sr / tau, clarity: 1 - cm[best], rms };
}

/** midi (fractional) of a frequency */
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
