import { describe, expect, it } from 'vitest';
import { analyze } from '../../dsp/analyze';
import { correctNotes } from '../../dsp/correct';
import { addNoise, renderVoice, type GtNote } from '../../dsp/synth';
import { DEFAULT_CORRECTION, type Project, type Section } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { buildHarmony, harmonyInputFor } from '../../store/harmonyInput';
import { buildBeatMap, chordPcs } from './index';

const SR = 44100;
const sig = TIME_SIGS[0].sig;
const NOM_BPM = 100;
const nom = 60 / NOM_BPM;

/** 8 bars of 4/4 sung with a gradual +-5% tempo drift and a 35 cent global detune. */
function drifting() {
  const prog = [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]];
  const beatTimes: number[] = [0.4];
  const total = 8 * 4;
  for (let b = 0; b < total; b++) beatTimes.push(beatTimes[b] + nom * (1 + 0.05 * Math.sin((2 * Math.PI * b) / 20)));
  const gt: GtNote[] = [];
  const barStarts: number[] = [];
  for (let bar = 0; bar < 8; bar++) {
    const tones = prog[bar % 4];
    barStarts.push(beatTimes[bar * 4]);
    // beat 1: chord tone, beat 2: neighbour, beats 3-4: chord tone (strong beats 1 and 3 are chord tones)
    const chordPitch = (pc: number) => { let m = 60 + pc; while (m > 71) m -= 12; while (m < 60) m += 12; return m; };
    const seq: [number, number, number][] = [ // [beat offset, beats, midi]
      [0, 1.4, chordPitch(tones[0])], [1.5, 0.5, chordPitch(tones[0]) + 2], [2, 1.4, chordPitch(tones[1])], [3, 0.9, chordPitch(tones[2])],
    ];
    for (const [off, beats, midi] of seq) {
      const t0 = beatTimes[bar * 4 + Math.floor(off)] + (off % 1) * (beatTimes[bar * 4 + Math.floor(off) + 1] - beatTimes[bar * 4 + Math.floor(off)]);
      gt.push({ midi: midi > 71 ? midi - 12 : midi, start: t0, dur: beats * nom * 0.92 });
    }
  }
  return { gt, barStarts, beatTimes, prog };
}

describe('timing drift + global detune (real-singer conditions)', () => {
  const { gt, barStarts, prog } = drifting();
  const clean = renderVoice(gt, { sr: SR, vibratoCents: 30, globalCents: 35, seed: 5, totalSec: barStarts[7] + 5 * nom });
  const noisy = addNoise(clean, gt, SR, 22, 'white', 99);
  const analysis = analyze(noisy, SR, NOM_BPM);
  const key = { tonic: 0, mode: 'major' as const };
  const corrected = correctNotes(analysis.notes, key, NOM_BPM, sig, DEFAULT_CORRECTION);

  it('estimates the global tuning offset (+35 cents) and keeps notes on the right semitone', () => {
    console.log('tuning estimate', analysis.tuningCents, 'concentration', analysis.tuningConcentration.toFixed(2));
    expect(Math.abs(analysis.tuningCents - 35)).toBeLessThanOrEqual(10);
    let ok = 0;
    for (const g of gt) if (analysis.notes.some((n) => n.midi === g.midi && Math.abs(n.startSec - g.start) <= 0.08)) ok++;
    console.log(`notes with correct semitone: ${ok}/${gt.length}`);
    expect(ok / gt.length).toBeGreaterThanOrEqual(0.85);
    expect(analysis.keyEstimate?.tonic).toBe(0);
  });

  const sec: Section = {
    id: 's1', type: 'strofa', label: 'S', order: 0, bars: 8, generated: false, activeTakeId: 't1',
    takes: [{
      id: 't1', rawAudioId: 'r', latencyMs: 0, durationSec: noisy.length / SR, createdAt: 0, source: 'import',
      notesOriginal: analysis.notes, notesCorrected: corrected, correction: DEFAULT_CORRECTION, analysis,
    }],
  };
  const p: Project = {
    id: 'p', name: 't', version: 1, genre: 'worship', emotion: 'inchinare', timeSig: sig, bpm: NOM_BPM, key, keyLocked: true,
    sections: [sec], voices: [], createdAt: 0, updatedAt: 0,
  };

  it('beat map follows the drifting voice (<= 15% tempo change, no growing error)', () => {
    const bm = buildBeatMap(analysis.notes.map((n) => n.startSec), NOM_BPM, 32);
    let worst = 0;
    barStarts.forEach((t, bar) => { worst = Math.max(worst, Math.abs(bm.timeOfBeat(bar * 4) - t)); });
    console.log('beat-map worst bar-start error ms:', (worst * 1000).toFixed(0));
    expect(worst).toBeLessThanOrEqual(0.06);
  });

  it('chord changes land within +-60 ms of the vocal note they support; strong-beat chord tones >= 80%', () => {
    const inp = harmonyInputFor(p, sec);
    if (typeof inp === 'string') throw new Error(inp);
    const h = buildHarmony({ ...inp, simplicity: 'bogat' });
    expect(h.slots.length).toBeGreaterThanOrEqual(8); // data-driven harmonic rhythm: 1 or 2 chords per bar
    let worst = 0;
    for (const s of h.slots) {
      if (s.startBeat % 4 !== 0) continue; // chord changes on bar starts must sit on the sung downbeat
      worst = Math.max(worst, Math.abs(s.startSec - barStarts[s.startBeat / 4]));
    }
    console.log('chord-change timing worst error ms:', (worst * 1000).toFixed(0));
    expect(worst).toBeLessThanOrEqual(0.06);
    // strong beats (1 and 3 of each bar) against the harmony of the active variant
    let hit = 0, total = 0;
    gt.forEach((g, k) => {
      const beatInBar = k % 4;
      if (beatInBar !== 0 && beatInBar !== 2) return;
      const slot = h.slots.find((s) => g.start >= s.startSec - 0.05 && g.start < s.startSec + s.durSec - 0.05);
      if (!slot) return;
      total++;
      if (chordPcs(h.variants.A[slot.idx]).includes(g.midi % 12)) hit++;
    });
    console.log(`strong-beat chord tones under drift+detune: ${hit}/${total}`);
    expect(hit / total).toBeGreaterThanOrEqual(0.8);
    void prog;
  });
});
