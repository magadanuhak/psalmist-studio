/** Mix EQ of the accompaniment bus (Q2): high-pass, and a gentle "match EQ" toward the genre's target spectrum (at most +-MAX_DB per octave band),
 *  so no instrument family buries the vocal band or the low-mid. Deterministic, applied before ducking in the offline render. */
import { BANDS, bandLevels } from '../audio/audit';
import { biquad, biquadCoeffs } from './fx';

export const ACC_EQ_MAX_DB = 6;
/** vocal pocket: how far the accompaniment's 1-4 kHz band is pulled down while the voice sings (on top of the broadband duck) */
export const POCKET_DB = 6;
/** high-shelf (7 kHz) on the whole accompaniment bus: honest air for samples recorded dull */
export const ACC_AIR_DB = 5;
export const POCKET_HZ: [number, number] = [1000, 4000];
/** static "sound match" of the accompaniment bus (dB at the octave bands 62 ... 8000 Hz), used by the realtime engine; measured against a pro mix: thin bottom, boxy / harsh 1-4 kHz, dull top */
export const DEFAULT_ACC_EQ: number[] = [3, 1.5, 0, -0.5, -2, -2.5, -2, 7];

/** Vocal pocket: pulls the 1-4 kHz band of the accompaniment down by up to `db` where the voice is active. `duck` = broadband duck curve (100 Hz, linear gain). */
export function vocalPocket(l: Float32Array, r: Float32Array, sr: number, duck: Float32Array, db = POCKET_DB): [Float32Array, Float32Array] {
  let lo = 1;
  for (const d of duck) if (d < lo) lo = d;
  if (lo >= 0.999) return [l, r];
  const hp = biquadCoeffs('hpf', sr, POCKET_HZ[0], 0.707), lp = biquadCoeffs('lpf', sr, POCKET_HZ[1], 0.707);
  const k = 1 - Math.pow(10, -db / 20);
  const run = (x: Float32Array) => {
    const mid = biquad(biquad(x, hp), lp);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const p = (i / sr) * 100, a = Math.min(duck.length - 1, Math.floor(p)), f = p - a;
      const d = duck[a] * (1 - f) + duck[Math.min(duck.length - 1, a + 1)] * f;
      const act = Math.max(0, Math.min(1, (1 - d) / (1 - lo)));
      y[i] = x[i] - k * act * mid[i];
    }
    return y;
  };
  return [run(l), run(r)];
}

export interface AccEqResult { l: Float32Array; r: Float32Array; gains: number[] }

/** Pure: the correction (dB) per octave band for measured levels (dB) against a target curve (dB, relative to the 125-500 Hz mean). */
export function correctionFor(levels: number[], target: readonly number[], maxDb = ACC_EQ_MAX_DB): number[] {
  const ref = (levels[1] + levels[2] + levels[3]) / 3;
  return levels.map((lv, i) => {
    const dev = lv - ref - target[i];
    if (Math.abs(dev) < 1.5) return 0;
    return Math.max(-maxDb, Math.min(maxDb, -0.8 * dev));
  });
}

export function matchAccEq(l: Float32Array, r: Float32Array, sr: number, target: readonly number[]): AccEqResult {
  const hp = biquadCoeffs('hpf', sr, 38, 0.707);
  let L = biquad(l, hp), R = biquad(r, hp);
  const gains = correctionFor(bandLevels([L, R], sr), target);
  gains.forEach((g, i) => {
    if (!g) return;
    const c = biquadCoeffs('peak', sr, BANDS[i], 1.0, g);
    L = biquad(L, c); R = biquad(R, c);
  });
  return { l: L, r: R, gains };
}
