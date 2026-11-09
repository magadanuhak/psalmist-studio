import * as Tone from 'tone';
import { engine } from './engine';
import type { TimeSig } from '../model/types';
import { barClicks, beatSec } from '../music/timesig';
import { DEFAULT_CLICK, type ClickOpts } from './click';

export type MicErrorKind = 'denied' | 'nodevice' | 'busy' | 'unsupported' | 'other';
export class MicError extends Error {
  constructor(public kind: MicErrorKind, msg: string) { super(msg); }
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage({ t: currentTime, d: ch.slice(0) });
    return true;
  }
}
registerProcessor('psalmist-capture', Capture);`;

export class MicSession {
  private stream!: MediaStream;
  private source!: MediaStreamAudioSourceNode;
  private node!: AudioWorkletNode;
  private analyser!: AnalyserNode;
  private buf!: Float32Array<ArrayBuffer>;
  private chunks: Float32Array[] = [];
  private t0: number | null = null;
  private capturing = false;
  private sink!: GainNode;
  sampleRate = 48000;
  deviceId?: string;

  static async open(deviceId?: string): Promise<MicSession> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported', 'unsupported');
    const s = new MicSession();
    // Resume the audio context first: we are still inside the click gesture here.
    await engine.ensureContext();
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const attempts: MediaStreamConstraints[] = [
      ...(deviceId ? [{ audio: { ...base, deviceId: { exact: deviceId }, channelCount: 1 } }] : []),
      { audio: { ...base, channelCount: 1 } },
      { audio: base },
      { audio: true },
    ];
    let lastErr: unknown = null;
    for (const c of attempts) {
      try { s.stream = await navigator.mediaDevices.getUserMedia(c); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        const name = (e as DOMException).name;
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError' || name === 'AbortError') break;
      }
    }
    if (lastErr || !s.stream) {
      const name = (lastErr as DOMException | null)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied', String(name));
      if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') throw new MicError('nodevice', String(name));
      if (name === 'NotReadableError' || name === 'AbortError') throw new MicError('busy', String(name));
      throw new MicError('other', String(lastErr));
    }
    const ctx = engine.rawContext;
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    s.sampleRate = ctx.sampleRate;
    s.deviceId = s.stream.getAudioTracks()[0]?.getSettings().deviceId;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await Tone.getContext().addAudioWorkletModule(url); } catch (e) { throw new MicError('other', 'worklet: ' + (e instanceof Error ? e.message : String(e))); }
    URL.revokeObjectURL(url);
    s.source = ctx.createMediaStreamSource(s.stream);
    s.analyser = ctx.createAnalyser();
    s.analyser.fftSize = 2048;
    s.buf = new Float32Array(2048);
    s.node = Tone.getContext().createAudioWorkletNode('psalmist-capture', { numberOfInputs: 1, numberOfOutputs: 1 }) as unknown as AudioWorkletNode;
    s.sink = ctx.createGain();
    s.sink.gain.value = 0; // keep worklet pulled without monitoring the mic
    s.node.port.onmessage = (e: MessageEvent<{ t: number; d: Float32Array }>) => {
      if (!s.capturing) return;
      if (s.t0 === null) s.t0 = e.data.t;
      s.chunks.push(e.data.d);
    };
    s.source.connect(s.analyser);
    s.source.connect(s.node);
    s.node.connect(s.sink).connect(ctx.destination);
    return s;
  }

  /** 0..1 input level (RMS, scaled for display). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) + 60) / 54));
  }

  /** the latest 2048 input samples (live pitch of the vocal trainer) and the sample rate */
  frame(): { data: Float32Array; sr: number } {
    this.analyser.getFloatTimeDomainData(this.buf);
    return { data: this.buf, sr: this.sampleRate };
  }

  startCapture() { this.chunks = []; this.t0 = null; this.capturing = true; }

  /** Returns captured samples and the context time of the first captured sample. */
  stopCapture(): { data: Float32Array; t0: number; sr: number } {
    this.capturing = false;
    let n = 0;
    for (const c of this.chunks) n += c.length;
    const data = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { data.set(c, o); o += c.length; }
    this.chunks = [];
    return { data, t0: this.t0 ?? 0, sr: this.sampleRate };
  }

  close() {
    this.capturing = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.node.disconnect(); this.source.disconnect(); this.sink.disconnect(); } catch { /* ignore */ }
  }
}

export type RecPhase = 'countin' | 'recording' | 'paused';
export interface RecordHandle {
  stop(): void;
  pause(): void;
  resume(): void;
  state(): RecPhase | 'stopped';
  done: Promise<{ audio: Float32Array; sr: number }>;
}

interface Seg { gridStart: number; downbeat: number; gridEnd: number }

/**
 * Count-in (1 bar) + metronome, capture from the start of the count-in.
 * Output sample 0 = beat 1 of bar 1 (after latency compensation).
 * Pause keeps the take open: audio up to the start of the bar being sung is kept; Resume plays a 1-bar count-in
 * and continues recording at that same bar. Auto-stops half a bar after the section's last bar.
 */
export function recordSection(opts: {
  session: MicSession; bpm: number; sig: TimeSig; bars: number; latencyMs: number;
  metronome: boolean; volume: number;
  /** sound, accents and subdivision of the click (default: wood, accented, no subdivision) */
  click?: ClickOpts;
  onPhase: (phase: RecPhase, beatInBar: number, bar: number) => void;
}): RecordHandle {
  const { session, bpm, sig, latencyMs } = opts;
  const ctx = engine.rawContext;
  const beat = beatSec(bpm);
  const pattern = barClicks(sig);
  const co = opts.click ?? DEFAULT_CLICK;
  const slot = beat / co.sub;
  const barLen = beat * sig.num;
  const maxGrid = (opts.bars + 0.5) * barLen;
  const segs: Seg[] = [];
  let state: RecPhase | 'stopped' = 'countin';
  let gridStart = 0;
  let segStartAt = ctx.currentTime + 0.25;
  let downbeat = segStartAt + barLen;
  let nextBeat = 0;
  let resolveStop!: () => void;
  const stopPromise = new Promise<void>((r) => { resolveStop = r; });
  session.startCapture();

  const gridNow = () => gridStart + Math.max(0, ctx.currentTime - downbeat);
  const closeSegment = (end: number) => { segs.push({ gridStart, downbeat, gridEnd: Math.max(gridStart, end) }); };

  const pump = setInterval(() => {
    if (state !== 'countin' && state !== 'recording') return;
    while (segStartAt + nextBeat * slot < ctx.currentTime + 0.5) {
      const when = segStartAt + nextBeat * slot;
      const k = Math.floor(nextBeat / co.sub), sl = nextBeat % co.sub;
      if (opts.metronome) engine.tick(sl > 0 ? 'subdiv' : co.accents ? pattern[k % sig.num] : 'beat', when, opts.volume, co.sound);
      const delay = Math.max(0, (when - ctx.currentTime) * 1000);
      const seg = gridStart;
      if (sl === 0) setTimeout(() => {
        if (state !== 'countin' && state !== 'recording') return;
        const inCount = k < sig.num;
        opts.onPhase(inCount ? 'countin' : 'recording', k % sig.num, Math.floor(seg / barLen) + Math.floor(k / sig.num) + (inCount ? 1 : 0));
      }, delay);
      nextBeat++;
    }
    if (state === 'recording' || state === 'countin') {
      if (ctx.currentTime >= downbeat && state === 'countin') state = 'recording';
      if (gridNow() >= maxGrid && ctx.currentTime >= downbeat) { closeSegment(maxGrid); state = 'stopped'; resolveStop(); }
    }
  }, 30);

  const done = (async () => {
    await stopPromise;
    clearInterval(pump);
    await new Promise((r) => setTimeout(r, 150));
    const cap = session.stopCapture();
    const sr = cap.sr;
    const total = Math.max(0, ...segs.map((s) => s.gridEnd));
    const audio = new Float32Array(Math.ceil(total * sr));
    for (const s of segs) {
      const n = Math.round((s.gridEnd - s.gridStart) * sr);
      const from = Math.round((s.downbeat + latencyMs / 1000 - cap.t0) * sr);
      const to = Math.round(s.gridStart * sr);
      for (let i = 0; i < n; i++) {
        const v = cap.data[from + i];
        if (v !== undefined && to + i < audio.length && from + i >= 0) audio[to + i] = v;
      }
    }
    return { audio, sr };
  })();

  return {
    state: () => state,
    stop() {
      if (state === 'stopped') return;
      if (state === 'recording') closeSegment(gridNow());
      else if (state === 'countin') closeSegment(gridStart);
      state = 'stopped';
      resolveStop();
    },
    pause() {
      if (state !== 'recording' && state !== 'countin') return;
      const end = state === 'recording' ? Math.floor(gridNow() / barLen) * barLen : gridStart;
      closeSegment(end);
      gridStart = Math.max(gridStart, end);
      state = 'paused';
      opts.onPhase('paused', 0, Math.floor(gridStart / barLen) + 1);
    },
    resume() {
      if (state !== 'paused') return;
      segStartAt = ctx.currentTime + 0.25;
      downbeat = segStartAt + barLen;
      nextBeat = 0;
      state = 'countin';
    },
    done,
  };
}

/** Plays clicks through the speakers, listens through the mic, returns the median round-trip delay in ms. */
export async function calibrateLatency(session: MicSession): Promise<number> {
  const ctx = engine.rawContext;
  const clicks = 8, gap = 0.5;
  session.startCapture();
  const start = ctx.currentTime + 0.6;
  for (let i = 0; i < clicks; i++) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = 1800; osc.type = 'square';
    g.gain.setValueAtTime(0.9, start + i * gap);
    g.gain.exponentialRampToValueAtTime(0.001, start + i * gap + 0.03);
    osc.connect(g).connect(ctx.destination);
    osc.start(start + i * gap); osc.stop(start + i * gap + 0.04);
  }
  await new Promise((r) => setTimeout(r, (0.6 + clicks * gap + 0.8) * 1000));
  const cap = session.stopCapture();
  const x = cap.data;
  const sr = cap.sr;
  // noise floor
  const abs = Array.from(x, Math.abs).sort((a, b) => a - b);
  const floor = abs[Math.floor(abs.length * 0.5)] || 1e-5;
  const thr = Math.max(floor * 12, 0.01);
  const delays: number[] = [];
  for (let i = 0; i < clicks; i++) {
    const scheduled = (start + i * gap - cap.t0) * sr;
    const a = Math.max(0, Math.floor(scheduled)), b = Math.min(x.length, Math.floor(scheduled + 0.3 * sr));
    for (let k = a; k < b; k++) {
      if (Math.abs(x[k]) > thr) { delays.push(((k - scheduled) / sr) * 1000); break; }
    }
  }
  if (delays.length < clicks / 2) throw new MicError('other', 'nodetect');
  delays.sort((p, q) => p - q);
  return Math.round(delays[Math.floor(delays.length / 2)]);
}
