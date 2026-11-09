import { describe, expect, it } from 'vitest';
import { autotune } from './autotune';
import { trackPitch } from './pitch';
import { renderVoice, type GtNote } from './synth';

const sr = 24000;
const key = { tonic: 0, mode: 'major' as const };
// C4 D4 E4 G4 held 1 s each (in key)
const notes: GtNote[] = [60, 62, 64, 67].map((m, i) => ({ midi: m, start: 0.3 + i * 1.1, dur: 1 }));
const hzOf = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const cents = (hz: number, m: number) => 1200 * Math.log2(hz / hzOf(m));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
/** median pitch error (cents) of a held note's steady part */
function heldError(x: Float32Array, n: GtNote) {
  const tr = trackPitch(x, sr);
  const v: number[] = [];
  for (let k = 0; k < tr.hz.length; k++) { const t = k * tr.hopSec; if (t > n.start + 0.35 && t < n.start + n.dur - 0.1 && tr.hz[k] > 0 && tr.voicedProb[k] > 0.5) v.push(cents(tr.hz[k], n.midi)); }
  return v.length ? median(v) : NaN;
}
const onset = (x: Float32Array, from: number) => { const w = Math.round(0.004 * sr); let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i])); for (let i = Math.round(from * sr); i < x.length; i++) { let e = 0; for (let k = 0; k < w; k++) e += Math.abs(x[i + k] ?? 0); if (e / w > 0.25 * peak) return i / sr; } return -1; };

describe('autotune', () => {
  const sharp = renderVoice(notes, { sr, vibratoCents: 0, glideSec: 0.03, detuneCents: 0, globalCents: 38, totalSec: 5 });
  const wobbly = renderVoice(notes, { sr, vibratoCents: 30, vibratoHz: 5.5, glideSec: 0.03, detuneCents: 22, globalCents: -18, totalSec: 5, seed: 4 });

  it('input really is off pitch', () => {
    expect(Math.abs(heldError(sharp, notes[1]))).toBeGreaterThan(25);
  });
  it('held notes land within 10 cents of the scale note (full strength, no vibrato)', () => {
    const r = autotune(sharp, sr, { key, strength: 1, speedMs: 20, keepVibrato: 0, humanize: 0 });
    for (const n of notes) expect(Math.abs(heldError(r.audio, n))).toBeLessThanOrEqual(10);
  });
  it('keeps the vibrato but re-centres the note (within 10 cents of the median)', () => {
    const r = autotune(wobbly, sr, { key, strength: 1, speedMs: 30, keepVibrato: 1, humanize: 0 });
    for (const n of notes) expect(Math.abs(heldError(r.audio, n))).toBeLessThanOrEqual(10);
    const tr = trackPitch(r.audio, sr);
    const v: number[] = [];
    for (let k = 0; k < tr.hz.length; k++) { const t = k * tr.hopSec; if (t > 1.7 && t < 2.2 && tr.hz[k] > 0) v.push(cents(tr.hz[k], 62)); }
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(30); // the vibrato is still there
  });
  it('strength scales the correction and 0 leaves the pitch alone', () => {
    const half = autotune(sharp, sr, { key, strength: 0.5, speedMs: 20, keepVibrato: 0, humanize: 0 });
    const e0 = heldError(sharp, notes[2]), eh = heldError(half.audio, notes[2]);
    expect(Math.abs(eh - e0 / 2)).toBeLessThanOrEqual(10);
    const none = autotune(sharp, sr, { key, strength: 0, speedMs: 20, keepVibrato: 1, humanize: 0 });
    expect(Math.abs(heldError(none.audio, notes[2]) - e0)).toBeLessThanOrEqual(6);
  });
  it('note timing is kept within 5 ms', () => {
    const r = autotune(sharp, sr, { key, strength: 1, speedMs: 20, keepVibrato: 0, humanize: 0 });
    for (const n of notes) expect(Math.abs(onset(r.audio, n.start - 0.1) - onset(sharp, n.start - 0.1))).toBeLessThanOrEqual(0.005);
    expect(r.audio.length).toBe(sharp.length);
  });
});
