import type { CorrectionSettings, KeySig, Note, TimeSig } from '../model/types';
import { scalePcs } from '../music/theory';
import { beatSec, feltBpm, gridSec } from '../music/timesig';
import { uid } from '../model/id';

const clone = (n: Note): Note => ({ ...n });

/** Cleanup: delete notes < 60 ms, merge same-pitch fragments separated by < 40 ms. */
export function cleanupNotes(notes: Note[]): Note[] {
  const sorted = notes.map(clone).sort((a, b) => a.startSec - b.startSec);
  const out: Note[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.midi === n.midi && n.startSec - (prev.startSec + prev.durSec) < 0.04) {
      prev.durSec = n.startSec + n.durSec - prev.startSec;
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    out.push(n);
  }
  return out.filter((n) => n.durSec >= 0.06);
}

function nearestScaleMidi(actual: number, pcs: Set<number>): number {
  const base = Math.round(actual);
  let best = base, bd = Infinity;
  for (let d = -2; d <= 2; d++) {
    const m = base + d;
    if (!pcs.has(((m % 12) + 12) % 12)) continue;
    const dist = Math.abs(m - actual);
    if (dist < bd) { bd = dist; best = m; }
  }
  return best;
}

export function snapPitches(notes: Note[], key: KeySig | null, bpm: number): Note[] {
  if (!key) return notes;
  const pcs = scalePcs(key);
  const beat = beatSec(bpm);
  return notes.map((n) => {
    const pc = ((n.midi % 12) + 12) % 12;
    if (pcs.has(pc)) return { ...n, centsDev: 0, isChromaticIntent: false };
    const stable = n.durSec >= beat && Math.abs(n.centsDev) <= 30 && n.confidence >= 0.5;
    if (stable) return { ...n, isChromaticIntent: true };
    return { ...n, midi: nearestScaleMidi(n.midi + n.centsDev / 100, pcs), centsDev: 0, isChromaticIntent: false };
  });
}

function snapTime(t: number, g: number, beat: number, swing: boolean): number {
  if (swing && Math.abs(g - beat / 2) < 1e-6) {
    // swung eighths: positions 0 and 2/3 of each beat
    const k = Math.floor(t / beat);
    const cands = [k * beat, k * beat + (2 / 3) * beat, (k + 1) * beat];
    return cands.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b));
  }
  return Math.round(t / g) * g;
}

export function quantizeNotes(notes: Note[], bpm: number, sig: TimeSig, s: CorrectionSettings): Note[] {
  const strength = Math.max(0, Math.min(1, s.quantizeStrength / 100));
  if (strength === 0) return notes;
  // 12/8: the default eighth grid would be a third of a beat (0.24 s at 85 BPM) and keep grace notes the 4/4 grid removes; quantize to two eighths there
  const compound = sig.den === 8 && sig.num >= 12 && sig.grouping.every((x) => x === 3);
  const g = gridSec(bpm, sig, compound && s.grid === '1/8' ? '1/4' : s.grid);
  const beat = beatSec(bpm);
  const out = notes.map((n) => {
    const st = snapTime(n.startSec, g, beat, s.swing);
    let en = snapTime(n.startSec + n.durSec, g, beat, s.swing);
    if (en <= st) en = st + g;
    const st2 = n.startSec + (st - n.startSec) * strength;
    const en2 = n.startSec + n.durSec + (en - n.startSec - n.durSec) * strength;
    return { ...n, startSec: Math.max(0, st2), durSec: Math.max(0.05, en2 - st2) };
  });
  out.sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i + 1 < out.length; i++) {
    const limit = out[i + 1].startSec - out[i].startSec;
    if (out[i].durSec > limit) out[i].durSec = Math.max(0.03, limit);
  }
  return out;
}

export function correctNotes(
  original: Note[], key: KeySig | null, bpm: number, sig: TimeSig, s: CorrectionSettings,
): Note[] {
  let notes = original.map(clone);
  if (s.cleanup) notes = cleanupNotes(notes);
  if (s.snapToKey) notes = snapPitches(notes, key, feltBpm(bpm, sig));
  notes = quantizeNotes(notes, bpm, sig, s);
  if (s.cleanup) notes = cleanupNotes(notes);
  return notes.map((n) => ({ ...n, id: n.id || uid() }));
}
