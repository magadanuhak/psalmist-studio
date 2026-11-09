/// <reference lib="webworker" />
import { analyze } from '../dsp/analyze';
import { buildNoiseProfile, cleanAudio } from '../dsp/clean';
import type { NoiseProfile } from '../model/types';

export type WorkerRequest =
  | { id: number; type: 'profile'; audio: Float32Array; sr: number }
  | { id: number; type: 'clean'; audio: Float32Array; sr: number; profile: NoiseProfile | null }
  | { id: number; type: 'analyze'; audio: Float32Array; sr: number; bpm: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    ctx.postMessage({ id: req.id, type: 'progress', value: 0.1 });
    if (req.type === 'profile') {
      ctx.postMessage({ id: req.id, type: 'result', result: buildNoiseProfile(req.audio, req.sr) });
    } else if (req.type === 'clean') {
      const r = cleanAudio(req.audio, req.sr, req.profile);
      ctx.postMessage({ id: req.id, type: 'result', result: r }, [r.audio.buffer]);
    } else {
      const a = analyze(req.audio, req.sr, req.bpm);
      ctx.postMessage({ id: req.id, type: 'result', result: a });
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
