import { describe, expect, it } from 'vitest';
import { filterAiNotes } from './aiVariant';
import type { ArrNote, PlanSection } from './types';

const plan: PlanSection[] = [{ id: 's', type: 'strofa', label: 's', bars: 4, startSec: 0, durSec: 8, startBar: 0, energy: 3, chordSource: 'own', active: [], chords: [{ startBeat: 0, beats: 16, startSec: 0, durSec: 8, chord: { root: 0, quality: 'maj' } as never, phraseEnd: false }] }];
const layer = { id: 'pad', name: 'Pad', gm: 89, channel: 1, level: 0.5, pan: 0, reverb: 20 };
const ctx = { key: { tonic: 0, mode: 'major' as const }, plan, vocal: [], range: [48, 72] as [number, number], beatSec: 0.5, beatsPerBar: 4 };
const n = (midi: number, startSec: number, durSec = 1, vel = 0.5): ArrNote => ({ midi, startSec, durSec, vel });

describe('Variantă AI filters', () => {
  it('keeps chord tones, folds octaves into range, drops what cannot fit', () => {
    const r = filterAiNotes([n(60, 0), n(79, 2), n(100, 4, 1), n(64, 6)], layer, ctx);
    expect(r.notes.map((x) => x.midi)).toEqual([60, 67, 64, 64]);
    expect(r.report.folded).toBeGreaterThanOrEqual(1);
    expect(r.notes.every((x) => x.midi >= 48 && x.midi <= 72)).toBe(true);
  });
  it('snaps a strong off-chord note to a chord tone and drops a weak out-of-key one', () => {
    const r = filterAiNotes([n(61, 0, 1), n(61, 1.25, 0.2)], layer, ctx);
    expect(r.report.snapped).toBe(1);
    expect(r.notes[0].midi % 12).toBeOneOf([0, 4, 7]);
    expect(r.report.dropped.outOfKey).toBe(1);
  });
  it('caps density per bar and guards clashes against the voice', () => {
    const many = Array.from({ length: 12 }, (_, i) => n(60, i * 0.15 + 0.01, 0.1, 0.3 + i / 40));
    expect(filterAiNotes(many, layer, { ...ctx, maxPerBar: 4 }).notes.length).toBeLessThanOrEqual(4);
    const r = filterAiNotes([n(60, 0, 2)], layer, { ...ctx, vocal: [{ midi: 61, startSec: 0, durSec: 2 }] });
    expect(r.notes.length).toBe(0);
    expect(r.report.dropped.clash).toBe(1);
  });
});
