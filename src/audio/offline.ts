/** Offline song renderer (X2/X3): SpessaSynth core renders every instrument track dry, the TS vocal chain processes the voice,
 *  then level / pan / ducking / master are applied. Same structure as the realtime mix: tracks, levels, pans, vocal chain, ducking, master. */
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { vocalChain, type VocalPreset } from '../dsp/fx';
import { applyCurve, duckGains, master } from '../dsp/mix';
import { matchAccEq, vocalPocket } from '../dsp/accEq';
import type { ArrNote } from '../theory/arrange/types';

export interface RenderInstrument {
  id: string;
  name: string;
  channel: number;
  program: number;
  drums: boolean;
  /** -1..1 */
  pan: number;
  notes: ArrNote[];
  /** accompaniment bus (ducked under the voice) */
  bus: 'acc' | 'direct';
}
export interface VoiceClipIn { data: Float32Array; sr: number; startSec: number; durSec: number }

export interface RenderOptions {
  sampleRate: number;
  songSec: number;
  /** effective linear level per track id (after mute / solo); missing = 0 */
  levels: Record<string, number>;
  /** extra silence in front (count-in), seconds; every time is shifted by it */
  leadSec?: number;
  voice?: { clips: VoiceClipIn[]; preset: VocalPreset; bpm: number; level: number; pan?: number };
  /** metronome clicks (song time before the lead shift): time + accent */
  clicks?: { t: number; accent: boolean }[];
  clickLevel?: number;
  duckDepthDb?: number;
  tuningCents?: number;
  wantStems?: boolean;
  /** genre target curve (dB per octave band): the accompaniment bus gets a gentle match EQ toward it (Q2); omitted = no EQ */
  balanceTarget?: readonly number[];
  /** sampled / synthesized tracks rendered by `renderExternalBus`: added to the accompaniment bus (ducked with it); `stems` are per-track for the stem export */
  extra?: { ch: [Float32Array, Float32Array]; stems?: Stem[] };
  onProgress?(p: number): void;
  signal?: { aborted: boolean };
}

export interface Stem { id: string; name: string; ch: [Float32Array, Float32Array] }
export interface RenderResult {
  sampleRate: number;
  /** summed bus BEFORE the master chain */
  mix: [Float32Array, Float32Array];
  stems: Stem[];
  mastered?: { ch: Float32Array[]; lufs: number; truePeakDb: number };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** constant-power pan */
const panGains = (pan: number): [number, number] => { const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4; return [Math.cos(a), Math.sin(a)]; };

function clickBurst(sr: number, accent: boolean): Float32Array {
  const n = Math.round(0.025 * sr);
  const f = accent ? 1500 : 1000;
  return Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / sr) * Math.exp(-i / (0.006 * sr)) * (accent ? 0.7 : 0.45));
}

