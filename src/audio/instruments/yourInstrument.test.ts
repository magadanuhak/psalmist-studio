import { describe, expect, it } from 'vitest';
import { analyzeNote, buildUserInstrument, guidedNotes, memoryStore, prepareSample, userCatalogEntry, userInstrumentToSampler, userManifest, USER_SR } from './yourInstrument';
import { pickSample, SampleInstrument } from './sampler';
import { noteNameRo } from './strings.ro';

const SR = 44100;
/** Synthetic instrument note: harmonic tone with a plucked/bowed envelope, optionally slightly detuned. */
function tone(midi: number, sec: number, o: { cents?: number; sustain?: boolean; sr?: number; amp?: number } = {}): Float32Array {
  const sr = o.sr ?? SR; const n = Math.floor(sec * sr); const f = 440 * Math.pow(2, (midi - 69 + (o.cents ?? 0) / 100) / 12); const x = new Float32Array(n);
  const lead = Math.floor(0.12 * sr); // some silence before the note
  for (let i = lead; i < n; i++) {
    const t = (i - lead) / sr; const env = (o.sustain === false ? Math.exp(-t * 3) : 1 - Math.exp(-t * 40)) * Math.min(1, (n - i) / (0.05 * sr));
    let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    x[i] = (o.amp ?? 0.5) * env * v;
  }
  return x;
}
function noise(sec: number): Float32Array { const x = new Float32Array(Math.floor(sec * SR)); let s = 1; for (let i = 0; i < x.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = ((s / 4294967296) - 0.5) * 0.4; } return x; }

/** Minimal Web Audio stand-in so SampleInstrument.play can run in node. */
function fakeCtx() {
  const starts: { rate: number; loop: boolean; buf: unknown }[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 0, destination: node(),
    createBufferSource() { const s = { ...node(), buffer: null as unknown, playbackRate: param(), detune: param(), loop: false, loopStart: 0, loopEnd: 0, start() { starts.push({ rate: s.playbackRate.value, loop: s.loop, buf: s.buffer }); }, stop() {} }; return s; },
    createGain() { return { ...node(), gain: param() }; },
    createStereoPanner() { return { ...node(), pan: param() }; },
    createBuffer(ch: number, len: number, sr: number) { const d = new Float32Array(len); return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, copyToChannel(a: Float32Array) { d.set(a); }, getChannelData() { return d; } }; },
  };
  return { ctx: ctx as unknown as BaseAudioContext, starts };
}

