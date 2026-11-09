import { describe, expect, it } from 'vitest';
import { buildNoiseProfile, cleanAudio, highpass } from './clean';
import { addNoise, makeMelody, makeNoise, mulberry32, renderVoice, rmsOver, type GtNote } from './synth';
import { analyze } from './analyze';

const SR = 44100;
const db = (v: number) => 20 * Math.log10(v + 1e-12);

/** rest-region RMS (noise floor) and voiced-region RMS */
function levels(x: Float32Array, gt: GtNote[]) {
  const voiced: number[] = [], rest: number[] = [];
  let s = 0, c = 0, rs = 0, rc = 0;
  const flag = new Uint8Array(x.length);
  for (const n of gt) {
    const a = Math.floor((n.start + 0.08) * SR), b = Math.min(x.length, Math.floor((n.start + n.dur - 0.05) * SR));
    for (let i = a; i < b; i++) flag[i] = 1;
  }
  for (const n of gt) void n;
  // rests: >120 ms away from any note
  const near = new Uint8Array(x.length);
  for (const n of gt) {
    const a = Math.max(0, Math.floor((n.start - 0.15) * SR)), b = Math.min(x.length, Math.floor((n.start + n.dur + 0.2) * SR));
    for (let i = a; i < b; i++) near[i] = 1;
  }
  for (let i = 0; i < x.length; i++) {
    if (flag[i]) { s += x[i] * x[i]; c++; }
    else if (!near[i]) { rs += x[i] * x[i]; rc++; }
  }
  void voiced; void rest;
  return { voiced: Math.sqrt(s / c), rest: Math.sqrt(rs / Math.max(1, rc)) };
}

function snrWithRef(out: Float32Array, ref: Float32Array, gt: GtNote[]) {
  let num = 0, den = 0, rr = 0;
  const idx: number[] = [];
  for (const n of gt) {
    const a = Math.floor((n.start + 0.08) * SR), b = Math.min(out.length, Math.floor((n.start + n.dur - 0.05) * SR));
    for (let i = a; i < b; i++) idx.push(i);
  }
  for (const i of idx) { num += out[i] * ref[i]; rr += ref[i] * ref[i]; }
  const g = num / rr;
  for (const i of idx) den += (out[i] - g * ref[i]) ** 2;
  return db(Math.sqrt((g * g * rr) / den));
}

for (const kind of ['white', 'pink'] as const) {
  describe(`cleaning (${kind} noise, 20 dB SNR)`, () => {
    const gt = makeMelody(mulberry32(31), { tonic: 0, mode: 'major' }, 90, 20);
    const voice = renderVoice(gt, { sr: SR, vibratoCents: 35, seed: 3, totalSec: 22 });
    const noisy = addNoise(voice, gt, SR, 20, kind, 44);
    // 2 s room tone with the same kind of noise (profile capture)
    const noiseOnlyScale = rmsOver(noisy.subarray(0, Math.floor(0.25 * SR)));
    const room = makeNoise(2 * SR, kind, 99);
    const rScale = noiseOnlyScale / rmsOver(room);
    for (let i = 0; i < room.length; i++) room[i] *= rScale;

    it('drops noise floor >= 15 dB, improves voiced SNR, does not clip', () => {
      const profile = buildNoiseProfile(room, SR);
      const res = cleanAudio(noisy, SR, profile);
      const before = levels(noisy, gt), after = levels(res.audio, gt);
      const floorDrop = db(before.voiced / before.rest) * -1 + db(after.voiced / after.rest);
      const refHp = highpass(voice, SR, 80);
      const snrBefore = snrWithRef(highpass(noisy, SR, 80), refHp, gt);
      const snrAfter = snrWithRef(res.audio, refHp, gt);
      let peak = 0;
      for (const v of res.audio) peak = Math.max(peak, Math.abs(v));
      console.log(`${kind}: noise-floor drop ${floorDrop.toFixed(1)} dB (rel. to voice) | voiced SNR ${snrBefore.toFixed(1)} -> ${snrAfter.toFixed(1)} dB | peak ${peak.toFixed(2)} | voiced RMS ${db(after.voiced).toFixed(1)} dBFS`);
      expect(floorDrop).toBeGreaterThanOrEqual(15);
      expect(snrAfter).toBeGreaterThan(snrBefore);
      expect(peak).toBeLessThan(1);
      expect(res.audio.length).toBe(noisy.length); // timing kept (no trimming)
    });

    it('works without a room-tone profile (quietest-frames fallback) and keeps analysis accurate', () => {
      const res = cleanAudio(noisy, SR, null);
      const before = levels(noisy, gt), after = levels(res.audio, gt);
      const floorDrop = -db(before.voiced / before.rest) + db(after.voiced / after.rest);
      expect(floorDrop).toBeGreaterThanOrEqual(15);
      const a = analyze(res.audio, SR, 90);
      let ok = 0;
      for (const g of gt) if (a.notes.some((n) => n.midi === g.midi && Math.abs(n.startSec - g.start) <= 0.05)) ok++;
      console.log(`${kind}: clean->analyze ${ok}/${gt.length}`);
      expect(ok / gt.length).toBeGreaterThanOrEqual(0.9);
    });
  });
}

describe('click removal', () => {
  it('repairs an injected click without touching the signal', () => {
    const gt = makeMelody(mulberry32(5), { tonic: 0, mode: 'major' }, 90, 6);
    const v = renderVoice(gt, { sr: SR, seed: 2 });
    const spiked = new Float32Array(v);
    spiked[20000] += 0.8; spiked[20001] -= 0.6;
    const res = cleanAudio(spiked, SR, null);
    expect(res.clicks).toBeGreaterThanOrEqual(1);
    let peak = 0;
    for (let i = 19990; i < 20010; i++) peak = Math.max(peak, Math.abs(res.audio[i]));
    expect(peak).toBeLessThan(0.7);
  });
});
