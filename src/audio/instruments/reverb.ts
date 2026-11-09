/**
 * Church / room reverb: five convolution spaces (procedural IRs in public/instruments/ir) usable per project
 * and per bus. Works on any BaseAudioContext (live or offline).
 */
import type { Genre } from './types';

export interface ReverbSpace { id: string; name: string; file: string; rt60: number; preDelay: number; send: number; bytes: number; license: string }
export interface ReverbManifest { version: number; sampleRate: number; spaces: ReverbSpace[]; attribution: string[] }

export const SPACE_IDS = ['studio', 'capela', 'biserica', 'catedrala', 'sala'] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

/** Default space per genre (the user can override per project). */
export const DEFAULT_SPACE: Record<Genre, SpaceId> = { worship: 'biserica', imn: 'catedrala', cantare: 'capela', pop: 'sala', rock: 'sala', popular: 'sala' };

function base(b?: string): string { return b ?? `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}instruments/`; }

export async function loadReverbManifest(baseUrl?: string, fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<ReverbManifest> {
  const r = await fetchFn(`${base(baseUrl)}ir/manifest.json`);
  if (!r.ok) throw new Error('ir manifest HTTP ' + r.status);
  return r.json() as Promise<ReverbManifest>;
}

const bufs = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>();
export function loadImpulse(ctx: BaseAudioContext, space: ReverbSpace, baseUrl?: string, fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<AudioBuffer> {
  let m = bufs.get(ctx); if (!m) { m = new Map(); bufs.set(ctx, m); }
  let p = m.get(space.id);
  if (!p) {
    p = fetchFn(`${base(baseUrl)}ir/${space.file}`).then((r) => { if (!r.ok) throw new Error('ir HTTP ' + r.status); return r.arrayBuffer(); }).then((ab) => ctx.decodeAudioData(ab));
    m.set(space.id, p);
  }
  return p;
}

export interface ChurchReverb {
  /** connect sends here */
  readonly input: GainNode;
  /** connect to the master bus */
  readonly output: GainNode;
  setSpace(buffer: AudioBuffer): void;
  /** 0..1 wet return level */
  setLevel(v: number): void;
  dispose(): void;
}

/** Send/return reverb: input -> pre-delay -> convolver -> return gain -> output (wet only; sends set the amount). */
export function createChurchReverb(ctx: BaseAudioContext, buffer: AudioBuffer | null, preDelaySec = 0.02, level = 1): ChurchReverb {
  const input = ctx.createGain(); const output = ctx.createGain(); output.gain.value = level;
  const pre = ctx.createDelay(0.2); pre.delayTime.value = Math.min(0.2, Math.max(0, preDelaySec));
  const conv = ctx.createConvolver(); conv.normalize = true; if (buffer) conv.buffer = buffer;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; // keeps low-end mud out of the tail
  input.connect(pre); pre.connect(conv); conv.connect(hp); hp.connect(output);
  return {
    input, output,
    setSpace: (b) => { conv.buffer = b; },
    setLevel: (v) => { output.gain.value = Math.min(1.5, Math.max(0, v)); },
    dispose: () => { for (const n of [input, pre, conv, hp, output]) try { n.disconnect(); } catch { /* ignore */ } },
  };
}

/** Wet send amount for one track/bus in a given space: entry default scaled by space size, user trim 0..1. */
export function sendLevel(entrySend: number, spaceId: string, userTrim = 1): number {
  const k: Record<string, number> = { studio: 0.45, capela: 0.85, biserica: 1, catedrala: 0.85, sala: 0.9 };
  return Math.min(1, Math.max(0, entrySend * (k[spaceId] ?? 1) * userTrim));
}
