import type { QuantGrid, TimeSig } from '../model/types';

export interface TimeSigPreset { id: string; label: string; sig: TimeSig }

/** grouping = beats per accent group (in units of the denominator note). */
export const TIME_SIGS: TimeSigPreset[] = [
  { id: '4/4', label: '4/4', sig: { num: 4, den: 4, grouping: [4] } },
  { id: '3/4', label: '3/4', sig: { num: 3, den: 4, grouping: [3] } },
  { id: '6/8', label: '6/8', sig: { num: 6, den: 8, grouping: [3, 3] } },
  { id: '2/4', label: '2/4', sig: { num: 2, den: 4, grouping: [2] } },
  { id: '7/8a', label: '7/8 (3+2+2)', sig: { num: 7, den: 8, grouping: [3, 2, 2] } },
  { id: '7/8b', label: '7/8 (2+2+3)', sig: { num: 7, den: 8, grouping: [2, 2, 3] } },
  { id: '5/8', label: '5/8 (3+2)', sig: { num: 5, den: 8, grouping: [3, 2] } },
  { id: '9/8', label: '9/8 (2+2+2+3)', sig: { num: 9, den: 8, grouping: [2, 2, 2, 3] } },
  { id: '12/8', label: '12/8 (compus: 4 × 3)', sig: { num: 12, den: 8, grouping: [3, 3, 3, 3] } },
];

export function timeSigId(s: TimeSig): string {
  const hit = TIME_SIGS.find((t) => t.sig.num === s.num && t.sig.den === s.den && t.sig.grouping.join() === s.grouping.join());
  return hit?.id ?? `${s.num}/${s.den}`;
}

/** BPM of the felt beat: in compound meters (6/8, 12/8) the beat is the dotted quarter = 3 pulses. Analysis thresholds (note merging, snapping) are written for that beat. */
export const feltBpm = (bpm: number, s: TimeSig) => (s.den === 8 && s.grouping.length > 0 && s.grouping.every((g) => g === 3) ? bpm / 3 : bpm);

/** BPM = pulses (denominator notes) per minute. */
export const beatSec = (bpm: number) => 60 / bpm;
export const barSec = (bpm: number, s: TimeSig) => beatSec(bpm) * s.num;

const GRID_QUARTERS: Record<QuantGrid, number> = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/8T': 1 / 3 };
export function gridSec(bpm: number, s: TimeSig, g: QuantGrid): number {
  // beat = (4/den) quarter notes
  return beatSec(bpm) * (GRID_QUARTERS[g] * s.den) / 4;
}

/** Click pattern for one bar: 'accent' on beat 1, 'sub' on grouping starts, 'beat' otherwise. */
export function barClicks(s: TimeSig): ('accent' | 'sub' | 'beat')[] {
  const out: ('accent' | 'sub' | 'beat')[] = [];
  let pos = 0;
  for (const g of s.grouping) {
    for (let i = 0; i < g; i++) out.push(pos === 0 && i === 0 ? 'accent' : i === 0 ? 'sub' : 'beat');
    pos += g;
  }
  while (out.length < s.num) out.push('beat');
  return out.slice(0, s.num);
}

export function tapTempo(taps: number[]): number | null {
  if (taps.length < 3) return null;
  const recent = taps.slice(-8);
  const ivs: number[] = [];
  for (let i = 1; i < recent.length; i++) ivs.push(recent[i] - recent[i - 1]);
  ivs.sort((a, b) => a - b);
  const med = ivs[Math.floor(ivs.length / 2)];
  const bpm = 60000 / med;
  return bpm >= 30 && bpm <= 240 ? Math.round(bpm) : null;
}
