/** Tier A (samples), tier C (synths) and the user's instruments: loading for any audio context and the offline render of those tracks.
 *  The SoundFont (tier B) stays in SpessaSynth; when a tier A set cannot be loaded the caller falls back to `gmFallback`. */
import * as Tone from 'tone';
import { loadInstrument, type SampleInstrument } from './instruments/sampler';
import { createSynth } from './instruments/synth';
import { createChurchReverb, loadImpulse, loadReverbManifest, sendLevel } from './instruments/reverb';
import { userInstrumentToSampler } from './instruments/yourInstrument';
import type { CatalogEntry } from './instruments/types';

export interface ExtNote { midi: number; time: number; dur: number; vel: number; art?: string; attack?: number }
export interface ExtSpec { id: string; entry: CatalogEntry; notes: ExtNote[]; pan: number; level: number }

/** Entries the engine plays itself (everything except General MIDI and the Salamander piano). */
export const isExternal = (e: CatalogEntry | undefined): e is CatalogEntry => !!e && (e.source.type === 'manifest' || e.source.type === 'synth' || e.source.type === 'user');

export type UserGetter = (id: string) => Promise<import('./instruments/yourInstrument').UserInstrument | undefined>;

/** Load a sampled (tier A) or user instrument on `ctx`. Throws when the files cannot be fetched. */
export async function loadSampled(ctx: BaseAudioContext, entry: CatalogEntry, arts: string[], getUser: UserGetter, onProgress?: (n: number, total: number) => void): Promise<SampleInstrument> {
  if (entry.source.type === 'user') {
    const u = await getUser(entry.source.id);
    if (!u) throw new Error('user instrument missing');
    return userInstrumentToSampler(ctx, u);
  }
  if (entry.source.type !== 'manifest') throw new Error('not a sampled instrument');
  const want = [...new Set([entry.articulations[0], ...arts.filter((a) => entry.articulations.includes(a))])];
  return loadInstrument(ctx, entry.source.id, { articulations: want, onProgress });
}

export const articulationsUsed = (notes: readonly { art?: string }[]): string[] => [...new Set(notes.map((n) => n.art).filter((a): a is string => !!a))];

/** bass-role instruments keep their low end; everything else is high-passed so pads, keys and guitars leave the bottom to the bass */
export const keepsLowEnd = (e: CatalogEntry) => e.family === 'basses' || (e.roles.includes('bass') && !e.roles.includes('comp') && !e.roles.includes('pad'));
const dbGain = (db: number) => Math.pow(10, db / 20);

export interface BusOptions {
  sampleRate: number;
  totalSec: number;
  tuningCents: number;
  space: string;
  spaceTrim: number;
  emotion?: string;
  getUser: UserGetter;
  onProgress?(p: number): void;
  /** set `aborted` to stop between tracks (the render throws "aborted") */
  signal?: { aborted: boolean };
}

/** One track rendered dry (level and pan applied) with Tone's offline context; the reverb is added once for all tracks afterwards. */
async function renderDry(sp: ExtSpec, o: BusOptions): Promise<[Float32Array, Float32Array]> {
  const total = Math.max(1, Math.ceil(o.totalSec * o.sampleRate));
  const buf = await Tone.Offline(async () => {
    const ctx = Tone.getContext().rawContext as unknown as BaseAudioContext;
    const master = new Tone.Gain(1).toDestination();
    const g = new Tone.Gain(sp.level);
    const pan = new Tone.Panner(Math.max(-1, Math.min(1, sp.pan)));
    const e = sp.entry;
    if (keepsLowEnd(e)) g.connect(pan); else { const hp = new Tone.Filter({ type: 'highpass', frequency: 90, Q: 0.7 }); g.connect(hp); hp.connect(pan); }
    pan.connect(master);
    if (e.source.type === 'synth') {
      const s = createSynth(e.source.preset, { emotion: o.emotion });
      s.output.connect(g);
      for (const n of sp.notes) s.note(n.midi + o.tuningCents / 100, n.dur, n.time, n.vel);
    } else {
      const inst = await loadSampled(ctx, e, articulationsUsed(sp.notes), o.getUser);
      const inG = ctx.createGain(); Tone.connect(inG, g);
      inst.output = inG as unknown as AudioNode;
      const trim = dbGain(e.gainDb ?? 0);
      for (const n of sp.notes) inst.play(n.midi, n.time, n.dur, n.vel, { articulation: n.art, detune: o.tuningCents, gain: trim, attack: n.attack });
    }
  }, o.totalSec, 2, o.sampleRate);
  const l = buf.getChannelData(0), r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const L = new Float32Array(total), R = new Float32Array(total);
  L.set(l.subarray(0, total)); R.set(r.subarray(0, total));
  return [L, R];
}

/** Render every spec into ONE stereo bus (own pan, level and church-reverb send per track). Specs whose instrument fails to load are returned in `failed`. */
export async function renderExternalBus(specs: ExtSpec[], o: BusOptions): Promise<{ ch: [Float32Array, Float32Array]; failed: string[] }> {
  const failed: string[] = [];
  const total = Math.max(1, Math.ceil(o.totalSec * o.sampleRate));
  const L = new Float32Array(total), R = new Float32Array(total);
  const sendL = new Float32Array(total), sendR = new Float32Array(total);
  let anySend = false;
  let done = 0;
  for (const sp of specs) {
    if (o.signal?.aborted) throw new Error('aborted');
    try {
      const [l, r] = await renderDry(sp, o);
      const k = sendLevel(sp.entry.send, o.space, o.spaceTrim);
      for (let i = 0; i < total; i++) { L[i] += l[i]; R[i] += r[i]; }
      if (k > 0) { anySend = true; for (let i = 0; i < total; i++) { sendL[i] += l[i] * k; sendR[i] += r[i] * k; } }
    } catch (err) { console.warn('[psalmist] offline instrument failed:', sp.entry.id, err); failed.push(sp.id); }
    o.onProgress?.(++done / (specs.length + 1));
  }
  if (anySend && !o.signal?.aborted) {
    try {
      const ctx = new OfflineAudioContext(2, total, o.sampleRate);
      const man = await loadReverbManifest();
      const space = man.spaces.find((s) => s.id === o.space) ?? man.spaces[0];
      const rv = createChurchReverb(ctx, await loadImpulse(ctx, space), space.preDelay, 1);
      const src = ctx.createBufferSource();
      const sb = ctx.createBuffer(2, total, o.sampleRate);
      sb.copyToChannel(sendL, 0); sb.copyToChannel(sendR, 1);
      src.buffer = sb; src.connect(rv.input); rv.output.connect(ctx.destination); src.start(0);
      const wet = await ctx.startRendering();
      const wl = wet.getChannelData(0), wr = wet.getChannelData(1);
      for (let i = 0; i < total; i++) { L[i] += wl[i]; R[i] += wr[i]; }
    } catch { /* no reverb: the dry mix stays */ }
  }
  o.onProgress?.(1);
  return { ch: [L, R], failed };
}
