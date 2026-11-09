/**
 * "Instrumentul tau": build a playable sampler from single notes recorded by the user.
 * Pure logic (pitch labelling via src/dsp/pitch, trimming, levelling, loop baking) + IndexedDB helpers.
 */
import { openDB } from 'idb';
import { trackPitch } from '../../dsp/pitch';
import type { CatalogEntry, InstrumentManifest, SampleEntry } from './types';
import { SampleInstrument } from './sampler';

export const USER_SR = 44100;

export interface NoteAnalysis {
  midi: number;
  /** residual tuning in cents of the recording vs the equal-tempered note */
  cents: number;
  hz: number;
  confidence: number;
  /** seconds of voiced signal */
  voicedSec: number;
}

/** Label a single recorded note with the shared pitch tracker (median f0 of the stable middle part). */
export function analyzeNote(audio: Float32Array, sr: number): NoteAnalysis | null {
  if (audio.length < sr * 0.15) return null;
  const tr = trackPitch(audio, sr, { fmin: 40, fmax: 2200, hopSec: 0.01 });
  let maxRms = 0; for (const r of tr.rms) if (r > maxRms) maxRms = r;
  if (maxRms < 1e-4) return null;
  const idx: number[] = [];
  for (let i = 0; i < tr.hz.length; i++) if (tr.hz[i] > 0 && tr.voicedProb[i] > 0.5 && tr.rms[i] > maxRms * 0.15) idx.push(i);
  if (idx.length < 8) return null;
  const a = Math.floor(idx.length * 0.2), b = Math.ceil(idx.length * 0.8);
  const mid = idx.slice(a, b);
  const hzs = mid.map((i) => tr.hz[i]).sort((x, y) => x - y);
  const hz = hzs[Math.floor(hzs.length / 2)];
  const mf = 69 + 12 * Math.log2(hz / 440); const midi = Math.round(mf);
  const conf = mid.reduce((s, i) => s + tr.voicedProb[i], 0) / mid.length;
  return { midi, cents: (mf - midi) * 100, hz, confidence: conf, voicedSec: idx.length * tr.hopSec };
}

export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return Float32Array.from(x);
  const n = Math.floor((x.length * to) / from); const o = new Float32Array(n); const k = from / to;
  for (let i = 0; i < n; i++) { const p = i * k; const j = Math.floor(p); const f = p - j; o[i] = x[j] * (1 - f) + (x[Math.min(x.length - 1, j + 1)] ?? 0) * f; }
  return o;
}

function rmsWin(x: Float32Array, i0: number, n: number): number { let s = 0; const e = Math.min(x.length, i0 + n); for (let i = i0; i < e; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, e - i0)); }

export interface PreparedSample { data: Float32Array; dur: number; loopStart?: number; loopEnd?: number; sustained: boolean }

/** Trim silence, fade, cap length; bake a crossfaded loop when the note is a stable sustained tone. */
export function prepareSample(audio: Float32Array, sr: number, maxSec = 6): PreparedSample | null {
  let x = sr === USER_SR ? Float32Array.from(audio) : resampleLinear(audio, sr, USER_SR);
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-4) return null;
  const win = Math.round(0.005 * USER_SR);
  let s = 0; while (s + win < x.length && rmsWin(x, s, win) < peak * 0.03) s += win;
  s = Math.max(0, s - win);
  let e = x.length - win; while (e > s + win && rmsWin(x, e, win) < peak * 0.012) e -= win;
  e = Math.min(x.length, e + Math.round(0.06 * USER_SR), s + Math.round(maxSec * USER_SR));
  x = x.slice(s, e);
  if (x.length < USER_SR * 0.25) return null;
  const n = x.length;
  const fi = Math.round(0.003 * USER_SR); for (let i = 0; i < fi; i++) x[i] *= i / fi;
  const dur = n / USER_SR;
  // sustained? compare level of late windows with the middle ones
  const w = Math.round(0.05 * USER_SR); const levels: number[] = [];
  for (let t = Math.round(0.35 * USER_SR); t + w < n - Math.round(0.1 * USER_SR); t += w) levels.push(rmsWin(x, t, w));
  const sustained = dur >= 1.2 && levels.length >= 5 && Math.min(...levels) > 0.5 * Math.max(...levels);
  if (sustained) {
    const ls = Math.max(0.4, dur * 0.4); const xfN = Math.floor(Math.min(0.25, (dur - ls) * 0.45, ls * 0.5) * USER_SR); const lsn = Math.floor(ls * USER_SR);
    for (let i = 0; i < xfN; i++) { const wgt = (i + 1) / xfN; x[n - xfN + i] = x[n - xfN + i] * (1 - wgt) + x[lsn - xfN + i] * wgt; }
    return { data: x, dur, loopStart: +ls.toFixed(4), loopEnd: +dur.toFixed(4), sustained: true };
  }
  const fo = Math.min(n, Math.round(0.12 * USER_SR)); for (let i = 0; i < fo; i++) { const g = 1 - (i + 1) / fo; x[n - fo + i] *= g * g; }
  return { data: x, dur, sustained: false };
}

