import { describe, expect, it } from 'vitest';
import { formFromVocal } from './formFromVocal';
import type { OnsetIn } from './meter';

const BAR = 2.8;
const PA = [67, 62, 67, 70, 69, 67, 65, 62];       // strofă phrase (one note per half bar)
const PA2 = [67, 62, 67, 70, 69, 65, 64, 62];      // answer: similar
const PB = [70, 72, 72, 72, 70, 69, 67, 69];       // refren phrase: new material

/** one 4-bar phrase starting at bar `bar`: 8 notes (half-bar each, last note ends early) */
function phrase(bar: number, pitches: number[], t0: number): OnsetIn[] {
  const out: OnsetIn[] = [];
  for (let i = 0; i < 16; i++) out.push({ startSec: t0 + bar * BAR + i * (BAR / 4), durSec: BAR / 4 * 0.8, midi: pitches[Math.floor(i / 2)] + (i % 2 ? 0 : 0), velocity: 0.7 });
  return out;
}

describe('form from a full-song vocal', () => {
  it('finds intro, strofă, refren, interlude, strofă, refren, bridge, strofă, refren, outro on the original timeline', () => {
    const t0 = 1.0;
    const notes: OnsetIn[] = [];
    let bar = 8; // 8-bar intro
    const block = () => {
      notes.push(...phrase(bar, PA, t0), ...phrase(bar + 4, PA2, t0), ...phrase(bar + 8, PB, t0), ...phrase(bar + 12, PB, t0));
      bar += 16;
    };
    block(); bar += 1; // 1-bar interlude
    block(); bar += 8; // 8-bar bridge
    block();
    const total = t0 + (bar + 4) * BAR;
    const f = formFromVocal(notes, BAR, t0, total)!;
    const seq = f.sections.map((s) => `${s.type}${s.bars}`).join(' ');
    expect(seq).toBe('intro8 strofa8 refren8 interlude1 strofa8 refren8 bridge8 strofa8 refren8 outro4');
    expect(f.sections[1].startSec).toBeCloseTo(t0 + 8 * BAR, 3);
    expect(f.sections.filter((s) => s.vocal).length).toBe(6);
  });
});
