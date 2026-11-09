import type { Project } from '../model/types';
import { presetFor, vocalChain, type VocalPreset } from '../dsp/fx';
import { DUCK_RATE, duckGains } from '../dsp/mix';
import { loadAudio } from './audioCache';
import { arrangementSettings, songLayout } from './arrangeInput';

/** Vocal chain preset of the project: the emotion preset with the user's overrides (Pro). */
export function fxPreset(p: Project): VocalPreset {
  const base = presetFor(p.emotion);
  const fx = arrangementSettings(p).fx;
  if (fx?.reverb !== undefined) base.reverb.send = fx.reverb;
  if (fx?.delay !== undefined) base.delay.send = fx.delay;
  return base;
}
export const fxOn = (p: Project) => arrangementSettings(p).fx?.on !== false;
export const duckDepth = (p: Project) => arrangementSettings(p).fx?.duckDb ?? 3;

export interface FinalClip { sectionId: string; data: Float32Array; sr: number; startSec: number; durSec: number }

/** The comped final voice: one clip per section, cut from the chosen take. */
export async function finalClips(p: Project): Promise<FinalClip[]> {
  const fin = p.final;
  if (!fin?.takes.length) return [];
  const out: FinalClip[] = [];
  for (const s of songLayout(p).sections) {
    const take = fin.takes.find((t) => t.id === fin.comp[s.id]);
    if (!take) continue;
    const a = await loadAudio(take.audioId);
    if (!a) continue;
    const from = Math.max(0, Math.round(s.startSec * a.sr)), to = Math.min(a.data.length, Math.round((s.startSec + s.durSec) * a.sr));
    if (to - from < a.sr * 0.2) continue;
    out.push({ sectionId: s.id, data: a.data.slice(from, to), sr: a.sr, startSec: s.startSec, durSec: (to - from) / a.sr });
  }
  return out;
}

const cache = new Map<string, [Float32Array, Float32Array]>();
/** Vocal chain on a clip (cached): the same function the offline export uses. */
export function processClip(c: FinalClip, p: Project): [Float32Array, Float32Array] {
  const pr = fxPreset(p);
  const key = `${c.sectionId}|${c.startSec}|${c.data.length}|${c.data[Math.floor(c.data.length / 2)]}|${JSON.stringify(pr)}|${p.bpm}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = vocalChain(c.data, c.sr, pr, p.bpm);
  if (cache.size > 24) cache.clear();
  cache.set(key, out);
  return out;
}

/** Ducking curve of the whole timeline (100 Hz) from the voice clips. */
export function duckCurve(clips: { data: Float32Array; sr: number; startSec: number }[], total: number, depthDb: number): Float32Array {
  const curve = new Float32Array(Math.ceil(total * DUCK_RATE) + 2).fill(1);
  for (const c of clips) {
    const g = duckGains(c.data, c.sr, depthDb);
    const o = Math.round(c.startSec * DUCK_RATE);
    for (let i = 0; i < g.length && o + i < curve.length; i++) curve[o + i] = g[i];
  }
  return curve;
}
