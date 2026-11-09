/** Local AI helpers (ai-service/, http://127.0.0.1:5175): status polling + the three UI-facing actions. Every feature degrades gracefully when the service is off. */
import { create } from 'zustand';
import { AiError, createAiClient, type AiStatus, type SeparateResult } from '../ai';
import { encodeWav } from '../music/wav';
import { fillDownbeats } from '../dsp/beatMap';
import { gridFromBars, type TapGrid } from '../dsp/tapGrid';
import { loadAudio, storeAudio } from './audioCache';
import { t } from '../i18n/ro';
import { uid } from '../model/id';
import { useApp } from './store';
import { engine } from '../audio/engine';

export const ai = createAiClient();
/** A5 pieces the backend may not expose yet (stems player, learn-from-song, practice) stay behind this flag */
export const AI_A5_UI = true;
if (import.meta.env.DEV) setTimeout(() => { (globalThis as unknown as { __ai?: unknown }).__ai = useAi; }, 0);

interface AiStore {
  /** "Detecție note": classic pYIN or CREPE through the local service (falls back to classic when the service is off) */
  pitchEngine: 'classic' | 'ai';
  setPitchEngine(e: 'classic' | 'ai'): void;
  status: AiStatus | null;
  busy: Record<string, { label: string; progress: number }>;
  poll(): Promise<void>;
  /** "Curățare AI" of a take; the classic result stays as the A/B alternative */
  cleanTake(sectionId: string, takeId: string, kind?: 'ai' | 'restore'): Promise<void>;
  setCleanKind(sectionId: string, takeId: string, kind: 'classic' | 'ai' | 'restore'): void;
  /** whole song -> vocals (and the original accompaniment as a local reference); resolves with the vocals as a File */
  separateSong(file: File, opts: { model: 'htdemucs' | 'htdemucs_ft'; quality: 'fast' | 'best' }): Promise<{ vocals: File; result: SeparateResult } | null>;
}

export const aiMessage = (e: unknown): string => {
  if (e instanceof AiError) {
    if (e.code === 'offline') return t.ai.offlineHint;
    if (e.code === 'not_ready') return t.ai.loading;
    if (e.code === 'aborted') return t.ai.aborted;
    if (e.code === 'timeout') return t.ai.timeout;
    return t.ai.failed + (e.message ? ` (${e.message})` : '');
  }
  return t.ai.failed;
};

const PITCH_KEY = 'psalmist.pitchEngine';
const loadPitch = (): 'classic' | 'ai' => { try { return localStorage.getItem(PITCH_KEY) === 'ai' ? 'ai' : 'classic'; } catch { return 'classic'; } };

/** Beat This! bar grid of a recording (null when the service is unavailable or finds too few downbeats). */
export async function aiBeatGrid(audio: Float32Array, sr: number): Promise<{ grid: TapGrid; perBar: number; downbeats: number[] } | null> {
  try {
    const r = await ai.beats(new Blob([encodeWav(audio, sr)], { type: 'audio/wav' }));
    if (!r.ok || r.downbeats.length < 3) return null;
    const downbeats = fillDownbeats(r.downbeats);
    const grid = gridFromBars(downbeats, r.beats_per_bar);
    return grid ? { grid, perBar: r.beats_per_bar, downbeats } : null;
  } catch { return null; }
}

/** CREPE frames for a take, or null when the AI engine is not selected / the service is unavailable (the caller then uses pYIN) */
export async function tryAiPitch(audio: Float32Array, sr: number): Promise<{ f0: number[]; voicing: number[] } | null> {
  if (useAi.getState().pitchEngine !== 'ai') return null;
  try {
    const st = await ai.status();
    if (st.state !== 'ready') return null;
    const r = await ai.pitch(new Blob([encodeWav(audio, sr)], { type: 'audio/wav' }));
    return { f0: r.f0_hz, voicing: r.voicing };
  } catch { return null; }
}

export const useAi = create<AiStore>((set, get) => ({
  pitchEngine: loadPitch(),
  setPitchEngine(e) { try { localStorage.setItem(PITCH_KEY, e); } catch { /* ignore */ } set({ pitchEngine: e }); },
  status: null,
  busy: {},
  async poll() { set({ status: await ai.status() }); },
  async cleanTake(sectionId, takeId, kind = 'ai') {
    const st = useApp.getState();
    const p = st.project;
    const tk = p?.sections.flatMap((s) => s.takes).find((x) => x.id === takeId);
    if (!p || !tk) return;
    const setBusy = (v: { label: string; progress: number } | null) => set((s) => { const b = { ...s.busy }; if (v) b[takeId] = v; else delete b[takeId]; return { busy: b }; });
    setBusy({ label: t.ai.cleaning, progress: 0.1 });
    try {
      const raw = await loadAudio(tk.rawAudioId);
      if (!raw) throw new Error('audio');
      const wav = new Blob([encodeWav(raw.data, raw.sr)], { type: 'audio/wav' });
      const blob = kind === 'restore' ? await ai.restore(wav, { mode: 0 }) : await ai.denoise(wav, { attenLimDb: 18, onProgress: (f) => setBusy({ label: t.ai.cleaning, progress: 0.1 + 0.8 * f }) });
      const buf = await engine.rawContext.decodeAudioData(await blob.arrayBuffer());
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
      const aiId = uid();
      await storeAudio(aiId, mono, buf.sampleRate);
      useApp.getState().applyAiClean(sectionId, takeId, aiId, kind);
      useApp.getState().notify('ok', t.ai.cleanDone);
    } catch (e) { useApp.getState().notify('error', aiMessage(e)); }
    finally { setBusy(null); void get().poll(); }
  },
  setCleanKind(sectionId, takeId, kind) { useApp.getState().setCleanKind(sectionId, takeId, kind); },
  async separateSong(file, opts) {
    const key = 'separate';
    const setBusy = (v: { label: string; progress: number } | null) => set((s) => { const b = { ...s.busy }; if (v) b[key] = v; else delete b[key]; return { busy: b }; });
    setBusy({ label: t.ai.separating, progress: 0.02 });
    try {
      const result = await ai.separate(file, { model: opts.model, twoStems: 'vocals', shifts: opts.quality === 'best' ? 2 : 0, format: 'pcm16', onProgress: (f) => setBusy({ label: t.ai.separating, progress: f }) });
      if (!result.vocals) throw new AiError('server', 'fără voce');
      return { vocals: new File([result.vocals], file.name.replace(/\.[^.]+$/, '') + '-voce.wav', { type: 'audio/wav' }), result };
    } catch (e) { useApp.getState().notify('error', aiMessage(e)); return null; }
    finally { setBusy(null); }
  },
}));
