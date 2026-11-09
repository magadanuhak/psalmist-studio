/**
 * Manifest-driven sampler: sample selection (pure, tested), lazy loader with Cache Storage + progress,
 * and a Web Audio voice player that works on any BaseAudioContext (live or OfflineAudioContext for export).
 */
import type { ArticulationSet, InstrumentManifest, SampleEntry } from './types';

export interface PickResult { sample: SampleEntry; layer: number; /** semitones to shift the buffer (playbackRate = 2^(shift/12)) */ shift: number; art: string }

/** Velocity (0..1) -> layer index using the manifest's upper bounds. */
export function layerFor(m: Pick<InstrumentManifest, 'layers'>, vel: number): number {
  const v = Math.min(1, Math.max(0, vel));
  for (let i = 0; i < m.layers.length; i++) if (v <= m.layers[i]) return i;
  return m.layers.length - 1;
}

/**
 * Choose the recording for a note. Pitched: nearest key that serves the layer (ties go to the lower key, so
 * the buffer is pitched up rather than down). Hits: round-robin cycle over `rr`.
 */
export function pickSample(m: InstrumentManifest, articulation: string | undefined, midi: number, vel: number, rr = 0): PickResult | null {
  const art = articulation && m.articulations[articulation] ? articulation : m.defaultArticulation;
  const set: ArticulationSet | undefined = m.articulations[art];
  if (!set || !set.samples.length) return null;
  const layer = layerFor(m, vel);
  let pool = set.samples.filter((s) => s.layers.includes(Math.min(layer, set.nLayers - 1)));
  if (!pool.length) pool = set.samples;
  if (m.kind === 'hits') {
    const rrs = pool.slice().sort((a, b) => (a.rr ?? 0) - (b.rr ?? 0));
    return { sample: rrs[Math.abs(rr) % rrs.length], layer, shift: 0, art };
  }
  let best = pool[0];
  for (const s of pool) {
    const d = Math.abs(s.key - midi), bd = Math.abs(best.key - midi);
    if (d < bd || (d === bd && s.key < best.key)) best = s;
  }
  return { sample: best, layer, shift: midi - best.key, art };
}

/** Velocity (0..1) -> linear gain; gentle curve so soft notes stay audible. */
export function velocityGain(vel: number): number { const v = Math.min(1, Math.max(0, vel)); return 0.18 + 0.82 * Math.pow(v, 1.35); }

/** Typical attack time by family/articulation (seconds). */
export function attackFor(m: Pick<InstrumentManifest, 'family'>, art: string): number {
  if (art === 'stac' || art === 'spic' || art === 'pizz' || art === 'pluck' || art === 'hit') return 0.002;
  if (m.family === 'strings') return 0.045;
  if (m.family === 'woodwinds' || m.family === 'brass') return 0.03;
  if (m.family === 'organ') return 0.012;
  return 0.006;
}

// ---- loading ------------------------------------------------------------------------------------

export interface LoadOptions {
  baseUrl?: string;                         // default `${BASE_URL}instruments/`
  fetchFn?: (url: string) => Promise<Response>;
  articulations?: string[];                 // subset to preload (default: only the default articulation => fast first play)
  onProgress?: (loaded: number, total: number) => void;
  cacheName?: string | null;                // Cache Storage bucket; null disables
  concurrency?: number;
}

