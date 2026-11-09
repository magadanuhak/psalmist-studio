import * as Tone from 'tone';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { CLICK_SPEC, type ClickSound } from './click';
import { AudioWorkletNode as SacWorkletNode } from 'standardized-audio-context';
import type { TimeSig } from '../model/types';
import { barClicks, beatSec } from '../music/timesig';
import { t as ro } from '../i18n/ro';
import { articulationsUsed, keepsLowEnd, loadSampled, type UserGetter } from './external';
import { createSynth, type SynthVoice } from './instruments/synth';
import { createChurchReverb, loadImpulse, loadReverbManifest, sendLevel, type ChurchReverb } from './instruments/reverb';
import type { SampleInstrument, Voice } from './instruments/sampler';
import type { CatalogEntry } from './instruments/types';
import { DEFAULT_ACC_EQ, POCKET_DB, POCKET_HZ } from '../dsp/accEq';

const SAMPLE_NOTES = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6'];
const SF_URL = `${import.meta.env.BASE_URL}soundfonts/MuseScore_General.sf3`;
const SF_CACHE = 'psalmist-soundfont-v1';
/** how far ahead (s) notes are handed to the synthesizer; also the time stale events can still sound after a stop */
const AHEAD = 0.14;
const PUMP_MS = 25;

export interface EvNote { midi: number; startSec: number; durSec: number; vel: number; /** articulation id (sampled instruments) */ art?: string; attack?: number }

export interface EngineTrack {
  id: string;
  /** salamander piano sampler, or a General MIDI channel of the SoundFont */
  kind: 'piano' | 'sf' | 'ext';
  /** sampled / synthesized / user instrument played by the engine itself (kind 'ext'); `channel` + `program` are the General MIDI fallback */
  entry?: CatalogEntry;
  channel?: number;
  program?: number;
  drums?: boolean;
  pan?: number;
  reverb?: number;
  /** timeline seconds, sorted by start */
  notes: EvNote[];
}

export interface VoiceClip { data: Float32Array; /** right channel when the clip went through the stereo vocal chain */ right?: Float32Array; sr: number; startSec: number; durSec: number }

export interface PlayRequest {
  from: number;
  to: number;
  loop: boolean;
  clips: VoiceClip[];
  tracks: EngineTrack[];
  bpm: number;
  sig: TimeSig;
  metronome: boolean;
  /** effective linear level 0..1 per track id ('voce', 'metro', ...) after mute / solo */
  levels: Record<string, number>;
  /** ducking curve for the accompaniment bus (100 Hz, linear gain), timeline time */
  duck?: Float32Array;
  /** metronome grid offset (seconds): the first downbeat of the metronome */
  metroOffset?: number;
  /** church reverb space for the sampled and synthesized tracks, and its amount trim */
  space?: string;
  spaceTrim?: number;
  emotion?: string;
}

type Listener = () => void;
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface PianoTrack { sampler: Tone.Sampler; gain: Tone.Gain }
interface Cursor { track: EngineTrack; list: EvNote[]; idx: number }
interface ExtHost { entryId: string; arts: string; sampler?: SampleInstrument; synth?: SynthVoice; gain: Tone.Gain; pan: Tone.Panner; send: GainNode }

class Engine {
  private master: Tone.Limiter | null = null;
  private click: Tone.Synth | null = null;
  private clickGain: Tone.Gain | null = null;
  private voiceGain: Tone.Gain | null = null;
  private pianoBufs: Record<string, Tone.ToneAudioBuffer> | null = null;
  private piano = new Map<string, PianoTrack>();
  private loading: Promise<void> | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private t0 = 0;
  private fromSec = 0;
  private toSec = 0;
  private req: PlayRequest | null = null;
  private cursors: Cursor[] = [];
  private clicks: { t: number; kind: 'accent' | 'sub' | 'beat' }[] = [];
  private clickIdx = 0;
  private levels: Record<string, number> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  playing = false;
  private ext = new Map<string, ExtHost>();
  private extVoices: Voice[] = [];
  private reverb: ChurchReverb | null = null;
  private spaceId = '';
  /** user instruments live in IndexedDB; the store layer installs the loader */
  getUser: UserGetter = async () => undefined;
  /** names of the tracks that fell back to the General MIDI SoundFont because their samples could not be loaded */
  fallbackNames: string[] = [];
  /** 0..1 download progress of the instrument being loaded (null when idle) */
  instrumentLoad: { name: string; progress: number } | null = null;
  /** the singer's global tuning vs A440 in cents; accompaniment is detuned by it ('follow') or kept at 440 while the voice is shifted ('a440') */
  private tuningCents = 0;
  private tuningMode: 'follow' | 'a440' = 'follow';