export interface UserSample { key: number; cents: number; dur: number; loopStart?: number; loopEnd?: number; data: Float32Array }
export interface UserInstrument { id: string; name: string; createdAt: number; sampleRate: number; range: [number, number]; samples: UserSample[] }
export interface RecordedNote { audio: Float32Array; sampleRate: number }
export type RejectReason = 'noPitch' | 'tooShort' | 'tooQuiet' | 'duplicate';
export interface BuildReport { accepted: { index: number; midi: number; cents: number }[]; rejected: { index: number; reason: RejectReason }[] }

function uid(): string { return 'u' + Math.random().toString(36).slice(2, 10); }

/**
 * Turn recorded notes into a playable instrument: label each note, keep the clearest take per pitch,
 * trim / fade / loop, level all samples to a common loudness, peak-limit.
 */
export function buildUserInstrument(notes: readonly RecordedNote[], o: { name?: string; id?: string; now?: number } = {}): { instrument: UserInstrument | null; report: BuildReport } {
  const report: BuildReport = { accepted: [], rejected: [] };
  const best = new Map<number, { index: number; an: NoteAnalysis; prep: PreparedSample }>();
  notes.forEach((nt, index) => {
    let peak = 0; for (let i = 0; i < nt.audio.length; i++) peak = Math.max(peak, Math.abs(nt.audio[i]));
    if (nt.audio.length < nt.sampleRate * 0.3) { report.rejected.push({ index, reason: 'tooShort' }); return; }
    if (peak < 0.01) { report.rejected.push({ index, reason: 'tooQuiet' }); return; }
    const an = analyzeNote(nt.audio, nt.sampleRate);
    if (!an || an.confidence < 0.5) { report.rejected.push({ index, reason: 'noPitch' }); return; }
    const prep = prepareSample(nt.audio, nt.sampleRate);
    if (!prep) { report.rejected.push({ index, reason: 'tooShort' }); return; }
    const prev = best.get(an.midi);
    if (prev) {
      const better = an.confidence * an.voicedSec > prev.an.confidence * prev.an.voicedSec;
      report.rejected.push({ index: better ? prev.index : index, reason: 'duplicate' });
      if (!better) return;
    }
    best.set(an.midi, { index, an, prep });
  });
  if (!best.size) return { instrument: null, report };
  const items = [...best.entries()].sort((a, b) => a[0] - b[0]);
  const rms = items.map(([, v]) => rmsWin(v.prep.data, 0, Math.round(0.6 * USER_SR)));
  const target = [...rms].sort((a, b) => a - b)[Math.floor(rms.length / 2)] || 0.1;
  const samples: UserSample[] = items.map(([midi, v], i) => {
    const g = Math.min(2.5, Math.max(0.4, target / Math.max(rms[i], 1e-6)));
    const d = v.prep.data; for (let k = 0; k < d.length; k++) d[k] *= g;
    report.accepted.push({ index: v.index, midi, cents: v.an.cents });
    return { key: midi, cents: v.an.cents, dur: v.prep.dur, loopStart: v.prep.loopStart, loopEnd: v.prep.loopEnd, data: d };
  });
  let pk = 0; for (const s of samples) for (let k = 0; k < s.data.length; k++) pk = Math.max(pk, Math.abs(s.data[k]));
  const lim = 0.85 / Math.max(pk, 1e-6); if (lim < 1 || pk < 0.4) for (const s of samples) for (let k = 0; k < s.data.length; k++) s.data[k] *= Math.min(lim, 3);
  const instrument: UserInstrument = {
    id: o.id ?? uid(), name: o.name?.trim() || 'Instrumentul meu', createdAt: o.now ?? Date.now(), sampleRate: USER_SR,
    range: [samples[0].key, samples[samples.length - 1].key], samples,
  };
  return { instrument, report };
}

