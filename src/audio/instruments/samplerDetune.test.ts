import { describe, expect, it } from 'vitest';
import { SampleInstrument } from './sampler';
import { userInstrumentToSampler, type UserInstrument } from './yourInstrument';

const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
/** an audio context like the wrapped one Tone uses: buffer sources have no `detune` */
function fakeCtx() {
  const made: { playbackRate: { value: number } }[] = [];
  const ctx = {
    currentTime: 0, destination: {},
    createBuffer: (_c: number, n: number, sr: number) => ({ length: n, sampleRate: sr, duration: n / sr, copyToChannel() {} }),
    createGain: () => ({ gain: param(), connect() {} }),
    createBufferSource: () => { const s = { buffer: null, playbackRate: param(), loop: false, loopStart: 0, loopEnd: 0, connect() {}, start() {}, stop() {} }; made.push(s); return s; },
  };
  return { ctx: ctx as unknown as BaseAudioContext, made };
}

describe('sampler without AudioBufferSourceNode.detune', () => {
  it('folds the residual cents of a user sample and the voice tuning into the playback rate', () => {
    const { ctx, made } = fakeCtx();
    const ui: UserInstrument = { id: 'x', name: 'X', createdAt: 0, sampleRate: 44100, range: [60, 60], samples: [{ key: 60, cents: 20, dur: 1, data: new Float32Array(44100) }] };
    const inst: SampleInstrument = userInstrumentToSampler(ctx, ui);
    expect(() => inst.play(60, 0, 0.5, 0.8, { detune: 30 })).not.toThrow();
    // played at the sample's own pitch: shift 0, detune = 30 - 20 cents
    expect(made[0].playbackRate.value).toBeCloseTo(Math.pow(2, 10 / 1200), 6);
  });
});