export async function renderSong(sf: ArrayBuffer, inst: RenderInstrument[], o: RenderOptions): Promise<RenderResult> {
  const sr = o.sampleRate;
  const lead = o.leadSec ?? 0;
  const N = Math.ceil((o.songSec + lead + 1.5) * sr);
  const mixL = new Float32Array(N), mixR = new Float32Array(N);
  const stems = new Map<string, Stem>();
  const stemOf = (id: string, name: string): Stem => {
    let s = stems.get(id);
    if (!s) { s = { id, name, ch: [new Float32Array(N), new Float32Array(N)] }; stems.set(id, s); }
    return s;
  };

  // ---------------------------------------------------------------- voice (vocal chain) and ducking curve
  let voiceL: Float32Array | null = null, voiceR: Float32Array | null = null;
  let duck: Float32Array | null = null;
  if (o.voice && o.voice.clips.length) {
    const mono = new Float32Array(N);
    for (const c of o.voice.clips) {
      const src = c.sr === sr ? c.data : resample(c.data, c.sr, sr);
      const off = Math.round((c.startSec + lead) * sr);
      const len = Math.min(src.length, Math.round(c.durSec * sr), N - off);
      for (let i = 0; i < len; i++) mono[off + i] = src[i];
    }
    const [l, r] = vocalChain(mono, sr, o.voice.preset, o.voice.bpm);
    const [gl, gr] = panGains(o.voice.pan ?? 0);
    voiceL = new Float32Array(N); voiceR = new Float32Array(N);
    const lv = o.voice.level;
    for (let i = 0; i < N; i++) { voiceL[i] = l[i] * lv * gl * 1.414; voiceR[i] = r[i] * lv * gr * 1.414; }
    duck = duckGains(mono, sr, o.duckDepthDb ?? 3);
    o.onProgress?.(0.08);
    await tick();
  }

  // ---------------------------------------------------------------- instruments through SpessaSynth core
  const proc = new SpessaSynthProcessor(sr, { enableEventSystem: false, effectsEnabled: false } as never);
  await proc.ready;
  proc.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(sf.slice(0)), 'main');
  for (const ins of inst) {
    const ch = ins.channel;
    proc.controllerChange(ch, 7, 127);
    proc.controllerChange(ch, 10, 64);
    proc.controllerChange(ch, 11, 127);
    proc.controllerChange(ch, 91, 0);
    proc.controllerChange(ch, 93, 0);
    if (!ins.drums) {
      proc.programChange(ch, ins.program);
      const wheel = Math.max(0, Math.min(16383, 8192 + Math.round(((o.tuningCents ?? 0) / 200) * 8192)));
      proc.pitchWheel(ch, wheel);
    }
  }
  type Ev = { at: number; ch: number; note: number; vel: number };
  const evs: Ev[] = [];
  for (const ins of inst) for (const n of ins.notes) {
    const a = Math.round((n.startSec + lead) * sr);
    const b = a + Math.max(64, Math.round((ins.drums ? Math.min(n.durSec, 0.25) : n.durSec) * sr));
    if (a >= N) continue;
    evs.push({ at: a, ch: ins.channel, note: n.midi, vel: Math.max(1, Math.min(127, Math.round(n.vel * 127))) });
    evs.push({ at: Math.min(b, N - 1), ch: ins.channel, note: n.midi, vel: 0 });
  }
  evs.sort((x, y) => x.at - y.at || x.vel - y.vel);

  const byCh = new Map<number, RenderInstrument>(inst.map((x) => [x.channel, x]));
  const gains = new Map<number, [number, number]>();
  for (const ins of inst) { const [gl, gr] = panGains(ins.pan); const lv = o.levels[ins.id] ?? 0; gains.set(ins.channel, [gl * lv * 1.414, gr * lv * 1.414]); }
  const accL = new Float32Array(N), accR = new Float32Array(N);
  const dryL = new Float32Array(N), dryR = new Float32Array(N);
  const chOut: Float32Array[][] = Array.from({ length: 16 }, () => [new Float32Array(128), new Float32Array(128)]);
  const left = new Float32Array(128), right = new Float32Array(128);
  const stemSet = new Map<number, Stem>();
  if (o.wantStems) for (const ins of inst) stemSet.set(ins.channel, stemOf(ins.id, ins.name));

  let pos = 0, ei = 0, lastYield = performance.now();
  while (pos < N) {
    while (ei < evs.length && evs[ei].at <= pos) {
      const e = evs[ei++];
      if (e.vel > 0) proc.noteOn(e.ch, e.note, e.vel); else proc.noteOff(e.ch, e.note);
    }
    const next = ei < evs.length ? evs[ei].at : N;
    const cnt = Math.min(128, N - pos, Math.max(1, next - pos));
    left.fill(0, 0, cnt); right.fill(0, 0, cnt);
    for (const c of chOut) { c[0].fill(0, 0, cnt); c[1].fill(0, 0, cnt); }
    proc.process(left, right, 0, cnt, chOut);
    for (let ch = 0; ch < 16; ch++) {
      const ins = byCh.get(ch);
      if (!ins) continue;
      const [gl, gr] = gains.get(ch)!;
      const [oL, oR] = chOut[ch];
      const st = stemSet.get(ch);
      const tl = ins.bus === 'acc' ? accL : dryL, tr = ins.bus === 'acc' ? accR : dryR;
      for (let i = 0; i < cnt; i++) {
        const m = (oL[i] + oR[i]) * 0.5;
        const l = m * gl, r = m * gr;
        tl[pos + i] += l; tr[pos + i] += r;
        if (st) { st.ch[0][pos + i] += l; st.ch[1][pos + i] += r; }
      }
    }
    pos += cnt;
    if (performance.now() - lastYield > 60) {
      lastYield = performance.now();
      o.onProgress?.(0.1 + 0.75 * (pos / N));
      if (o.signal?.aborted) throw new Error('aborted');
      await tick();
    }
  }

  if (o.extra) {
    const n = Math.min(N, o.extra.ch[0].length);
    for (let i = 0; i < n; i++) { accL[i] += o.extra.ch[0][i]; accR[i] += o.extra.ch[1][i]; }
    if (o.wantStems) for (const s of o.extra.stems ?? []) stems.set(s.id, { id: s.id, name: s.name, ch: [s.ch[0].slice(0, N), s.ch[1].slice(0, N)] });
  }
  if (o.balanceTarget && accL.some((v) => v !== 0)) {
    const eq = matchAccEq(accL, accR, sr, o.balanceTarget);
    accL.set(eq.l); accR.set(eq.r);
  }
  if (duck && o.balanceTarget) {
    const [pl, pr] = vocalPocket(accL, accR, sr, duck);
    accL.set(pl); accR.set(pr);
  }
  const extraIds = new Set((o.extra?.stems ?? []).map((s) => s.id));
  // ---------------------------------------------------------------- ducking of the accompaniment bus, voice, clicks
  if (duck) {
    const dl = applyCurve(accL, sr, duck), dr = applyCurve(accR, sr, duck);
    if (o.wantStems) {
      for (const ins of inst) if (ins.bus === 'acc') {
        const st = stems.get(ins.id)!;
        st.ch[0] = applyCurve(st.ch[0], sr, duck); st.ch[1] = applyCurve(st.ch[1], sr, duck);
      }
      for (const id of extraIds) { const st = stems.get(id); if (st) { st.ch[0] = applyCurve(st.ch[0], sr, duck); st.ch[1] = applyCurve(st.ch[1], sr, duck); } }
    }
    accL.set(dl); accR.set(dr);
  }
  for (let i = 0; i < N; i++) { mixL[i] = accL[i] + dryL[i]; mixR[i] = accR[i] + dryR[i]; }
  if (voiceL && voiceR) {
    for (let i = 0; i < N; i++) { mixL[i] += voiceL[i]; mixR[i] += voiceR[i]; }
    if (o.wantStems) stems.set('voce', { id: 'voce', name: 'Voce', ch: [voiceL, voiceR] });
  }
  if (o.clicks?.length) {
    const cl = o.clickLevel ?? 0.35;
    const ac = clickBurst(sr, true), bt = clickBurst(sr, false);
    const cL = new Float32Array(N);
    for (const k of o.clicks) {
      const a = Math.round((k.t + lead) * sr), b = k.accent ? ac : bt;
      for (let i = 0; i < b.length && a + i < N; i++) cL[a + i] += b[i] * cl;
    }
    for (let i = 0; i < N; i++) { mixL[i] += cL[i]; mixR[i] += cL[i]; }
    if (o.wantStems) stems.set('metro', { id: 'metro', name: 'Metronom', ch: [cL, Float32Array.from(cL)] });
  }
  o.onProgress?.(0.9);
  await tick();
  return { sampleRate: sr, mix: [mixL, mixR], stems: [...stems.values()] };
}

export function masterMix(r: RenderResult, targetLufs = -14): RenderResult {
  const m = master(r.mix, r.sampleRate, targetLufs, -1);
  return { ...r, mastered: m };
}

export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const n = Math.round((x.length * to) / from);
  const y = new Float32Array(n);
  const k = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * k, a = Math.floor(p), f = p - a;
    y[i] = x[a] * (1 - f) + (x[Math.min(a + 1, x.length - 1)] * f);
  }
  return y;
}

/** 24-bit PCM stereo WAV */
export function encodeWav24(ch: Float32Array[], sr: number): ArrayBuffer {
  const n = ch[0].length, nch = ch.length;
  const buf = new ArrayBuffer(44 + n * nch * 3);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nch * 3, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nch * 3, true);
  v.setUint16(32, nch * 3, true); v.setUint16(34, 24, true); w(36, 'data'); v.setUint32(40, n * nch * 3, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) {
    const s = Math.max(-1, Math.min(1, ch[c][i]));
    const q = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
    v.setUint8(o++, q & 255); v.setUint8(o++, (q >> 8) & 255); v.setUint8(o++, (q >> 16) & 255);
  }
  return buf;
}