/** Guided prompts: MIDI notes from lo to hi roughly every minor/major third (about 6-9 notes for an octave and a half). */
export function guidedNotes(lo = 48, hi = 84, step = 4): number[] {
  const out: number[] = []; for (let m = lo; m <= hi; m += step) out.push(m);
  if (out[out.length - 1] !== hi) out.push(hi);
  return out;
}

export const userId = (ui: Pick<UserInstrument, 'id'>) => `user:${ui.id}`;

/** Manifest view of a user instrument (same schema as shipped sets, so pickSample / SampleInstrument work unchanged). */
export function userManifest(ui: UserInstrument): InstrumentManifest {
  const samples: SampleEntry[] = ui.samples.map((s) => ({ key: s.key, layers: [0], file: `${s.key}.pcm`, dur: s.dur, cents: s.cents, loopStart: s.loopStart, loopEnd: s.loopEnd }));
  return {
    id: userId(ui), name: ui.name, family: 'folk', kind: 'pitched', tier: 'A', version: 1, genres: [], license: 'user content', attribution: null,
    source: { library: 'user', url: '', files: samples.length }, stereo: false, sampleRate: ui.sampleRate, range: ui.range, release: 0.35, layers: [1],
    defaultArticulation: 'sus', articulations: { sus: { loop: samples.some((s) => s.loopStart != null), nLayers: 1, samples } }, bytes: ui.samples.reduce((a, s) => a + s.data.byteLength, 0),
  };
}

/** Build the Web Audio sampler from a stored user instrument (buffers are created directly, no network). */
export function userInstrumentToSampler(ctx: BaseAudioContext, ui: UserInstrument): SampleInstrument {
  const inst = new SampleInstrument(ctx, userManifest(ui));
  for (const s of ui.samples) {
    const b = ctx.createBuffer(1, s.data.length, ui.sampleRate);
    b.copyToChannel(s.data as Float32Array<ArrayBuffer>, 0);
    inst.buffers.set(`sus/${s.key}.pcm`, b);
  }
  return inst;
}

/** Catalog entry so the picker can list the user's instrument next to the built-in ones. */
export function userCatalogEntry(ui: UserInstrument): CatalogEntry {
  return {
    id: userId(ui), name: ui.name, family: 'folk', tier: 'A', source: { type: 'user', id: ui.id }, gmFallback: null,
    range: [ui.range[0] - 7, ui.range[1] + 7], articulations: ['sus'], genres: ['worship', 'imn', 'cantare', 'pop', 'rock', 'popular'],
    roles: ['melody', 'lead', 'comp', 'counter'], pan: 0, send: 0.2, gainDb: 0, preview: ui.range[0] + Math.round((ui.range[1] - ui.range[0]) / 2),
  };
}

// ---- storage (IndexedDB) -------------------------------------------------------------------------------

export interface UserInstrumentStore {
  put(ui: UserInstrument): Promise<void>;
  get(id: string): Promise<UserInstrument | undefined>;
  list(): Promise<{ id: string; name: string; createdAt: number; range: [number, number]; notes: number }[]>;
  delete(id: string): Promise<void>;
}

/** In-memory store (tests, private mode fallback). */
export function memoryStore(): UserInstrumentStore {
  const m = new Map<string, UserInstrument>();
  return {
    put: async (ui) => { m.set(ui.id, structuredClone(ui)); },
    get: async (id) => { const v = m.get(id); return v ? structuredClone(v) : undefined; },
    list: async () => [...m.values()].map((u) => ({ id: u.id, name: u.name, createdAt: u.createdAt, range: u.range, notes: u.samples.length })).sort((a, b) => b.createdAt - a.createdAt),
    delete: async (id) => { m.delete(id); },
  };
}

/** IndexedDB store (browser). One object store keyed by instrument id. */
export function idbStore(dbName = 'psalmist-user-instruments'): UserInstrumentStore {
  const db = () => openDB(dbName, 1, { upgrade(d) { d.createObjectStore('instruments', { keyPath: 'id' }); } });
  return {
    put: async (ui) => { await (await db()).put('instruments', ui); },
    get: async (id) => (await db()).get('instruments', id) as Promise<UserInstrument | undefined>,
    list: async () => {
      const all = (await (await db()).getAll('instruments')) as UserInstrument[];
      return all.map((u) => ({ id: u.id, name: u.name, createdAt: u.createdAt, range: u.range, notes: u.samples.length })).sort((a, b) => b.createdAt - a.createdAt);
    },
    delete: async (id) => { await (await db()).delete('instruments', id); },
  };
}
