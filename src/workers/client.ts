import type { Analysis, NoiseProfile } from '../model/types';
import type { CleanResult } from '../dsp/clean';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (v: number) => void }>();

function get(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.(m.value);
    else if (m.type === 'result') { pending.delete(m.id); p.resolve(m.result); }
    else { pending.delete(m.id); p.reject(new Error(m.message)); }
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'worker'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[], onProgress?: (v: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    get().postMessage({ id, ...msg }, transfer);
  });
}

// Audio is copied before sending so the caller keeps its buffer.
export const dsp = {
  profile: (audio: Float32Array, sr: number) => {
    const a = audio.slice();
    return call<NoiseProfile>({ type: 'profile', audio: a, sr }, [a.buffer]);
  },
  clean: (audio: Float32Array, sr: number, profile: NoiseProfile | null, onProgress?: (v: number) => void) => {
    const a = audio.slice();
    return call<CleanResult>({ type: 'clean', audio: a, sr, profile }, [a.buffer], onProgress);
  },
  analyze: (audio: Float32Array, sr: number, bpm: number, onProgress?: (v: number) => void) => {
    const a = audio.slice();
    return call<Analysis>({ type: 'analyze', audio: a, sr, bpm }, [a.buffer], onProgress);
  },
};
