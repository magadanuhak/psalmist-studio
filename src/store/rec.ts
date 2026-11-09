import { create } from 'zustand';
import { MicError, MicSession, calibrateLatency, listInputs, recordSection, type RecordHandle } from '../audio/recorder';
import { engine } from '../audio/engine';
import { dsp } from '../workers/client';
import { storeAudio } from './audioCache';
import { useApp } from './store';
import { DEFAULT_CORRECTION, type Take } from '../model/types';
import { uid } from '../model/id';
import { t } from '../i18n/ro';
import { DEFAULT_CLICK, clickSchedule, type ClickOpts } from '../audio/click';
import { barSec } from '../music/timesig';
import { detectBleed, reduceBleed, type BleedReport } from '../dsp/bleed';

export type RecStatus = 'idle' | 'opening' | 'ready' | 'roomtone' | 'countin' | 'recording' | 'paused' | 'saving' | 'calibrating';

interface RecState {
  status: RecStatus;
  devices: MediaDeviceInfo[];
  deviceId: string;
  level: number;
  peak: number;
  error: string | null;
  latencyMs: number;
  metronomeOn: boolean;
  clickVolume: number;
  beatIndex: number;
  barNumber: number;
  /** metronome sound, accents, subdivision (persisted) */
  click: ClickOpts;
  setClick(patch: Partial<ClickOpts>): void;
  /** headphone bleed check of the last recording */
  bleed: { sectionId: string; takeId: string; report: BleedReport } | null;
  /** subtract the metronome from the last recording and save the result as a new take */
  reduceLastBleed(): Promise<void>;
  openMic(): Promise<void>;
  closeMic(): void;
  setDevice(id: string): Promise<void>;
  setLatency(ms: number): void;
  setMetronomeOn(v: boolean): void;
  setClickVolume(v: number): void;
  captureRoomTone(): Promise<void>;
  calibrate(): Promise<void>;
  record(sectionId: string): Promise<void>;
  stopRecording(): void;
  pauseRecording(): void;
  resumeRecording(): void;
  importFile(sectionId: string, file: File): Promise<void>;
}

let session: MicSession | null = null;
/** the open microphone session (final recording shares it) */
export const getMicSession = () => session;
let handle: RecordHandle | null = null;
let lastRec: { sectionId: string; audio: Float32Array; sr: number; clicks: ReturnType<typeof clickSchedule>; lagMs: number } | null = null;
const loadClick = (): ClickOpts => { try { return { ...DEFAULT_CLICK, ...JSON.parse(localStorage.getItem('psalmist.click') ?? '{}') }; } catch { return DEFAULT_CLICK; } };
let meterTimer: ReturnType<typeof setInterval> | null = null;

const pref = (k: string, d: number) => { try { const v = localStorage.getItem('psalmist.' + k); return v ? Number(v) : d; } catch { return d; } };
const setPref = (k: string, v: number) => { try { localStorage.setItem('psalmist.' + k, String(v)); } catch { /* ignore */ } };

function micMessage(e: unknown): string {
  console.warn('[mic]', e instanceof Error ? e.name + ': ' + e.message : String(e));
  if (e instanceof MicError) {
    switch (e.kind) {
      case 'denied': return t.rec.errDenied;
      case 'nodevice': return t.rec.errNoDevice;
      case 'busy': return t.rec.errBusy;
      case 'unsupported': return t.rec.errUnsupported;
      default: return e.message === 'nodetect' ? t.rec.errCalibrate : t.rec.errOther;
    }
  }
  return t.rec.errOther;
}

export async function makeTake(sectionId: string, audio: Float32Array, sr: number, source: Take['source'], latencyMs: number, label?: string) {
  const rawId = uid();
  await storeAudio(rawId, audio, sr);
  const take: Take = {
    id: uid(), rawAudioId: rawId, latencyMs, durationSec: audio.length / sr, createdAt: Date.now(), source, label,
    notesOriginal: [], notesCorrected: [], correction: { ...DEFAULT_CORRECTION },
  };
  useApp.getState().addTake(sectionId, take);
  return take;
}