export const INSTRUMENT_CACHE = 'psalmist-instruments-v1';
function defaultBase(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b}instruments/`;
}

async function cachedFetch(url: string, o: LoadOptions): Promise<ArrayBuffer> {
  const doFetch = o.fetchFn ?? ((u: string) => fetch(u));
  const name = o.cacheName === undefined ? INSTRUMENT_CACHE : o.cacheName;
  const cs: CacheStorage | undefined = typeof caches !== 'undefined' ? caches : undefined;
  if (name && cs) {
    try {
      const c = await cs.open(name);
      const hit = await c.match(url);
      if (hit) return await hit.arrayBuffer();
      const r = await doFetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      void c.put(url, r.clone()).catch(() => undefined);
      return await r.arrayBuffer();
    } catch (e) { if (e instanceof Error && e.message.startsWith('HTTP')) throw e; }
  }
  const r = await doFetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.arrayBuffer();
}

export async function loadManifest(id: string, o: LoadOptions = {}): Promise<InstrumentManifest> {
  const buf = await cachedFetch(`${o.baseUrl ?? defaultBase()}${id}/manifest.json`, { ...o, cacheName: null });
  return JSON.parse(new TextDecoder().decode(buf)) as InstrumentManifest;
}

export async function loadInstrument(ctx: BaseAudioContext, id: string, o: LoadOptions = {}): Promise<SampleInstrument> {
  const m = await loadManifest(id, o);
  const inst = new SampleInstrument(ctx, m, o);
  await inst.ensureArticulations(o.articulations ?? [m.defaultArticulation], o.onProgress);
  return inst;
}

// ---- playback -----------------------------------------------------------------------------------

export interface PlayOptions {
  articulation?: string;
  rr?: number;
  /** extra gain multiplier (linear) */
  gain?: number;
  /** stereo position -1..1 (needs createStereoPanner) */
  pan?: number;
  /** cents added on top of the pitch shift (humanize / bends) */
  detune?: number;
  /** fixed attack in seconds (overrides the family default; used for swells) */
  attack?: number;
}
export interface Voice { stop(at?: number): void; readonly endTime: number }

export class SampleInstrument {
  readonly buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<void>>();
  private rrCounter = new Map<string, number>();
  output: AudioNode | null = null;
  constructor(readonly ctx: BaseAudioContext, readonly manifest: InstrumentManifest, private opts: LoadOptions = {}) {}

  get loadedArticulations(): string[] {
    return Object.keys(this.manifest.articulations).filter((a) => this.manifest.articulations[a].samples.every((s) => this.buffers.has(`${a}/${s.file}`)));
  }

  /** Load (and decode) every file of the given articulations. Safe to call repeatedly / concurrently. */
  async ensureArticulations(arts: string[], onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const jobs: { key: string; file: string }[] = [];
    for (const a of arts) for (const s of this.manifest.articulations[a]?.samples ?? []) if (!this.buffers.has(`${a}/${s.file}`)) jobs.push({ key: `${a}/${s.file}`, file: s.file });
    const uniq = [...new Map(jobs.map((j) => [j.key, j])).values()];
    let done = 0; const total = uniq.length; onProgress?.(0, total);
    const base = `${this.opts.baseUrl ?? defaultBase()}${this.manifest.id}/`;
    let next = 0;
    const worker = async () => {
      while (next < uniq.length) {
        const j = uniq[next++];
        let p = this.pending.get(j.key);
        if (!p) {
          p = (async () => {
            const ab = await cachedFetch(base + j.file, this.opts);
            this.buffers.set(j.key, await this.ctx.decodeAudioData(ab));
          })();
          this.pending.set(j.key, p);
        }
        await p; done++; onProgress?.(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.opts.concurrency ?? 6, Math.max(1, uniq.length)) }, worker));
  }

  /** Schedule a note. Returns a handle (stop early with a release). Silent no-op when the buffer is not loaded. */
  play(midi: number, when: number, dur: number, vel = 0.8, po: PlayOptions = {}): Voice | null {
    const m = this.manifest;
    const key = `${po.articulation ?? ''}:${m.id}`;
    const rr = po.rr ?? this.rrCounter.get(key) ?? 0; this.rrCounter.set(key, rr + 1);
    const pick = pickSample(m, po.articulation, midi, vel, rr);
    if (!pick) return null;
    const buf = this.buffers.get(`${pick.art}/${pick.sample.file}`);
    if (!buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pick.shift / 12);
    const det = (po.detune ?? 0) - (pick.sample.cents ?? 0);
    // wrapped contexts (Tone / standardized-audio-context) may not expose `detune`: fold the cents into the playback rate then
    if (det) { if (src.detune) src.detune.value = det; else src.playbackRate.value *= Math.pow(2, det / 1200); }
    const s = pick.sample;
    const looped = s.loopStart != null && s.loopEnd != null && dur > s.loopStart;
    if (looped) { src.loop = true; src.loopStart = s.loopStart!; src.loopEnd = s.loopEnd!; }
    const g = ctx.createGain(); const peak = velocityGain(vel) * (po.gain ?? 1);
    const atk = po.attack ?? attackFor(m, pick.art); const rel = Math.max(0.03, m.release);
    const hold = Math.max(atk + 0.005, dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + atk);
    const naturalEnd = when + s.dur / Math.max(0.25, src.playbackRate.value);
    const sustained = looped || m.kind === 'pitched' && (pick.art === 'sus' || pick.art === 'full' || pick.art === 'soft' || pick.art === 'vib' || pick.art === 'trem' || pick.art === 'bow' || pick.art === 'mute');
    let end: number;
    if (sustained) {
      g.gain.setValueAtTime(peak, when + hold);
      g.gain.setTargetAtTime(0, when + hold, rel / 4);
      end = when + hold + rel * 1.2;
    } else { // decaying instruments ring out; hits keep their full tail
      end = naturalEnd;
      if (m.kind === 'pitched' && dur + rel < s.dur) { g.gain.setValueAtTime(peak, when + hold); g.gain.setTargetAtTime(0, when + hold, rel / 3); end = when + hold + rel * 1.3; }
    }
    let node: AudioNode = g;
    src.connect(g);
    if (po.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, po.pan)); g.connect(p); node = p; }
    if (this.output) node.connect(this.output); else node.connect(ctx.destination);
    src.start(when); src.stop(end);
    let stopped = false;
    return {
      endTime: end,
      stop: (at = ctx.currentTime) => {
        if (stopped) return; stopped = true;
        const t = Math.max(at, when);
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, rel / 4);
        try { src.stop(t + rel * 1.2); } catch { /* already stopped */ }
      },
    };
  }

  dispose(): void { this.buffers.clear(); this.pending.clear(); }
}
