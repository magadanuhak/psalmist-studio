import { describe, expect, it } from 'vitest';
import { detectMeter, subdivisionFeel } from './meter';
import { TIME_SIGS } from '../music/timesig';
import { isCompound, COMPOUND_ARP } from '../theory/arrange/patterns';
import { generateArrangement, type ArrangeInput } from '../theory/arrange';
import { buildSectionHarmony } from '../theory/harmony';
import type { Note } from '../model/types';

const BEAT = 60 / 85; // dotted quarter
/** sung line: a note on every beat/3 position with the stress on the beat (12/8 ballad) or on every beat/2 (4/4 simple) */
function sung(triplet: boolean, bars = 12): { startSec: number; durSec: number; midi: number }[] {
  const out: { startSec: number; durSec: number; midi: number }[] = [];
  const sub = triplet ? 3 : 2;
  for (let b = 0; b < bars * 4; b++) for (let k = 0; k < sub; k++) { if (k > 0 && (b + k) % 3 === 0) continue; out.push({ startSec: 1 + b * BEAT + (k * BEAT) / sub, durSec: BEAT / sub * 0.8, midi: 60 + ((b * 3 + k * 2) % 7) }); }
  return out;
}

describe('compound (12/8) feel', () => {
  it('12/8 is a selectable meter with four groups of three eighths', () => {
    const s = TIME_SIGS.find((t) => t.id === '12/8')!.sig;
    expect(s).toEqual({ num: 12, den: 8, grouping: [3, 3, 3, 3] });
    expect(isCompound(s)).toBe(true);
    expect(isCompound(TIME_SIGS.find((t) => t.id === '6/8')!.sig)).toBe(true);
    expect(isCompound(TIME_SIGS.find((t) => t.id === '4/4')!.sig)).toBe(false);
  });
  it('the beat/3 periodicity beats the beat/2 one for a triplet line, and not for straight eighths', () => {
    const f = subdivisionFeel(sung(true).map((n) => n.startSec), BEAT, 1);
    expect(f.compound).toBe(true);
    expect(f.triplet).toBeGreaterThan(f.duple * 1.25);
    expect(subdivisionFeel(sung(false).map((n) => n.startSec), BEAT, 1).compound).toBe(false);
  });
  it('detectMeter offers 12/8 first for a compound line (bpm in eighths = 3 per beat), never for straight eighths', () => {
    const r = detectMeter({ notes: sung(true) })!;
    if (r.options.some((o) => o.id === '12/8')) { expect(r.options[0].id).toBe('12/8'); expect(r.options[0].bpm).toBeGreaterThan(200); }
    const straight = detectMeter({ notes: sung(false) })!;
    expect(straight.options.every((o) => o.id !== '12/8')).toBe(true);
  });
  it('a 12/8 arrangement plays the piano as 1-5-8-10-8-5 groups of three eighths (compound, not straight eighths)', () => {
    const sig = TIME_SIGS.find((t) => t.id === '12/8')!.sig;
    const key = { tonic: 7, mode: 'minor' as const };
    const bpm = 255, bar = 12 * 60 / bpm;
    const notes: Note[] = Array.from({ length: 16 }, (_, i) => ({ id: 'n' + i, midi: 67 + (i % 3), startSec: i * bar / 4, durSec: bar / 4 * 0.8, velocity: 0.7, centsDev: 0, confidence: 1 }));
    const h = buildSectionHarmony({ notes, key, bpm, sig, bars: 4, genre: 'worship', emotion: 'inchinare', sectionType: 'strofa', nextType: null, isLastSection: false });
    const ch = h.variants[h.active];
    const inp: ArrangeInput = { genre: 'worship', emotion: 'inchinare', key, bpm, sig, sections: [{ id: 's', type: 'strofa', label: 's', bars: 4, notes: notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec })), chords: h.slots.map((s, i) => ({ startBeat: s.startBeat, beats: s.beats, chord: ch[i], phraseEnd: s.phraseEnd })) }], energy: { s: 3 } };
    const arr = generateArrangement(inp);
    const piano = arr.tracks.find((t) => t.id === 'pian')!.notes;
    expect(piano.length).toBeGreaterThan(20);
    const eighth = 60 / bpm;
    // arpeggio steps fall on the eighth grid, a new note on (almost) every eighth, and the contour repeats every six eighths
    const bar0 = piano.filter((n) => n.startSec < bar - 1e-6).sort((a, b) => a.startSec - b.startSec);
    const steps = new Set(bar0.map((n) => Math.round(n.startSec / eighth)));
    expect(steps.size).toBeGreaterThanOrEqual(6);
    expect(COMPOUND_ARP).toEqual([0, 1, 2, 3, 2, 1]);
  });
});
