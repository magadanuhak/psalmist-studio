import { describe, expect, it } from 'vitest';
import { PitchSmoother, holdExercise, intervalExercise, scaleExercise, scoreAttempt, type PitchSample, type Target } from './trainer';

const C = { tonic: 0, mode: 'major' as const };
/** perfect singing of the targets, 20 ms frames, with an optional cents offset */
const sing = (targets: Target[], offCents = 0): PitchSample[] => {
  const out: PitchSample[] = [];
  const end = Math.max(...targets.map((t) => t.startSec + t.durSec));
  for (let t = 0; t < end; t += 0.02) { const tg = targets.find((x) => t >= x.startSec && t < x.startSec + x.durSec); out.push({ t, midi: tg ? tg.midi + offCents / 100 : null }); }
  return out;
};

describe('trainer exercises', () => {
  it('a hold is one note for the given time', () => {
    expect(holdExercise(60, 4).targets).toEqual([{ midi: 60, startSec: 0, durSec: 4 }]);
  });
  it('C major scale from C4: up 8 notes then back down, 15 notes, all in key', () => {
    expect(scaleExercise(C, 60).targets.map((x) => x.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
    const g = scaleExercise({ tonic: 9, mode: 'minor' }, 57);
    expect(g.targets[0].midi % 12).toBe(9);
    expect(g.targets.every((x) => [9, 11, 0, 2, 4, 5, 7, 8, 10].includes(x.midi % 12))).toBe(true);
  });
  it('intervals alternate root and target at the exact distance', () => {
    const e = intervalExercise(55, 7, 1, 3);
    for (let i = 0; i < e.targets.length; i += 2) expect(e.targets[i + 1].midi - e.targets[i].midi).toBe(7);
    expect(intervalExercise(60, 4, -1, 2).targets[1].midi).toBe(56);
  });
});

describe('deterministic scoring', () => {
  const ex = scaleExercise(C, 60);
  it('perfect singing scores about 100 and 3 stars', () => {
    const s = scoreAttempt(ex.targets, sing(ex.targets));
    expect(s.total).toBeGreaterThanOrEqual(95);
    expect(s.stars).toBe(3);
  });
  it('30 cents flat still passes; 80 cents flat fails', () => {
    expect(scoreAttempt(ex.targets, sing(ex.targets, -30)).total).toBeGreaterThanOrEqual(95);
    expect(scoreAttempt(ex.targets, sing(ex.targets, -80)).total).toBeLessThan(10);
  });
  it('silence scores 0; half the song sung scores about half', () => {
    expect(scoreAttempt(ex.targets, []).total).toBe(0);
    const half = scoreAttempt(ex.targets, sing(ex.targets).filter((x) => x.t < ex.totalSec / 2));
    expect(half.total).toBeGreaterThan(35);
    expect(half.total).toBeLessThan(65);
  });
  it('an octave away counts by default and not when octaveFree is off', () => {
    const up = sing(ex.targets).map((x) => ({ ...x, midi: x.midi == null ? null : x.midi + 12 }));
    expect(scoreAttempt(ex.targets, up).total).toBeGreaterThan(90);
    expect(scoreAttempt(ex.targets, up, { octaveFree: false }).total).toBe(0);
  });
  it('same input, same score', () => {
    expect(scoreAttempt(ex.targets, sing(ex.targets, 12))).toEqual(scoreAttempt(ex.targets, sing(ex.targets, 12)));
  });
  it('microphone latency can be compensated', () => {
    const late = sing(ex.targets).map((x) => ({ ...x, t: x.t + 0.08 }));
    expect(scoreAttempt(ex.targets, late, { latencySec: 0.08 }).total).toBeGreaterThanOrEqual(95);
  });
});

describe('pitch smoother', () => {
  it('drops a single outlier frame', () => {
    const s = new PitchSmoother(3);
    expect([60, 60, 72, 60].map((m) => s.push(m))).toEqual([60, 60, 60, 60]);
    expect(new PitchSmoother(3).push(null)).toBeNull();
  });
});