describe('Instrumentul tau (user instrument)', () => {
  const targets = [55, 60, 64, 67, 72];
  it('labels single notes with the pitch tracker (midi + residual cents)', () => {
    for (const m of [48, 60, 72, 79]) { const a = analyzeNote(tone(m, 1.4, { cents: 12 }), SR)!; expect(a).toBeTruthy(); expect(a.midi).toBe(m); expect(a.cents).toBeGreaterThan(5); expect(a.cents).toBeLessThan(20); expect(a.confidence).toBeGreaterThan(0.6); }
    expect(analyzeNote(noise(1.5), SR)).toBeNull();
    expect(analyzeNote(new Float32Array(100), SR)).toBeNull();
  });
  it('prepares samples: trims leading silence, loops sustained notes, lets plucked notes decay', () => {
    const s = prepareSample(tone(60, 2.5), SR)!;
    expect(s.sustained).toBe(true); expect(s.loopStart!).toBeGreaterThan(0.4); expect(s.loopEnd!).toBeCloseTo(s.dur, 3);
    expect(s.data.length / USER_SR).toBeLessThan(2.5 - 0.08); // leading silence removed
    const p = prepareSample(tone(60, 2.5, { sustain: false }), SR)!; expect(p.sustained).toBe(false); expect(p.loopStart).toBeUndefined();
    expect(prepareSample(new Float32Array(SR), SR)).toBeNull();
    const r = prepareSample(tone(64, 1.5, { sr: 22050 }), 22050)!; expect(r.data.length / USER_SR).toBeGreaterThan(1.0); // resampled to 44.1k
  });
  it('builds a playable instrument end to end from a synthetic note set (+ bad takes reported)', () => {
    const rec = [
      ...targets.map((m, i) => ({ audio: tone(m, 2.2, { cents: i * 3 - 6, amp: 0.2 + i * 0.1 }), sampleRate: SR })),
      { audio: noise(1.5), sampleRate: SR },                       // no pitch
      { audio: tone(60, 0.2), sampleRate: SR },                    // too short
      { audio: tone(64, 1.5, { amp: 0.001 }), sampleRate: SR },    // too quiet
      { audio: tone(67, 1.2), sampleRate: SR },                    // duplicate pitch (shorter -> loses)
    ];
    const { instrument, report } = buildUserInstrument(rec, { name: 'Vioara mea', id: 'abc', now: 1 });
    expect(instrument).toBeTruthy(); const ui = instrument!;
    expect(ui.samples.map((s) => s.key)).toEqual(targets); expect(ui.range).toEqual([55, 72]);
    expect(report.rejected.map((r) => r.reason).sort()).toEqual(['duplicate', 'noPitch', 'tooQuiet', 'tooShort']);
    ui.samples.forEach((s) => { let pk = 0, e = 0; for (const v of s.data) { pk = Math.max(pk, Math.abs(v)); e += v * v; } expect(pk).toBeLessThanOrEqual(0.9); expect(pk).toBeGreaterThan(0.2); expect(Math.abs(s.cents)).toBeLessThan(12); expect(s.loopStart).toBeDefined(); expect(e).toBeGreaterThan(0); });
    // loudness is levelled across very different input amplitudes
    const rms = ui.samples.map((s) => Math.sqrt(s.data.slice(0, 26000).reduce((a, v) => a + v * v, 0) / 26000)); expect(Math.max(...rms) / Math.min(...rms)).toBeLessThan(2.2);
    // manifest view + selection reuse the shared sampler logic
    const m = userManifest(ui); expect(m.id).toBe('user:abc'); expect(m.range).toEqual([55, 72]);
    const pk = pickSample(m, undefined, 62, 0.8)!; expect([60, 64]).toContain(pk.sample.key); expect(pk.shift).toBe(62 - pk.sample.key);
    // playback on a (fake) audio context: samples become buffers, notes are scheduled with the right pitch shift and loop
    const { ctx, starts } = fakeCtx(); const inst = userInstrumentToSampler(ctx, ui);
    expect(inst).toBeInstanceOf(SampleInstrument); expect(inst.buffers.size).toBe(targets.length);
    const v = inst.play(62, 0, 1, 0.8)!; expect(v).toBeTruthy(); expect(v.endTime).toBeGreaterThan(1);
    expect(starts).toHaveLength(1); expect(starts[0].loop).toBe(true); expect(starts[0].rate).toBeCloseTo(Math.pow(2, (62 - pk.sample.key) / 12), 5);
    const cat = userCatalogEntry(ui); expect(cat.id).toBe('user:abc'); expect(cat.source).toEqual({ type: 'user', id: 'abc' }); expect(cat.range[0]).toBeLessThan(55);
  });
  it('returns null when nothing usable was recorded', () => {
    const { instrument, report } = buildUserInstrument([{ audio: noise(1), sampleRate: SR }]);
    expect(instrument).toBeNull(); expect(report.rejected).toHaveLength(1);
  });
  it('stores, lists and deletes instruments (store interface; IndexedDB variant shares the contract)', async () => {
    const { instrument } = buildUserInstrument(targets.slice(0, 3).map((m) => ({ audio: tone(m, 1.6), sampleRate: SR })), { id: 'k1', name: 'Test', now: 5 })!;
    const store = memoryStore(); await store.put(instrument!);
    const back = (await store.get('k1'))!; expect(back.samples).toHaveLength(3); expect(back.samples[0].data).toEqual(instrument!.samples[0].data);
    expect(await store.list()).toEqual([{ id: 'k1', name: 'Test', createdAt: 5, range: [55, 64], notes: 3 }]);
    await store.delete('k1'); expect(await store.get('k1')).toBeUndefined(); expect(await store.list()).toEqual([]);
  });
  it('guided prompts and Romanian note names', () => {
    expect(guidedNotes(48, 72)).toEqual([48, 52, 56, 60, 64, 68, 72]); expect(guidedNotes(60, 71).slice(-1)[0]).toBe(71);
    expect(noteNameRo(60)).toBe('Do4'); expect(noteNameRo(67)).toBe('Sol4'); expect(noteNameRo(69)).toBe('La4'); expect(noteNameRo(61)).toBe('Do#4');
  });
});
