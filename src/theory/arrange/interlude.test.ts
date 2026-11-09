import { describe, expect, it } from 'vitest';
import { DEFAULT_QUICK, buildQuickForm, defaultBarsFor, quickBars, quickDefaultsFor } from '../../model/presets';
import { formFromVocal } from '../../dsp/formFromVocal';
import { planSectionChords } from './form';
import { TIME_SIGS } from '../../music/timesig';
import type { ArrSectionInput } from './types';

const sig = TIME_SIGS.find((t) => t.id === '4/4')!.sig;
const sec = (type: ArrSectionInput['type'], bars: number): ArrSectionInput => ({ id: type + bars, type, label: type, bars, notes: [], chords: null });

describe('1-bar interlude and the turnaround prior', () => {
  it('Formă rapidă: the interlude option sits between a refren and the next strofă; default on for cantare only', () => {
    expect(quickDefaultsFor('cantare').interlude).toBe(true);
    expect(quickDefaultsFor('worship').interlude).toBe(false);
    const types = buildQuickForm({ ...DEFAULT_QUICK, strofe: 3, interlude: true });
    expect(types.join(',')).toBe('intro,strofa,refren,interlude,strofa,refren,interlude,strofa,refren,outro');
    expect(buildQuickForm(DEFAULT_QUICK)).not.toContain('interlude');
    const q = { ...DEFAULT_QUICK, interlude: true };
    const bars = quickBars(buildQuickForm(q), q, 90);
    expect(bars[buildQuickForm(q).indexOf('interlude')]).toBe(1);
    expect(defaultBarsFor('interlude', 70)).toBe(1);
  });

  it('a minor-key interlude plays VI then VII (turnaround) and leaves the way to the tonic', () => {
    const plans = planSectionChords([sec('strofa', 4), sec('interlude', 1)], { tonic: 7, mode: 'minor' }, 'cantare', sig);
    const s = plans[1].slots;
    expect(plans[1].chordSource).toBe('generated');
    expect(s).toHaveLength(2);
    expect([s[0].chord.root, s[0].chord.quality]).toEqual([(7 + 8) % 12, 'maj']); // E-flat in G minor
    expect([s[1].chord.root, s[1].chord.quality]).toEqual([(7 + 10) % 12, 'maj']); // F in G minor
    expect(s[0].beats + s[1].beats).toBe(4);
    expect(s[1].phraseEnd).toBe(true);
  });

  it('major keys turn around on IV - V; a longer interlude rests on the tonic first', () => {
    const s = planSectionChords([sec('interlude', 2)], { tonic: 0, mode: 'major' }, 'worship', sig)[0].slots;
    expect(s).toHaveLength(3);
    expect(s[0].chord.root).toBe(0);
    expect([s[1].chord.root, s[2].chord.root]).toEqual([5, 7]);
  });

  it('the vocal form turns a one-bar gap into an interlude and a longer one into a bridge', () => {
    // two sung blocks of 8 bars separated by one empty bar, then another block after 4 empty bars
    const bar = 2.4;
    const block = (start: number) => Array.from({ length: 32 }, (_, i) => ({ startSec: start + i * 0.6, durSec: 0.5, midi: 60 + (i % 5) }));
    const notes = [...block(0), ...block(8 * bar + 1 * bar), ...block(17 * bar + 4 * bar)];
    const f = formFromVocal(notes, bar, 0, 30 * bar + 8 * bar)!;
    const gaps = f.sections.filter((s) => !s.vocal && s.type !== 'intro' && s.type !== 'outro');
    expect(gaps.map((g) => [g.type, g.bars])).toEqual([['interlude', 1], ['bridge', 4]]);
  });
});
