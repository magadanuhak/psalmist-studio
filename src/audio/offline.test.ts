import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { renderSong, masterMix, type RenderInstrument } from './offline';
import { presetFor } from '../dsp/fx';
import { integratedLufs, truePeakDb } from '../dsp/mix';
import { makeMelody, mulberry32, renderVoice } from '../dsp/synth';

const SF = 'public/soundfonts/MuseScore_General.sf3';
const SR = 44100;
const rms = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

describe.skipIf(!existsSync(SF))('X2/X3 offline render (SpessaSynth core + TS mix chain)', () => {
  const sec = 24;
  const notes = (midis: number[], dur: number, vel: number, every: number) =>
    Array.from({ length: Math.floor(sec / every) }, (_, i) => ({ midi: midis[i % midis.length], startSec: i * every, durSec: dur, vel }));
  const inst: RenderInstrument[] = [
    { id: 'pad', name: 'Pad', channel: 0, program: 89, drums: false, pan: 0, bus: 'acc', notes: notes([60, 64, 67], 1.9, 0.6, 2) },
    { id: 'bas', name: 'Bas', channel: 1, program: 33, drums: false, pan: 0, bus: 'acc', notes: notes([36, 43], 0.9, 0.8, 1) },
    { id: 'tobe', name: 'Tobe', channel: 9, program: 0, drums: true, pan: 0, bus: 'acc', notes: notes([36, 42, 38, 42], 0.1, 0.8, 0.5) },
  ];
  const gt = makeMelody(mulberry32(5), { tonic: 0, mode: 'major' }, 90, 20);
  const voice = renderVoice(gt, { sr: SR, vibratoCents: 20, seed: 2 });
  const opts = {
    sampleRate: SR, songSec: sec, levels: { pad: 0.5, bas: 0.7, tobe: 0.6 } as Record<string, number>,
    voice: { clips: [{ data: voice, sr: SR, startSec: 0, durSec: sec }], preset: presetFor('inchinare'), bpm: 90, level: 0.9 },
    wantStems: true,
  };
  let res: Awaited<ReturnType<typeof renderSong>>;
  let ms = 0;
  it('renders all tracks, with stems of the same length', async () => {
    const sf = readFileSync(SF);
    const t0 = performance.now();
    res = await renderSong(sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength), inst, opts);
    ms = performance.now() - t0;
    console.log(`render ${sec}s in ${(ms / 1000).toFixed(1)} s (${(sec / (ms / 1000)).toFixed(1)}x realtime)`);
    expect(res.stems.map((s) => s.id).sort()).toEqual(['bas', 'pad', 'tobe', 'voce']);
    for (const s of res.stems) { expect(s.ch[0].length).toBe(res.mix[0].length); expect(rms(s.ch[0], 0, s.ch[0].length)).toBeGreaterThan(1e-4); }
  }, 300000);
  it('stems sum to the mix (null test residual <= -30 dB, no master limiter)', () => {
    const n = res.mix[0].length;
    let err = 0, ref = 0;
    for (let i = 0; i < n; i++) {
      let sl = 0, sr = 0;
      for (const s of res.stems) { sl += s.ch[0][i]; sr += s.ch[1][i]; }
      err += (sl - res.mix[0][i]) ** 2 + (sr - res.mix[1][i]) ** 2; ref += res.mix[0][i] ** 2 + res.mix[1][i] ** 2;
    }
    const resid = 10 * Math.log10(err / ref + 1e-30);
    console.log('null residual', resid.toFixed(1), 'dB');
    expect(resid).toBeLessThanOrEqual(-30);
  });
  it('master: -14 +- 1 LUFS and true peak <= -1 dBTP', () => {
    const m = masterMix(res).mastered!;
    console.log('mastered', m.lufs.toFixed(2), 'LUFS', m.truePeakDb.toFixed(2), 'dBTP');
    expect(Math.abs(integratedLufs(m.ch, SR) + 14)).toBeLessThanOrEqual(1);
    expect(truePeakDb(m.ch)).toBeLessThanOrEqual(-0.95);
  });
  it('accompaniment is 2-4 dB lower while the voice sings than in pauses', async () => {
    const sf = readFileSync(SF);
    const flat = [{ id: 'pad', name: 'Pad', channel: 0, program: 89, drums: false, pan: 0, bus: 'acc' as const, notes: [{ midi: 60, startSec: 0, durSec: 23, vel: 0.6 }, { midi: 64, startSec: 0, durSec: 23, vel: 0.6 }] }];
    const v = new Float32Array(SR * 12);
    for (let i = 0; i < v.length; i++) { const t = i / SR; if (Math.floor(t / 3) % 2 === 0) v[i] = 0.2 * Math.sin(2 * Math.PI * 200 * t); }
    const r = await renderSong(sf.buffer.slice(sf.byteOffset, sf.byteOffset + sf.byteLength), flat, {
      sampleRate: SR, songSec: 12, levels: { pad: 0.5 }, voice: { clips: [{ data: v, sr: SR, startSec: 0, durSec: 12 }], preset: presetFor('lauda'), bpm: 90, level: 0 }, wantStems: true,
    });
    const pad = r.stems.find((s) => s.id === 'pad')!.ch[0];
    const sung = rms(pad, 1.2 * SR, 2.8 * SR), pause = rms(pad, 4.5 * SR, 5.8 * SR);
    const diff = 20 * Math.log10(pause / sung);
    console.log('measured ducking', diff.toFixed(2), 'dB');
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(4);
  }, 300000);
  it('a 3-minute song renders in < 60 s (extrapolated from the measured speed)', () => {
    const est = (ms / 1000) * (180 / sec);
    console.log('3-min estimate', est.toFixed(1), 's');
    expect(est).toBeLessThan(60);
  });
});
