import { describe, expect, it } from 'vitest';
import { clickSchedule, renderClicks } from './click';

const s44 = { num: 4, den: 4, grouping: [4] };
const s68 = { num: 6, den: 8, grouping: [3, 3] };

describe('metronome schedule', () => {
  it('subdivision timing: 120 BPM, 4/4, eighths = every 250 ms, accent only on beat 1', () => {
    const ev = clickSchedule(120, s44, 2, { sub: 2, accents: true, sound: 'lemn' });
    expect(ev.length).toBe(16);
    ev.forEach((e, i) => expect(e.t).toBeCloseTo(i * 0.25, 9));
    expect(ev.filter((e) => e.kind === 'accent').map((e) => e.t)).toEqual([0, 2]);
    expect(ev.filter((e) => e.kind === 'subdiv').length).toBe(8);
  });
  it('triplets and sixteenths split the beat evenly; accents off gives flat beats', () => {
    const tri = clickSchedule(90, s44, 1, { sub: 3, accents: false, sound: 'bip' });
    expect(tri.length).toBe(12);
    expect(tri[1].t - tri[0].t).toBeCloseTo(60 / 90 / 3, 9);
    expect(tri.some((e) => e.kind === 'accent')).toBe(false);
    const six = clickSchedule(60, s44, 1, { sub: 4, accents: true, sound: 'rim' });
    expect(six[4].t).toBeCloseTo(1, 9);
  });
  it('6/8 groups its beats 3+3 (accent on 1, group marker on 4)', () => {
    const ev = clickSchedule(180, s68, 1, { sub: 1, accents: true, sound: 'moale' });
    expect(ev.map((e) => e.kind)).toEqual(['accent', 'beat', 'beat', 'sub', 'beat', 'beat']);
  });
  it('renders a click at each scheduled time', () => {
    const sr = 8000, ev = clickSchedule(120, s44, 1);
    const a = renderClicks(ev, sr, 2.2);
    for (const e of ev) expect(Math.max(...a.slice(Math.round(e.t * sr), Math.round(e.t * sr) + 80).map(Math.abs))).toBeGreaterThan(0.1);
    expect(Math.max(...a.slice(Math.round(0.2 * sr), Math.round(0.3 * sr)).map(Math.abs))).toBeLessThan(0.02);
  });
});