export const useRec = create<RecState>((set, get) => ({
  status: 'idle',
  devices: [],
  deviceId: '',
  level: 0,
  peak: 0,
  error: null,
  latencyMs: pref('latency', 0),
  metronomeOn: true,
  clickVolume: 0.5,
  beatIndex: -1,
  barNumber: 1,
  click: loadClick(),
  setClick(patch) { const c = { ...get().click, ...patch }; try { localStorage.setItem('psalmist.click', JSON.stringify(c)); } catch { /* ignore */ } set({ click: c }); },
  bleed: null,
  async reduceLastBleed() {
    const b = get().bleed;
    if (!lastRec || !b) return;
    const out = reduceBleed(lastRec.audio, lastRec.sr, lastRec.clicks, b.report.lagMs);
    const take = await makeTake(lastRec.sectionId, out, lastRec.sr, 'mic', get().latencyMs, t.rec.bleedFixedLabel);
    set({ bleed: { ...b, takeId: take.id, report: detectBleed(out, lastRec.sr, lastRec.clicks) } });
    useApp.getState().notify('ok', t.rec.bleedFixed);
  },

  async openMic() {
    if (session) return;
    set({ status: 'opening', error: null });
    try {
      session = await MicSession.open(get().deviceId || undefined);
      const devices = await listInputs();
      set({ status: 'ready', devices, deviceId: session.deviceId ?? get().deviceId });
      set({ peak: 0 });
      meterTimer = setInterval(() => { if (session) { const l = session.level(); set({ level: l, peak: Math.max(get().peak, l) }); } }, 60);
    } catch (e) {
      session = null;
      set({ status: 'idle', error: micMessage(e) });
    }
  },
  closeMic() {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = null;
    session?.close();
    session = null;
    set({ status: 'idle', level: 0 });
  },
  async setDevice(id) {
    set({ deviceId: id });
    if (session) { get().closeMic(); await get().openMic(); }
  },
  setLatency(ms) { setPref('latency', ms); set({ latencyMs: ms }); },
  setMetronomeOn(v) { set({ metronomeOn: v }); },
  setClickVolume(v) { set({ clickVolume: v }); },

  async captureRoomTone() {
    if (!session || get().status !== 'ready') return;
    set({ status: 'roomtone', error: null });
    session.startCapture();
    await new Promise((r) => setTimeout(r, 2300));
    const cap = session.stopCapture();
    try {
      const start = Math.floor(cap.sr * 0.2);
      const profile = await dsp.profile(cap.data.slice(start), cap.sr);
      useApp.getState().setRoomTone(profile);
      set({ status: 'ready' });
      useApp.getState().notify('ok', t.rec.roomToneDone);
    } catch {
      set({ status: 'ready', error: t.rec.errOther });
    }
  },

  async calibrate() {
    if (!session || get().status !== 'ready') return;
    set({ status: 'calibrating', error: null });
    try {
      const ms = await calibrateLatency(session);
      get().setLatency(ms);
      useApp.getState().notify('ok', t.rec.calibrated(ms));
      set({ status: 'ready' });
    } catch (e) {
      set({ status: 'ready', error: micMessage(e) });
    }
  },

  async record(sectionId) {
    const p = useApp.getState().project;
    const section = p?.sections.find((s) => s.id === sectionId);
    if (!p || !section) return;
    if (!session) await get().openMic();
    if (!session || get().status !== 'ready') return;
    engine.stop();
    await engine.ensureContext();
    set({ status: 'countin', error: null, beatIndex: 0 });
    handle = recordSection({
      session, bpm: p.bpm, sig: p.timeSig, bars: section.bars, latencyMs: get().latencyMs,
      metronome: get().metronomeOn, volume: get().clickVolume, click: get().click,
      onPhase: (phase, beatInBar, bar) => set({ status: phase, beatIndex: beatInBar, barNumber: bar }),
    });
    try {
      const { audio, sr } = await handle.done;
      set({ status: 'saving' });
      if (audio.length < sr * 0.5) throw new Error('short');
      const take = await makeTake(sectionId, audio, sr, 'mic', get().latencyMs);
      set({ bleed: null });
      if (get().metronomeOn) {
        // headphone bleed check: click energy that follows the schedule (output sample 0 = beat 1)
        const bars = Math.ceil(audio.length / sr / barSec(p.bpm, p.timeSig)) + 1;
        const clicks = clickSchedule(p.bpm, p.timeSig, bars, get().click);
        const report = detectBleed(audio, sr, clicks);
        lastRec = { sectionId, audio, sr, clicks, lagMs: report.lagMs };
        set({ bleed: { sectionId, takeId: take.id, report } });
      }
      useApp.getState().notify('ok', t.rec.saved);
    } catch (e) {
      set({ error: e instanceof Error && e.message === 'short' ? t.rec.errShort : t.rec.errOther });
    } finally {
      handle = null;
      set({ status: session ? 'ready' : 'idle', beatIndex: -1, barNumber: 1 });
    }
  },
  stopRecording() { handle?.stop(); },
  pauseRecording() { handle?.pause(); },
  resumeRecording() { if (handle?.state() === 'paused') { handle.resume(); set({ status: 'countin' }); } },

  async importFile(sectionId, file) {
    const app = useApp.getState();
    try {
      await engine.ensureContext();
      const buf = await engine.rawContext.decodeAudioData(await file.arrayBuffer());
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
      }
      await makeTake(sectionId, mono, buf.sampleRate, 'import', 0, file.name.replace(/\.[^.]+$/, ''));
      app.notify('ok', t.rec.imported(file.name));
    } catch {
      app.notify('error', t.rec.errImport);
    }
  },
}));
