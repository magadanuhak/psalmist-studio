/** Vocal trainer state: the exercise, the live pitch trail and the deterministic score. Audio and rendering live in the UI. */
import { create } from 'zustand';
import { engine } from '../audio/engine';
import { activeTake, useApp } from './store';
import { useRec } from './rec';
import { INTERVALS, holdExercise, intervalExercise, scaleExercise, scoreAttempt, type Exercise, type ExerciseKind, type PitchSample, type TrainerScore } from '../music/trainer';
import type { KeySig } from '../model/types';

export type TrainerStatus = 'idle' | 'countdown' | 'running' | 'done';
const COUNT_SEC = 3;
const BEST_KEY = 'psalmist.trainerBest';
const loadBest = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; } };

interface TrainerState {
  kind: ExerciseKind;
  /** middle of the comfortable range: 48 = low voice, 57 = middle, 64 = high */
  anchor: number;
  holdMidi: number;
  intervalIdx: number;
  intervalDir: 1 | -1;
  chromaticScale: boolean;
  guide: boolean;
  octaveFree: boolean;
  status: TrainerStatus;
  exercise: Exercise | null;
  /** performance.now() of the exercise's time 0 (after the count-in) */
  t0: number;
  trail: PitchSample[];
  live: number | null;
  score: TrainerScore | null;
  best: Record<string, number>;
  /** frames come from the test hook, not the microphone */
  external: boolean;
  set(p: Partial<Pick<TrainerState, 'kind' | 'anchor' | 'holdMidi' | 'intervalIdx' | 'intervalDir' | 'chromaticScale' | 'guide' | 'octaveFree' | 'external'>>): void;
  build(): Exercise | null;
  start(): Promise<void>;
  stop(): void;
  pushFrame(tSec: number, midi: number | null): void;
}

let timers: ReturnType<typeof setTimeout>[] = [];
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

/** a soft guide tone (sine with a short envelope); independent of the sample libraries */
function guideTone(midi: number, dur: number, when = 0) {
  const ctx = engine.rawContext;
  const o = ctx.createOscillator(), g = ctx.createGain();
  const t = ctx.currentTime + when;
  o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.03); g.gain.setValueAtTime(0.16, t + Math.max(0.05, dur - 0.08)); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const useTrainer = create<TrainerState>((set, get) => ({
  kind: 'hold', anchor: 57, holdMidi: 57, intervalIdx: 4, intervalDir: 1, chromaticScale: false, guide: true, octaveFree: true,
  status: 'idle', exercise: null, t0: 0, trail: [], live: null, score: null, best: loadBest(), external: false,
  set(p) { set(p); },

  build() {
    const s = get();
    const proj = useApp.getState().project;
    const key: KeySig = !s.chromaticScale && proj?.key ? proj.key : { tonic: 0, mode: 'major' };
    if (s.kind === 'hold') return holdExercise(s.holdMidi, 5);
    if (s.kind === 'scale') return scaleExercise(key, s.anchor);
    if (s.kind === 'interval') return intervalExercise(s.anchor, INTERVALS[s.intervalIdx].semis, s.intervalDir);
    // the user's own song: the melody of the selected section (corrected notes), one note per line
    const sec = useApp.getState().project?.sections.find((x) => x.id === useApp.getState().sectionId) ?? proj?.sections[0];
    const notes = sec ? activeTake(sec)?.notesCorrected ?? [] : [];
    if (!notes.length) return null;
    const t0 = notes[0].startSec;
    const targets = notes.map((n) => ({ midi: n.midi, startSec: n.startSec - t0, durSec: n.durSec }));
    const end = Math.max(...targets.map((x) => x.startSec + x.durSec));
    return { kind: 'song', title: 'song', targets, totalSec: end };
  },

  async start() {
    const ex = get().build();
    if (!ex) return;
    if (!get().external) {
      await useRec.getState().openMic();
      if (useRec.getState().status === 'idle') return; // the microphone could not be opened: the error is shown by the view
    }
    await engine.ensureContext();
    clearTimers();
    const now = performance.now();
    set({ exercise: ex, status: 'countdown', trail: [], live: null, score: null, t0: now + COUNT_SEC * 1000 });
    for (let i = 0; i < COUNT_SEC; i++) engine.tick(i === 0 ? 'accent' : 'beat', engine.rawContext.currentTime + 0.05 + i, 0.5);
    if (get().guide) ex.targets.forEach((tg) => guideTone(tg.midi, tg.durSec, COUNT_SEC + tg.startSec + 0.05));
    timers.push(setTimeout(() => set({ status: 'running' }), COUNT_SEC * 1000));
    timers.push(setTimeout(() => {
      const st = get();
      if (st.status !== 'running' && st.status !== 'countdown') return;
      const score = scoreAttempt(ex.targets, st.trail, { octaveFree: st.octaveFree, latencySec: 0.05 });
      const k = st.kind + (st.kind === 'hold' ? st.holdMidi : st.kind === 'interval' ? st.intervalIdx * (st.intervalDir) : st.kind === 'scale' ? st.anchor : '');
      const best = { ...st.best, [k]: Math.max(st.best[k] ?? 0, score.total) };
      try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* ignore */ }
      set({ status: 'done', score, best });
    }, (COUNT_SEC + ex.totalSec + 0.4) * 1000));
  },

  stop() { clearTimers(); set({ status: 'idle', live: null }); },

  pushFrame(tSec, midi) {
    const st = get();
    if (st.status !== 'running' && st.status !== 'countdown') { if (st.live !== midi) set({ live: midi }); return; }
    set({ live: midi, trail: st.status === 'running' ? [...st.trail, { t: tSec, midi }] : st.trail });
  },
}));

if (import.meta.env.DEV) setTimeout(() => { (globalThis as unknown as { __trainer?: unknown }).__trainer = useTrainer; }, 0);
