import { create } from 'zustand';
import { engine } from '../audio/engine';
import { alignCapture, placeSegment, type Capture } from '../audio/align';
import { buildRequest } from './player';
import { getMicSession, useRec } from './rec';
import { storeAudio } from './audioCache';
import { useApp } from './store';
import { songLayout } from './arrangeInput';
import { barSec } from '../music/timesig';
import { uid } from '../model/id';
import { t } from '../i18n/ro';

export type FinalStatus = 'idle' | 'opening' | 'countin' | 'recording' | 'paused' | 'saving';

interface Segment { cap: Capture; t0: number; from: number; start: number; end: number }

interface FinalState {
  status: FinalStatus;
  error: string | null;
  guide: boolean;
  metronome: boolean;
  /** 'song' or a section id (punch-in) */
  target: string;
  setGuide(v: boolean): void;
  setMetronome(v: boolean): void;
  setTarget(t: string): void;
  start(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

let segs: Segment[] = [];
let cur: { from: number; start: number; t0: number } | null = null;
let watch: ReturnType<typeof setInterval> | null = null;

export const useFinal = create<FinalState>((set, get) => {
  const range = () => {
    const p = useApp.getState().project!;
    const lay = songLayout(p);
    const tg = get().target;
    const s = lay.sections.find((x) => x.id === tg);
    return tg === 'song' || !s ? { start: 0, end: lay.total } : { start: s.startSec, end: Math.min(lay.total, s.startSec + s.durSec + 0.3) };
  };

  /** play the minus from `songStart` with one bar of count-in and start the capture */
  const begin = async (songStart: number) => {
    const p = useApp.getState().project!;
    const session = getMicSession();
    if (!session) throw new Error('mic');
    const bar = barSec(p.bpm, p.timeSig);
    const { end } = range();
    const built = await buildRequest('song', 0, { guide: get().guide, metronome: get().metronome });
    if (!built) throw new Error('nothing');
    const from = songStart - bar;
    session.startCapture();
    await engine.play({ ...built.req, from, to: Math.min(built.total, end), metroOffset: 0 });
    cur = { from, start: songStart, t0: engine.clock.t0 };
    set({ status: 'countin' });
    if (watch) clearInterval(watch);
    watch = setInterval(() => {
      if (!engine.playing) { if (get().status === 'recording' || get().status === 'countin') void get().stop(); return; }
      if (engine.position() >= cur!.start && get().status === 'countin') set({ status: 'recording' });
    }, 80);
  };

  const closeSegment = (endPos: number) => {
    const session = getMicSession();
    if (!session || !cur) return;
    const cap = session.stopCapture();
    segs.push({ cap, t0: cur.t0, from: cur.from, start: cur.start, end: Math.max(cur.start, endPos) });
    cur = null;
  };

  return {
    status: 'idle',
    error: null,
    guide: false,
    metronome: false,
    target: 'song',
    setGuide(v) { set({ guide: v }); },
    setMetronome(v) { set({ metronome: v }); },
    setTarget(tg) { set({ target: tg }); },
    async start() {
      if (get().status !== 'idle') return;
      set({ error: null, status: 'opening' });
      segs = [];
      try {
        if (!getMicSession()) await useRec.getState().openMic();
        if (!getMicSession()) { set({ status: 'idle', error: useRec.getState().error ?? t.final.errMic }); return; }
        await begin(range().start);
      } catch (e) {
        console.error('[psalmist] final recording failed to start', e);
        set({ status: 'idle', error: e instanceof Error && e.message === 'nothing' ? t.final.errNothing : t.final.errStart });
      }
    },
    pause() {
      if (get().status !== 'recording' && get().status !== 'countin') return;
      const pos = engine.position();
      engine.pause();
      if (watch) clearInterval(watch);
      closeSegment(pos);
      set({ status: 'paused' });
    },
    async resume() {
      if (get().status !== 'paused') return;
      const p = useApp.getState().project!;
      const bar = barSec(p.bpm, p.timeSig);
      const last = segs[segs.length - 1];
      // continue from the start of the bar that was being sung, after a count-in
      const restart = Math.max(range().start, Math.floor(((last?.end ?? 0) + 1e-6) / bar) * bar);
      try { await begin(restart); } catch (e) { console.error(e); set({ status: 'paused', error: t.final.errStart }); }
    },
    async stop() {
      const st = get().status;
      if (st === 'idle' || st === 'saving') return;
      if (watch) clearInterval(watch);
      watch = null;
      if (st === 'recording' || st === 'countin') { const pos = engine.position(); engine.stop(false); closeSegment(pos); }
      set({ status: 'saving' });
      try {
        const p = useApp.getState().project!;
        const valid = segs.filter((s) => s.end - s.start > 0.5);
        if (!valid.length) { set({ status: 'idle', error: t.final.errShort }); return; }
        const sr = valid[0].cap.sr;
        const total = songLayout(p).total;
        const audio = new Float32Array(Math.ceil(total * sr));
        const latency = useRec.getState().latencyMs;
        for (const s of valid) {
          placeSegment(audio, sr, s.start, alignCapture(s.cap, { engineT0: s.t0, from: s.from, latencyMs: latency, songStart: s.start, songEnd: s.end }));
        }
        const audioId = uid();
        await storeAudio(audioId, audio, sr);
        const lo = Math.min(...valid.map((s) => s.start)), hi = Math.max(...valid.map((s) => s.end));
        const n = (p.final?.takes.length ?? 0) + 1;
        useApp.getState().addFinalTake({
          id: uid(), audioId, durationSec: audio.length / sr, latencyMs: latency, createdAt: Date.now(),
          label: get().target === 'song' ? t.final.takeName(n) : t.final.punchName(n), range: [lo, hi],
        });
        useApp.getState().notify('ok', t.final.saved);
        set({ status: 'idle', error: null });
      } catch (e) {
        console.error(e);
        set({ status: 'idle', error: t.final.errSave });
      } finally { segs = []; engine.stop(false); }
    },
  };
});
