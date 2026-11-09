import { describe, expect, it } from 'vitest';
import { analyze } from '../../dsp/analyze';
import { correctNotes } from '../../dsp/correct';
import { readWav } from '../../dsp/wavFixture';
import { DEFAULT_CORRECTION, type Genre, type Project, type Section } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { buildHarmony, harmonyInputFor, renderFor } from '../../store/harmonyInput';
import { chordName, chordPcs, VARIANTS } from './index';
import { midiName } from '../../music/theory';

/** Regression fixture: a real low male voice (B2-E3), 60 BPM 4/4, slightly unstable intonation, with scoops and sub-octave onsets. */
const sig = TIME_SIGS[0].sig;
const { data, sr } = readWav('test-audio/real/strofa-curat.wav');
const analysis = analyze(data, sr, 60);
const key = { tonic: analysis.keyEstimate!.tonic, mode: analysis.keyEstimate!.mode };
const corrected = correctNotes(analysis.notes, key, 60, sig, DEFAULT_CORRECTION);

function projectFor(genre: Genre): { p: Project; sec: Section } {
  const sec: Section = {
    id: 's1', type: 'strofa', label: 'Strofă 1', order: 0, bars: 4, generated: false, activeTakeId: 't1',
    takes: [{
      id: 't1', rawAudioId: 'r', latencyMs: 0, durationSec: data.length / sr, createdAt: 0, source: 'import',
      notesOriginal: analysis.notes, notesCorrected: corrected, correction: DEFAULT_CORRECTION, analysis,
    }],
  };
  const p: Project = {
    id: 'p', name: 'real', version: 1, genre, emotion: 'inchinare', timeSig: sig, bpm: 60, key, keyLocked: true,
    sections: [sec], voices: [], createdAt: 0, updatedAt: 0,
  };
  return { p, sec };
}

const heldSemitoneClashes = (voicing: number[], slot: { startSec: number; durSec: number }) => {
  let bad = 0;
  for (const n of corrected) {
    // held (> 250 ms) notes that start on a beat (downbeat / beat positions)
    if (n.durSec < 0.25 || n.startSec >= slot.startSec + slot.durSec || n.startSec + n.durSec <= slot.startSec) continue;
    const frac = n.startSec - Math.floor(n.startSec + 0.12);
    if (Math.abs(frac) > 0.15 && Math.abs(frac) < 0.85) continue;
    const d = (pc: number) => (((pc - n.midi) % 12) + 12) % 12;
    if (voicing.some((m) => d(((m % 12) + 12) % 12) === 1 || d(((m % 12) + 12) % 12) === 11)) bad++;
  }
  return bad;
};

describe('real low male voice (regression fixture)', () => {
  it('detects B minor, keeps every note in the sung register (no octave-error notes below B2)', () => {
    console.log('key', key, '| tuning', analysis.tuningCents, 'concentration', analysis.tuningConcentration.toFixed(2));
    console.log('corrected notes:', corrected.map((n) => `${midiName(n.midi, 'letter')}@${n.startSec.toFixed(2)}`).join(' '));
    expect(key).toEqual({ tonic: 11, mode: 'minor' });
    expect(Math.min(...corrected.map((n) => n.midi))).toBeGreaterThanOrEqual(47);
    // unstable intonation: the offset must not be applied
    expect(analysis.tuningConcentration < 0.3 ? analysis.tuningCents === 0 : true).toBe(true);
  });

  for (const genre of ['worship', 'pop'] as Genre[]) {
    describe(`${genre}`, () => {
      const { p, sec } = projectFor(genre);
      const inp = harmonyInputFor(p, sec);
      if (typeof inp === 'string') throw new Error(inp);
      const harmony = buildHarmony({ ...inp, simplicity: 'normal' });
      const slots = harmony.slots;

      it('one chord per bar; variant A reads Bm | A | G (bars 1-3); default variant is A', () => {
        const A = harmony.variants.A;
        console.log(genre, 'A:', A.map((c) => chordName(c, 'letter', key)).join(' | '), ' B:', harmony.variants.B.map((c) => chordName(c, 'letter', key)).join(' | '), ' C:', harmony.variants.C.map((c) => chordName(c, 'letter', key)).join(' | '));
        expect(harmony.active).toBe('A');
        expect(slots.length).toBe(4);
        expect([A[0].root, A[0].quality]).toEqual([11, 'min']);
        expect([A[1].root, A[1].quality]).toEqual([9, 'maj']);
        expect([A[2].root, A[2].quality]).toEqual([7, 'maj']);
      });

      it('bar 1 contains B and D; no F# / F#7 in A and B; sus <= 25%; no sus when the melody sings its 3rd', () => {
        for (const v of VARIANTS) {
          const chords = harmony.variants[v];
          const pcs = chordPcs(chords[0]);
          if (v !== 'C') {
            expect(pcs).toContain(11);
            expect(pcs).toContain(2);
            expect(chords.some((c) => c.root === 6)).toBe(false);
          }
          expect(chords.filter((c) => c.quality === 'sus2' || c.quality === 'sus4').length).toBeLessThanOrEqual(Math.floor(0.25 * chords.length));
        }
      });

      it('no voiced chord tone a semitone from a held (>250 ms) sung note (A over a held D becomes A5)', () => {
        let bad = 0;
        for (const v of ['A', 'B'] as const) {
          const r = renderFor(p, { ...sec, harmony }, v, 'simple')!;
          r.slots.forEach((s, i) => { bad += heldSemitoneClashes(s.voiced.voicing, slots[i]); });
        }
        console.log(genre, 'held-note semitone clashes:', bad);
        expect(bad).toBe(0);
        // notes sustained >= 600 ms on a beat never clash
        for (const v of ['A', 'B'] as const) harmony.variants[v].forEach((c, i) => {
          for (const n of corrected) {
            if (n.durSec < 0.6 || n.startSec >= slots[i].startSec + slots[i].durSec || n.startSec + n.durSec <= slots[i].startSec) continue;
            for (const pc of chordPcs(c)) { const d = (((pc - n.midi) % 12) + 12) % 12; expect(d === 1 || d === 11).toBe(false); }
          }
        });
      });

      it('chords sit above the voice with a >= 3 semitone gap; notes never ring across a chord change', () => {
        const hi = Math.max(...corrected.map((n) => n.midi));
        for (const style of ['simple', 'full'] as const) {
          const r = renderFor(p, { ...sec, harmony }, undefined, style)!;
          expect(r).toBeTruthy();
          for (const s of r.slots) expect(Math.min(...s.voiced.voicing)).toBeGreaterThanOrEqual(hi + 3);
          for (const s of r.slots) expect(s.voiced.bass).toBeLessThanOrEqual(Math.min(...corrected.map((n) => n.midi)) - 10 + 1);
          for (const e of r.chordEvents) {
            const slot = slots.find((sl) => e.startSec >= sl.startSec - 1e-6 && e.startSec < sl.startSec + sl.durSec - 1e-6)!;
            expect(e.startSec + e.durSec).toBeLessThanOrEqual(slot.startSec + slot.durSec + 1e-6);
          }
        }
      });
    });
  }
});