  /** Tune every instrument to the voice (follow) or pull the voice to A440 (a440). Takes effect for notes scheduled from now on. */
  setTuningCents(cents: number, mode: 'follow' | 'a440' = 'follow') {
    this.tuningCents = Number.isFinite(cents) ? cents : 0;
    this.tuningMode = mode;
    this.applySfTuning();
  }
  /** Tone's wrapped buffer sources may lack `detune`; then the voice cannot be retuned and the instruments follow it instead */
  private detuneFallback = false;
  private instrCents() { return this.tuningMode === 'follow' || this.detuneFallback ? this.tuningCents : 0; }
  /** frequency in Hz of a MIDI pitch including the tuning offset (samplers read the fractional semitone) */
  private pitchHz(midi: number) { return Tone.Frequency(midi + this.instrCents() / 100, 'midi').toFrequency(); }

  sampleState: LoadState = 'idle';
  /** exact failure text (Romanian) when neither piano source could be loaded */
  failure: string | null = null;
  /** General MIDI SoundFont (SpessaSynth) */
  sfState: LoadState = 'idle';
  sfProgress = 0;
  private synth: WorkletSynthesizer | null = null;
  private sfOut: Tone.Gain | null = null;
  private accBus: Tone.Gain | null = null;
  private pocket: Tone.Filter | null = null;
  private sfLoading: Promise<void> | null = null;
  private sfChannels = new Map<number, { level: number; ramp: ReturnType<typeof setInterval> | null }>();
  private staleUntil = 0;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private lastEmit = 0;

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f()); }

  get rawContext(): AudioContext { return Tone.getContext().rawContext as AudioContext; }

  private graphReady = false;

  /** Resume the audio context (must be called inside a user gesture) and build the output graph. Does not wait for samples. */
  async ensureContext(): Promise<void> {
    await Tone.start();
    const raw = this.rawContext;
    if (raw.state !== 'running') { try { await raw.resume(); } catch { /* retried on next gesture */ } }
    this.buildGraph();
  }

  private buildGraph() {
    if (this.graphReady) return;
    this.graphReady = true;
    this.master = new Tone.Limiter(-1).toDestination();
    this.voiceGain = new Tone.Gain(1).connect(this.master);
    this.accBus = new Tone.Gain(1);
    // sound match of the accompaniment bus: octave-band corrections, a vocal pocket (automated while the voice sings) and a little air
    const centres = [62, 125, 250, 500, 1000, 2000, 4000];
    let node: Tone.ToneAudioNode = this.accBus;
    centres.forEach((f, i) => { if (!DEFAULT_ACC_EQ[i]) return; const pk = new Tone.Filter({ type: 'peaking', frequency: f, Q: 1, gain: DEFAULT_ACC_EQ[i] }); node.connect(pk); node = pk; });
    const air = new Tone.Filter({ type: 'highshelf', frequency: 6500, gain: DEFAULT_ACC_EQ[7] }); node.connect(air); node = air;
    this.pocket = new Tone.Filter({ type: 'peaking', frequency: Math.sqrt(POCKET_HZ[0] * POCKET_HZ[1]), Q: 0.7, gain: 0 });
    node.connect(this.pocket); this.pocket.connect(this.master);
    this.sfOut = new Tone.Gain(1).connect(this.accBus);
    this.clickGain = new Tone.Gain(0.5).connect(this.master);
    this.makeClick();
  }

  private tickedUntil = 0;
  private makeClick() {
    this.click = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
    }).connect(this.clickGain!);
  }

  /** Piano samples (Salamander). */
  async ensure(): Promise<void> {
    await this.ensureContext();
    if (this.loading) return this.loading;
    this.sampleState = 'loading';
    this.emit();
    const urls: Record<string, string> = {};
    for (const n of SAMPLE_NOTES) urls[n.replace('s', '#')] = `${n}.mp3`;
    const baseUrl = `${import.meta.env.BASE_URL}samples/`;
    const attempt = () => new Promise<void>((resolve, reject) => {
      const bufs = new Tone.ToneAudioBuffers({
        urls,
        baseUrl,
        onload: () => {
          const shared: Record<string, Tone.ToneAudioBuffer> = {};
          for (const k of Object.keys(urls)) shared[k] = bufs.get(k);
          this.pianoBufs = shared;
          resolve();
        },
        onerror: (e: Error) => reject(e),
      });
    });
    this.loading = (async () => {
      try {
        try { await attempt(); } catch (e1) {
          console.error('[psalmist] Salamander piano samples failed, retrying once:', baseUrl, e1);
          await attempt();
        }
        this.sampleState = 'ready'; this.emit();
      } catch (e2) {
        console.error('[psalmist] Salamander piano samples failed again:', baseUrl, e2);
        this.sampleState = 'error'; this.loading = null; this.emit();
        throw e2;
      }
    })();
    return this.loading;
  }

  private pianoFor(id: string): PianoTrack | null {
    const hit = this.piano.get(id);
    if (hit) return hit;
    if (!this.pianoBufs || !this.master) return null;
    const gain = new Tone.Gain(this.levels[id] ?? 0.8).connect(this.accBus ?? this.master);
    const sampler = new Tone.Sampler({ urls: this.pianoBufs, release: id === 'melodie' ? 1.2 : 0.6 }).connect(gain);
    const pt = { sampler, gain };
    this.piano.set(id, pt);
    return pt;
  }

  bothFailedText = ro.player.bothFailed;

  /** Try the Salamander samples again (after a failure). */
  async retryPiano(): Promise<void> {
    this.loading = null;
    this.failure = null;
    this.sampleState = 'idle';
    this.emit();
    try { await this.ensure(); } catch { /* state shows the error */ }
  }

  // ------------------------------------------------------------------ SoundFont (SpessaSynth)

  /** Lazy-load the General MIDI SoundFont with progress; cached in Cache Storage so it works offline afterwards. */
  loadInstruments(): Promise<void> {
    if (this.sfLoading) return this.sfLoading;
    this.sfState = 'loading';
    this.sfProgress = 0;
    this.emit();
    this.sfLoading = (async () => {
      try {
        this.buildGraph();
        const ctx = this.rawContext;
        await ctx.audioWorklet.addModule(processorUrl);
        const synth = new WorkletSynthesizer(ctx as unknown as BaseAudioContext, {
          audioNodeCreators: {
            worklet: (c, name, options) => new SacWorkletNode!(c as never, name, options as never) as unknown as AudioWorkletNode,
          },
        });
        await synth.isReady;
        const buf = await this.fetchSoundFont((p) => {
          this.sfProgress = p;
          const now = performance.now();
          if (now - this.lastEmit > 120) { this.lastEmit = now; this.emit(); }
        });
        await synth.soundBankManager.addSoundBank(buf, 'main');
        synth.connect((this.sfOut as unknown as { input: AudioNode }).input);
        this.synth = synth;
        this.sfProgress = 1;
        this.sfState = 'ready';
        this.emit();
      } catch (e) {
        this.sfState = 'error';
        this.sfLoading = null;
        this.emit();
        throw e;
      }
    })();
    return this.sfLoading;
  }

  private async fetchSoundFont(onProgress: (p: number) => void): Promise<ArrayBuffer> {
    let cache: Cache | null = null;
    try { cache = 'caches' in globalThis ? await caches.open(SF_CACHE) : null; } catch { cache = null; }
    if (cache) {
      const hit = await cache.match(SF_URL);
      if (hit) { const b = await hit.arrayBuffer(); onProgress(1); return b; }
    }
    const res = await fetch(SF_URL);
    if (!res.ok || !res.body) throw new Error(`soundfont ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 40_000_000;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      onProgress(Math.min(0.99, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    if (cache) { try { await cache.put(SF_URL, new Response(out.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* quota: still works this session */ } }
    return out.buffer;
  }

  /** SoundFont bytes for the offline renderer (from Cache Storage when available) */
  soundFontBytes(): Promise<ArrayBuffer> { return this.fetchSoundFont(() => undefined); }

  private sfLevelValue(l: number) { return Math.max(0, Math.min(127, Math.round(127 * Math.sqrt(Math.max(0, l))))); }

  /** Smooth channel volume (CC7) towards the target: 5 small steps in 40 ms, no clicks. */
  private rampSf(ch: number, target: number) {
    if (!this.synth) return;
    const st = this.sfChannels.get(ch) ?? { level: 100, ramp: null };
    if (st.ramp) clearInterval(st.ramp);
    const from = st.level, to = this.sfLevelValue(target);
    st.level = to;
    this.sfChannels.set(ch, st);
    if (from === to) { st.ramp = null; return; }
    let k = 0;
    const steps = 5;
    st.ramp = setInterval(() => {
      k++;
      const v = Math.round(from + ((to - from) * k) / steps);
      this.synth?.controllerChange(ch, 7, v);
      if (k >= steps && st.ramp) { clearInterval(st.ramp); st.ramp = null; }
    }, 8);
  }

  private applySfTuning() {
    if (!this.synth || !this.req) return;
    const wheel = Math.max(0, Math.min(16383, 8192 + Math.round((this.instrCents() / 200) * 8192)));
    for (const tr of this.req.tracks) if (tr.kind === 'sf' && !tr.drums && tr.channel !== undefined) this.synth.pitchWheel(tr.channel, wheel);
  }

  private prepareSf(tracks: EngineTrack[], levels: Record<string, number>) {
    const s = this.synth;
    if (!s) return;
    for (const tr of tracks) {
      if (tr.kind !== 'sf' || tr.channel === undefined) continue;
      const ch = tr.channel;
      s.programChange(ch, tr.program ?? 0);
      s.controllerChange(ch, 10, Math.round((((tr.pan ?? 0) + 1) / 2) * 127));
      s.controllerChange(ch, 91, tr.reverb ?? 40);
      s.controllerChange(ch, 11, 127);
      s.pitchWheelRange(ch, 2);
      const v = this.sfLevelValue(levels[tr.id] ?? 0.7);
      const st = this.sfChannels.get(ch);
      if (st?.ramp) clearInterval(st.ramp);
      this.sfChannels.set(ch, { level: v, ramp: null });
      s.controllerChange(ch, 7, v);
    }
    this.applySfTuning();
  }

  // ------------------------------------------------------------------ sampled / synthesized / user instruments

  /** (Re)load the church reverb impulse for a space; silent when the files are missing (the dry sound still plays). */
  private async ensureReverb(space: string) {
    if (this.spaceId === space && this.reverb) return;
    try {
      const man = await loadReverbManifest();
      const sp = man.spaces.find((s) => s.id === space) ?? man.spaces[0];
      const buf = await loadImpulse(this.rawContext as unknown as BaseAudioContext, sp);
      if (!this.reverb) {
        this.reverb = createChurchReverb(this.rawContext as unknown as BaseAudioContext, buf, sp.preDelay, 1);
        Tone.connect(this.reverb.output, this.accBus!);
      } else this.reverb.setSpace(buf);
      this.spaceId = space;
    } catch { /* no reverb */ }
  }

  /** Make the host (loaded sampler or synth with its mixer chain) of an 'ext' track. Resolves false when the instrument cannot be loaded. */
  private async prepareExt(track: EngineTrack, space: string, trim: number, emotion?: string): Promise<boolean> {
    const entry = track.entry;
    if (!entry) return false;
    const arts = articulationsUsed(track.notes).sort().join(',');
    const have = this.ext.get(track.id);
    if (have && have.entryId === entry.id && have.arts === arts) { have.send.gain.value = sendLevel(entry.send, space, trim); return true; }
    if (have) { have.gain.dispose(); have.pan.dispose(); this.ext.delete(track.id); }
    try {
      const gain = new Tone.Gain(this.levels[track.id] ?? 0.7);
      const pan = new Tone.Panner(Math.max(-1, Math.min(1, track.pan ?? 0)));
      if (keepsLowEnd(entry)) gain.connect(pan); else { const hp = new Tone.Filter({ type: 'highpass', frequency: 90, Q: 0.7 }); gain.connect(hp); hp.connect(pan); }
      pan.connect(this.accBus!);
      const send = this.rawContext.createGain();
      send.gain.value = sendLevel(entry.send, space, trim);
      Tone.connect(pan, send);
      if (this.reverb) send.connect(this.reverb.input);
      const h: ExtHost = { entryId: entry.id, arts, gain, pan, send };
      if (entry.source.type === 'synth') {
        h.synth = createSynth(entry.source.preset, { emotion });
        h.synth.output.connect(gain);
      } else {
        this.instrumentLoad = { name: entry.name, progress: 0 };
        this.emit();
        h.sampler = await loadSampled(this.rawContext as unknown as BaseAudioContext, entry, articulationsUsed(track.notes), this.getUser, (n, tot) => { this.instrumentLoad = { name: entry.name, progress: tot ? n / tot : 1 }; this.emit(); });
        const inG = this.rawContext.createGain();
        Tone.connect(inG, gain);
        h.sampler.output = inG as unknown as AudioNode;
      }
      this.ext.set(track.id, h);
      return true;
    } catch (e) {
      console.warn('[psalmist] instrument failed, using the SoundFont instead:', entry.id, e);
      return false;
    } finally {
      if (this.instrumentLoad) { this.instrumentLoad = null; this.emit(); }
    }
  }

  private previewHosts = new Map<string, { sampler?: SampleInstrument; synth?: SynthVoice }>();

  /** Audition one note of any catalog instrument (picker): sampled, synthesized, user, Salamander or General MIDI. Resolves false when it cannot sound. */
  async previewInstrument(entry: CatalogEntry, midi: number): Promise<boolean> {
    await this.ensureContext();
    const src = entry.source;
    try {
      if (src.type === 'salamander') { await this.ensure(); this.preview(midi); return true; }
      if (src.type === 'gm' || src.type === 'gm-drums') {
        await this.loadInstruments();
        const s = this.synth!;
        const ch = src.type === 'gm-drums' ? 9 : 15;
        if (src.type === 'gm') { s.programChange(ch, src.program); s.controllerChange(ch, 7, 110); s.controllerChange(ch, 10, 64); }
        const t = this.rawContext.currentTime + 0.05;
        const notes = src.type === 'gm-drums' ? [36, 38, 42, 38] : [midi, midi + 4, midi + 7];
        notes.forEach((m, i) => { s.noteOn(ch, m, 100, { time: t + i * 0.28 }); s.noteOff(ch, m, { time: t + i * 0.28 + (src.type === 'gm-drums' ? 0.12 : 0.4) }); });
        return true;
      }
      let h = this.previewHosts.get(entry.id);
      if (!h) {
        h = {};
        const gain = new Tone.Gain(0.9).connect(this.master!);
        if (src.type === 'synth') { h.synth = createSynth(src.preset); h.synth.output.connect(gain); }
        else {
          h.sampler = await loadSampled(this.rawContext as unknown as BaseAudioContext, entry, [], this.getUser);
          const inG = this.rawContext.createGain(); Tone.connect(inG, gain); h.sampler.output = inG as unknown as AudioNode;
        }
        this.previewHosts.set(entry.id, h);
      }
      const t = this.rawContext.currentTime + 0.05;
      [0, 4, 7].forEach((st, i) => {
        const m = Math.max(entry.range[0], Math.min(entry.range[1], midi + st));
        if (h!.synth) h!.synth.note(m, 0.9, t + i * 0.3, 0.7); else h!.sampler!.play(m, t + i * 0.3, 0.9, 0.75, { detune: this.instrCents() });
      });
      return true;
    } catch (e) {
      console.warn('[psalmist] preview failed', entry.id, e);
      return false;
    }
  }

  // ------------------------------------------------------------------ transport

  /** Single metronome tick (used by recorder count-in). */
  tick(kind: 'accent' | 'sub' | 'beat' | 'subdiv', when: number, vol = 0.5, sound: ClickSound = 'lemn') {
    if (!this.click || !this.clickGain) return;
    this.clickGain.gain.setValueAtTime(vol, when);
    this.tickedUntil = Math.max(this.tickedUntil, when);
    const sp = CLICK_SPEC[sound];
    this.click.triggerAttackRelease(sp[kind], Math.min(0.12, sp.decay + 0.01), when, kind === 'accent' ? 1 : kind === 'subdiv' ? 0.45 : 0.7);
  }

  position(): number {
    if (!this.playing) return this.fromSec;
    const p = this.fromSec + (this.rawContext.currentTime - this.t0);
    return Math.max(this.fromSec, Math.min(p, this.toSec));
  }

  get total(): number { return this.toSec; }
  /** audio-clock time at which timeline position `from` sounds (for aligning a microphone capture) */
  get clock(): { t0: number; from: number } { return { t0: this.t0, from: this.fromSec }; }
  /** voices currently sounding in the SoundFont synth (diagnostics / tests) */
  get sfVoices(): number { return this.synth?.voiceCount ?? 0; }
  /** effective levels as last applied (diagnostics / tests) */
  get currentLevels(): Record<string, number> { return { ...this.levels }; }

  async play(req: PlayRequest): Promise<void> {
    this.stop(false);
    let pianoOk = true;
    try { await this.ensure(); } catch { pianoOk = false; }
    // no Salamander: piano tracks fall back to the SoundFont GM piano (program 0) so playback never blocks
    if (!pianoOk) {
      const used = new Set(req.tracks.filter((t) => t.kind === 'sf').map((t) => t.channel));
      let ch = 0;
      req = {
        ...req,
        tracks: req.tracks.map((t) => {
          if (t.kind !== 'piano') return t;
          while (used.has(ch) || ch === 9) ch++;
          used.add(ch);
          return { ...t, kind: 'sf' as const, channel: ch, program: 0, pan: t.pan ?? 0, reverb: 40 };
        }),
      };
    }
    // sampled / synthesized / user instruments: load them; a failure turns the track into its General MIDI fallback
    this.fallbackNames = [];
    if (req.tracks.some((t) => t.kind === 'ext')) {
      const space = req.space ?? 'biserica', trim = req.spaceTrim ?? 1;
      await this.ensureReverb(space);
      this.levels = { ...req.levels };
      const out: EngineTrack[] = [];
      for (const tr of req.tracks) {
        if (tr.kind !== 'ext') { out.push(tr); continue; }
        if (await this.prepareExt(tr, space, trim, req.emotion)) { out.push(tr); continue; }
        this.fallbackNames.push(tr.entry?.name ?? tr.id);
        const prog = tr.entry?.gmFallback ?? tr.program;
        if (prog !== null && prog !== undefined && tr.channel !== undefined) out.push({ ...tr, kind: 'sf', program: prog, reverb: 60 });
      }
      req = { ...req, tracks: out };
    }
    const needSf = req.tracks.some((t) => t.kind === 'sf');
    if (needSf && this.sfState !== 'error') {
      try { await this.loadInstruments(); } catch { /* sf tracks are dropped below */ }
    }
    // let events queued by a previous stop drain before the new run starts
    const wait = this.staleUntil - this.rawContext.currentTime;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait * 1000 + 10));
    const ready = this.sfState === 'ready' && !!this.synth;
    const tracks = req.tracks.filter((t) => t.kind !== 'sf' || ready);
    if (!pianoOk && !ready) {
      this.failure = this.bothFailedText;
      this.emit();
      throw new Error('piano and soundfont unavailable');
    }
    this.failure = null;
    this.req = { ...req, tracks };
    this.levels = { ...req.levels };
    this.fromSec = req.from;
    this.toSec = req.to;
    this.prepareSf(tracks, req.levels);
    this.applyLevels(req.levels, true);
    this.start();
    this.playing = true;
    this.emit();
    this.timer = setInterval(() => this.pump(), PUMP_MS);
  }

  /** (Re)start the schedule from `fromSec` (also used for loops). */
  private start() {
    const req = this.req!;
    const ctx = this.rawContext;
    for (const [id, h] of this.ext) { h.gain.gain.cancelScheduledValues(ctx.currentTime); h.gain.gain.rampTo(this.levels[id] ?? 0.7, 0.03); }
    this.t0 = ctx.currentTime + 0.1;
    this.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    this.sources = [];
    const from = this.fromSec, to = req.to;
    for (const c of req.clips) {
      const ce = c.startSec + c.durSec;
      if (ce <= from || c.startSec >= to) continue;
      const buf = ctx.createBuffer(c.right ? 2 : 1, c.data.length, c.sr);
      buf.copyToChannel(c.data as Float32Array<ArrayBuffer>, 0);
      if (c.right) buf.copyToChannel(c.right as Float32Array<ArrayBuffer>, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      Tone.connect(src, this.voiceGain!);
      if (this.tuningMode === 'a440' && this.tuningCents) {
        if (src.detune) src.detune.value = -this.tuningCents;
        else if (!this.detuneFallback) {
          this.detuneFallback = true;
          console.warn('[psalmist] voice detune unsupported by this audio context; instruments follow the voice tuning instead');
          this.applySfTuning();
        }
      }
      const off = Math.max(0, from - c.startSec);
      const when = this.t0 + Math.max(0, c.startSec - from);
      src.start(when, off, Math.max(0.01, Math.min(ce, to) - Math.max(c.startSec, from)));
      this.sources.push(src);
    }
    this.cursors = req.tracks.map((track) => ({ track, list: track.notes.filter((n) => n.startSec + n.durSec > from && n.startSec < to), idx: 0 }));
    this.clicks = [];
    if (req.metronome) {
      const beat = beatSec(req.bpm);
      const pattern = barClicks(req.sig);
      const off = req.metroOffset ?? 0;
      for (let i = Math.ceil((from - off) / beat - 1e-6); off + i * beat < to; i++) this.clicks.push({ t: off + i * beat, kind: pattern[((i % req.sig.num) + req.sig.num) % req.sig.num] });
    }
    this.clickIdx = 0;
    // ducking of the accompaniment bus under the voice (precomputed curve, 100 Hz)
    if (this.accBus) {
      const g = this.accBus.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(1, ctx.currentTime);
      if (req.duck && req.duck.length > 4) {
        const k0 = Math.max(0, Math.floor(from * 100));
        const k1 = Math.min(req.duck.length, Math.ceil(to * 100));
        if (k1 - k0 > 2) {
          const part = req.duck.slice(k0, k1);
          try { g.setValueCurveAtTime(Array.from(part), this.t0 + Math.max(0, k0 / 100 - from), (part.length - 1) / 100); } catch { /* keep unducked */ }
          if (this.pocket) {
            let lo = 1; for (const d of part) if (d < lo) lo = d;
            const pg = this.pocket.gain;
            pg.cancelScheduledValues(ctx.currentTime);
            if (lo < 0.999) { try { pg.setValueCurveAtTime(Array.from(part, (d) => -POCKET_DB * Math.max(0, Math.min(1, (1 - d) / (1 - lo)))), this.t0 + Math.max(0, k0 / 100 - from), (part.length - 1) / 100); } catch { /* no pocket */ } }
          }
        }
      }
    }
  }

  private pump() {
    if (!this.playing || !this.req) return;
    const ctx = this.rawContext;
    const now = ctx.currentTime;
    const pos = this.fromSec + (now - this.t0);
    if (pos >= this.toSec + 0.02) {
      if (this.req.loop) { this.fromSec = this.req.from; this.releaseAll(); this.start(); return; }
      this.stop(true);
      return;
    }
    const horizon = this.fromSec + (now + AHEAD - this.t0);
    for (const cur of this.cursors) {
      const { track, list } = cur;
      while (cur.idx < list.length && list[cur.idx].startSec < horizon) {
        const n = list[cur.idx++];
        const when = Math.max(this.t0 + (n.startSec - this.fromSec), now);
        const startAt = Math.max(n.startSec, this.fromSec);
        const dur = Math.max(0.04, Math.min(n.startSec + n.durSec, this.toSec) - startAt);
        if (track.kind === 'piano') {
          const pt = this.pianoFor(track.id);
          pt?.sampler.triggerAttackRelease(this.pitchHz(n.midi), dur, when, Math.min(1, 0.3 + n.vel * 0.65));
        } else if (track.kind === 'ext') {
          const h = this.ext.get(track.id);
          if (h?.synth) h.synth.note(n.midi + this.instrCents() / 100, dur, when, Math.min(1, n.vel));
          else if (h?.sampler) {
            const v = h.sampler.play(n.midi, when, dur, Math.min(1, n.vel), { articulation: n.art, attack: n.attack, detune: this.instrCents(), gain: Math.pow(10, (track.entry?.gainDb ?? 0) / 20) });
            if (v) { this.extVoices.push(v); if (this.extVoices.length > 400) this.extVoices = this.extVoices.filter((x) => x.endTime > now); }
          }
        } else if (this.synth && track.channel !== undefined) {
          const v = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
          this.synth.noteOn(track.channel, n.midi, v, { time: when });
          this.synth.noteOff(track.channel, n.midi, { time: when + (track.drums ? Math.min(dur, 0.25) : dur) });
        }
      }
    }
    while (this.clickIdx < this.clicks.length && this.clicks[this.clickIdx].t < horizon) {
      const c = this.clicks[this.clickIdx++];
      this.tick(c.kind, Math.max(this.t0 + (c.t - this.fromSec), now), this.levels.metro ?? 0.35);
    }
  }

  /** Live level change (volume / mute / solo): ramped, no clicks, applies within ~30 ms while playing. */
  setLevels(levels: Record<string, number>) {
    this.levels = { ...levels };
    this.applyLevels(levels, false);
  }

  private applyLevels(levels: Record<string, number>, immediate: boolean) {
    const ramp = immediate ? 0.005 : 0.03;
    if (this.voiceGain) this.voiceGain.gain.rampTo(levels.voce ?? 0.9, ramp);
    for (const [id, pt] of this.piano) pt.gain.gain.rampTo(levels[id] ?? 0.8, ramp);
    for (const [id, h] of this.ext) h.gain.gain.rampTo(levels[id] ?? 0.7, ramp);
    if (this.req) for (const tr of this.req.tracks) {
      if (tr.kind === 'sf' && tr.channel !== undefined) this.rampSf(tr.channel, levels[tr.id] ?? 0.7);
    }
  }

  private releaseAll() {
    for (const pt of this.piano.values()) pt.sampler.releaseAll();
    const now = this.rawContext.currentTime;
    for (const v of this.extVoices) { try { v.stop(now); } catch { /* already ended */ } }
    this.extVoices = [];
    for (const h of this.ext.values()) { h.gain.gain.cancelScheduledValues(now); h.gain.gain.rampTo(0, 0.02); }
  }

  stop(emit = true) {
    // clicks already scheduled ahead (assistant preview, count-in) cannot be unscheduled: start a fresh click voice
    if (this.click && this.tickedUntil > this.rawContext.currentTime + 0.01) { try { this.click.dispose(); } catch { /* ignore */ } this.makeClick(); }
    this.tickedUntil = 0;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const was = this.playing;
    if (was) this.fromSec = Math.min(this.toSec, this.fromSec + (this.rawContext.currentTime - this.t0));
    this.sources.forEach((s) => { try { s.stop(); } catch { /* ignore */ } });
    this.sources = [];
    this.releaseAll();
    if (this.synth && was) {
      // events already handed to the synth cannot be cancelled: mute its output until they drained
      const ctx = this.rawContext;
      this.sfOut?.gain.cancelScheduledValues(ctx.currentTime);
      this.sfOut?.gain.rampTo(0, 0.008);
      this.synth.stopAll(true);
      this.staleUntil = ctx.currentTime + AHEAD + 0.06;
      if (this.staleTimer) clearTimeout(this.staleTimer);
      this.staleTimer = setTimeout(() => {
        this.synth?.stopAll(true);
        this.sfOut?.gain.rampTo(1, 0.02);
        this.staleTimer = null;
      }, (AHEAD + 0.08) * 1000);
    }
    this.playing = false;
    if (emit) { this.fromSec = 0; this.emit(); }
  }

  /** Audition a single pitch (keyboard click / note edit feedback). */
  preview(midi: number) {
    if (this.sampleState !== 'ready') return;
    const pt = this.pianoFor('melodie');
    if (!pt) return;
    pt.gain.gain.rampTo(this.levels.melodie ?? 0.8, 0.005);
    pt.sampler.triggerAttackRelease(this.pitchHz(midi), 0.5, Tone.now(), 0.7);
  }

  seek(sec: number) { this.fromSec = Math.max(0, sec); this.emit(); }

  pause() {
    if (!this.playing) return;
    const pos = this.position();
    this.stop(false);
    this.fromSec = pos;
    this.emit();
  }
}

export const engine = new Engine();
/** handle for the e2e script (dev server only) */
if (import.meta.env.DEV) (globalThis as unknown as { __engine: Engine }).__engine = engine;
