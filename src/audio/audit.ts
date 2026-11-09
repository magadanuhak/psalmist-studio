/** Objective audits of an exported song (Q4): loudness / true peak, clipping, spectral balance against a genre target curve,
 *  masking of the vocal band by the accompaniment, simultaneous tracks, note density. Pure functions over the rendered buffers. */
import { rfft, hann } from '../dsp/fft';
import type { Genre } from '../model/types';
import type { Arrangement } from '../theory/arrange/types';
import { tasteAudit, type TasteReport } from '../theory/arrange/realize';

export type AuditId = 'loudLow' | 'loudHigh' | 'truePeak' | 'clipping' | 'dark' | 'bright' | 'muddy' | 'thin' | 'masking' | 'tooMany' | 'flat' | 'busyCounter' | 'register' | 'dense' | 'selfLow' | 'pitchLow';
export interface AuditWarning { id: AuditId; level: 'warn' | 'info' }

/** octave bands (centre Hz) and the target level of each relative to the mean of the 125-500 Hz bands (dB) */
export const BANDS = [62, 125, 250, 500, 1000, 2000, 4000, 8000] as const;
const BASE_TARGET = [-1, 0, 0, -2.5, -5, -8, -11, -15];
/** measured against a pro mix of the same song: ours was 3 dB thin at 40-120 Hz, +2 dB at 1-2 kHz, +2.3 dB at 2-4 kHz and 4 dB dull at 8-16 kHz */
const SOUND_MATCH = [3.3, 2, 0, 0, -1.9, -2.3, -2.3, 4.1];
const RAW_TARGET: Record<Genre, number[]> = {
  worship: [-1, 0, 0, -2.5, -5.5, -9, -12, -16],
  imn: [-2, 0, 0, -2, -5, -9, -13, -18],
  cantare: [-2, 0, 0, -2.5, -4.5, -7.5, -10.5, -14.5],
  pop: BASE_TARGET,
  rock: [0, 0, -0.5, -2.5, -4, -6.5, -9, -13],
  popular: [-2, 0, 0, -2, -4, -7, -10, -14],
};
export const TARGET_CURVE: Record<Genre, number[]> = Object.fromEntries(Object.entries(RAW_TARGET).map(([g, v]) => [g, v.map((x, i) => x + SOUND_MATCH[i])])) as Record<Genre, number[]>;

export interface ExportAudit {
  lufs: number;
  truePeakDb: number;
  clipped: number;
  bands: { hz: number; db: number; target: number; dev: number }[];
  maxDeviationDb: number;
  /** level of 1-4 kHz minus level of 200-400 Hz (dB): high = the vocal band is crowded */
  maskingDb: number;
  taste: TasteReport;
  selfConsistency?: number;
  melodicPitch?: number;
  warnings: AuditWarning[];
}

/** Mean power spectrum (dB per octave band) of the louder parts of a stereo buffer. */
export function bandLevels(ch: Float32Array[], sr: number): number[] {
  const N = 8192;
  const win = hann(N);
  const mono = ch.length > 1 ? ch[0].map((v, i) => (v + ch[1][i]) * 0.5) : ch[0];
  const power = new Float64Array(N / 2 + 1);
  let frames = 0;
  const hop = N * 2;
  const buf = new Float32Array(N);
  for (let s = 0; s + N <= mono.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) { buf[i] = mono[s + i] * win[i]; e += buf[i] * buf[i]; }
    if (e / N < 1e-7) continue; // silence
    const sp = rfft(buf, N);
    for (let k = 0; k <= N / 2; k++) power[k] += sp[2 * k] * sp[2 * k] + sp[2 * k + 1] * sp[2 * k + 1];
    frames++;
  }
  const out: number[] = [];
  for (const c of BANDS) {
    const lo = c / Math.SQRT2, hi = c * Math.SQRT2;
    let sum = 0;
    for (let k = Math.max(1, Math.floor((lo * N) / sr)); k <= Math.min(N / 2, Math.ceil((hi * N) / sr)); k++) sum += power[k];
    out.push(10 * Math.log10(Math.max(1e-20, sum / Math.max(1, frames))));
  }
  return out;
}

export interface AuditInput {
  ch: Float32Array[]; sr: number; lufs: number; truePeakDb: number;
  arr: Arrangement; bpm: number; beats: number; genre: Genre; vocal?: boolean;
  selfConsistency?: number; melodicPitch?: number;
}

export function auditExport(a: AuditInput): ExportAudit {
  let clipped = 0;
  for (const c of a.ch) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.9995) clipped++;
  const levels = bandLevels(a.ch, a.sr);
  const ref = (levels[1] + levels[2] + levels[3]) / 3;
  const target = TARGET_CURVE[a.genre];
  const bands = BANDS.map((hz, i) => ({ hz, db: levels[i] - ref, target: target[i], dev: levels[i] - ref - target[i] }));
  const maxDev = Math.max(...bands.map((b) => Math.abs(b.dev)));
  const maskingDb = (levels[4] + levels[5]) / 2 - levels[2];
  const taste = tasteAudit(a.arr, a.bpm, a.beats);
  const w: AuditWarning[] = [];
  if (a.lufs < -20) w.push({ id: 'loudLow', level: 'warn' });
  if (a.lufs > -9) w.push({ id: 'loudHigh', level: 'warn' });
  if (a.truePeakDb > -0.9) w.push({ id: 'truePeak', level: 'warn' });
  if (clipped > 0) w.push({ id: 'clipping', level: 'warn' });
  const hf = (bands[5].dev + bands[6].dev + bands[7].dev) / 3;
  if (hf < -6) w.push({ id: 'dark', level: 'info' });
  if (hf > 5) w.push({ id: 'bright', level: 'info' });
  if (bands[2].dev > 5 || bands[3].dev > 5) w.push({ id: 'muddy', level: 'warn' });
  if (bands[0].dev < -9 && bands[1].dev < -6) w.push({ id: 'thin', level: 'info' });
  if (!a.vocal && maskingDb > -7) w.push({ id: 'masking', level: 'info' });
  for (const id of taste.warnings) w.push({ id: id as AuditId, level: id === 'tooMany' ? 'warn' : 'info' });
  const dens = Math.max(0, ...taste.perSection.map((s) => s.density));
  if (dens > 28) w.push({ id: 'dense', level: 'info' });
  if (a.selfConsistency !== undefined && a.selfConsistency < 0.95) w.push({ id: 'selfLow', level: 'warn' });
  if (a.melodicPitch !== undefined && a.melodicPitch < 0.98) w.push({ id: 'pitchLow', level: 'warn' });
  return { lufs: a.lufs, truePeakDb: a.truePeakDb, clipped, bands, maxDeviationDb: maxDev, maskingDb, taste, selfConsistency: a.selfConsistency, melodicPitch: a.melodicPitch, warnings: w };
}
