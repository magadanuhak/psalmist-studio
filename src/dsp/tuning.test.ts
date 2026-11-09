import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { estimateKey } from './key';
import { addNoise, makeMelody, mulberry32, renderVoice } from './synth';
import { chordName } from '../theory/harmony';

const SR = 44100;

describe('global tuning offset', () => {
  for (const cents of [35, -44, 47]) {
    it(`singer ${cents > 0 ? '+' : ''}${cents} cents off A440: offset estimated, notes stay on the right semitone, key correct`, () => {
      const gt = makeMelody(mulberry32(300 + cents), { tonic: 7, mode: 'major' }, 100, 20);
      const clean = renderVoice(gt, { sr: SR, vibratoCents: 30, globalCents: cents, seed: 4, detuneCents: 8 });
      const a = analyze(addNoise(clean, gt, SR, 22, 'white', 7), SR, 100);
      let ok = 0;
      for (const g of gt) if (a.notes.some((n) => n.midi === g.midi && Math.abs(n.startSec - g.start) <= 0.08)) ok++;
      console.log(`${cents} cents -> estimated ${a.tuningCents} (concentration ${a.tuningConcentration.toFixed(2)}), notes ${ok}/${gt.length}`);
      const diff = ((a.tuningCents - cents + 150) % 100) - 50;
      expect(Math.abs(diff)).toBeLessThanOrEqual(10);
      expect(ok / gt.length).toBeGreaterThanOrEqual(0.88);
      expect(a.keyEstimate?.tonic).toBe(7);
      expect(a.keyEstimate?.mode).toBe('major');
    });
  }
  it('unstable intonation (cents scattered over +-49): no tuning offset is applied', () => {
    const gt = makeMelody(mulberry32(77), { tonic: 0, mode: 'major' }, 90, 60);
    const clean = renderVoice(gt, { sr: SR, vibratoCents: 30, detuneCents: 50, seed: 9 });
    const a = analyze(addNoise(clean, gt, SR, 22, 'white', 3), SR, 90);
    console.log('unstable: concentration', a.tuningConcentration.toFixed(2), 'offset', a.tuningCents);
    expect(a.tuningConcentration).toBeLessThan(0.3);
    expect(a.tuningCents).toBe(0);
  });
});

describe('key confidence: relative major/minor settled by phrase endings', () => {
  const scale = [57, 59, 60, 62, 64, 65, 67]; // A B C D E F G: ambiguous between A minor and C major
  const mk = (endPc: number) => {
    const notes: { midi: number; durSec: number; startSec: number }[] = [];
    let t = 0;
    for (let phrase = 0; phrase < 4; phrase++) {
      for (const m of scale) { notes.push({ midi: m, startSec: t, durSec: 0.4 }); t += 0.45; }
      notes.push({ midi: endPc, startSec: t, durSec: 0.8 }); t += 1.6; // phrase-final note, then a pause
    }
    return notes;
  };
  it('phrase endings on A choose A minor, on C choose C major; both options are offered', () => {
    const a = estimateKey(mk(57), 90)!, c = estimateKey(mk(60), 90)!;
    expect([a.tonic, a.mode]).toEqual([9, 'minor']);
    expect([c.tonic, c.mode]).toEqual([0, 'major']);
    expect(a.top3.some((k) => k.tonic === 9 && k.mode === 'minor')).toBe(true);
    expect(c.top3.some((k) => k.tonic === 9 && k.mode === 'minor')).toBe(true);
  });
});

describe('slash chord spelling', () => {
  it('C#/E# not C#/F; G/B; F#m/C#', () => {
    const key = { tonic: 11, mode: 'minor' as const };
    expect(chordName({ root: 1, quality: 'maj' }, 'letter', key, 5)).toBe('C#/E#');
    expect(chordName({ root: 7, quality: 'maj' }, 'letter', { tonic: 0, mode: 'major' }, 11)).toBe('G/B');
    expect(chordName({ root: 1, quality: 'maj' }, 'ro', key, 5)).toBe('Do#/Mi#');
  });
});
