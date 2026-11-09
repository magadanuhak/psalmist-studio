// Ground-truth blind meter benchmark (fast): the synthetic singer sings each public-domain song, the app's note detector + meter detector
// hear it with NO help, and the meter / feel / tempo must match the known song.
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { detectMeter } from './meter';
import { mainBlockNotes } from './formFromVocal';
import { SONGS, sing } from '../../scripts/benchmarks/singer.mjs';

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

describe('ground-truth blind detection (synthetic singer, no taps)', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    for (const register of ['male', 'female'] as const) {
      it(`${id} (${register}): key, meter + feel, tempo`, () => {
        const { samples, sr } = sing(song, { register, seed: 5 });
        const an = analyze(samples, sr, 90);
        expect(an.keyEstimate?.tonic, 'key tonic').toBe(PC[song.key]);
        expect(an.keyEstimate?.mode === 'major', 'mode').toBe(song.mode === 'major');
        const m = detectMeter({ notes: mainBlockNotes(an.notes) });
        const top = m!.options[0];
        expect(`${top.sig.num}/${top.sig.den}`, 'meter').toBe(song.sig);
        const truth = song.compound ? song.bpm * 3 : song.bpm; // x/8: BPM counts eighths
        expect(Math.abs(top.bpm - truth), `bpm ${top.bpm} vs ${truth}`).toBeLessThanOrEqual(3);
      });
    }
  }
});
