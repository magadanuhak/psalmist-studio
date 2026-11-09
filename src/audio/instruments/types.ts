/** Shared types for the M7 instrument layer. Pure types, no runtime imports. */

export type Family =
  | 'keys' | 'organ' | 'strings' | 'woodwinds' | 'brass' | 'guitars' | 'basses'
  | 'folk' | 'choir' | 'synth' | 'mallets' | 'percussion' | 'drums';

/** A = real samples (CC0/CC-BY, shipped in public/instruments), B = General MIDI SoundFont fallback, C = synthesized in code. */
export type Tier = 'A' | 'B' | 'C';

export type Genre = 'worship' | 'imn' | 'cantare' | 'pop' | 'rock' | 'popular';
export type Role = 'lead' | 'comp' | 'pad' | 'bass' | 'fx' | 'perc' | 'melody' | 'counter';

export type SourceRef =
  | { type: 'manifest'; id: string }            // sampled set: public/instruments/<id>/manifest.json
  | { type: 'gm'; program: number }             // MuseScore General SoundFont, melodic program 0..127
  | { type: 'gm-drums' }                        // SoundFont percussion channel
  | { type: 'synth'; preset: string }           // Tone.js factory in synth.ts
  | { type: 'salamander' }                       // existing Salamander piano in public/samples
  | { type: 'user'; id: string };               // user-recorded instrument stored in IndexedDB

export interface CatalogEntry {
  id: string;
  name: string;                 // Romanian display name
  family: Family;
  tier: Tier;
  source: SourceRef;
  /** GM program used while samples load, or when loading fails (null for drums / pure synths). */
  gmFallback: number | null;
  /** Playable MIDI range; the arrangement must keep notes inside. */
  range: [number, number];
  /** Articulation ids this instrument understands (first = default). Must match the manifest for tier A. */
  articulations: string[];
  genres: Genre[];
  roles: Role[];
  /** Default stereo position -1..1 and send level (0..1) to the church reverb. */
  pan: number;
  send: number;
  /** Default level trim in dB inside the mixer. */
  gainDb: number;
  /** Note used by the picker preview. */
  preview: number;
  mono?: boolean;
}

// ---- sample manifest (written by scripts/instruments/build.mjs) ----------------------------------

export interface SampleEntry {
  key: number;                  // MIDI note of the recording (hits: 60)
  layers: number[];             // velocity layer indexes served by this file
  file: string;                 // relative to the manifest directory
  dur: number;                  // seconds
  loopStart?: number;           // seconds; loop is [loopStart, loopEnd] (crossfade already baked in)
  loopEnd?: number;
  rr?: number;                  // round-robin index (hits)
  cents?: number;               // residual tuning of the recording (user instruments); the sampler compensates
}
export interface ArticulationSet { loop: boolean; nLayers: number; samples: SampleEntry[] }
export interface InstrumentManifest {
  id: string; name: string; family: Family; kind: 'pitched' | 'hits'; tier: 'A'; version: number;
  genres: string[]; license: string; attribution: string | null;
  source: { library: string; url: string; files: number };
  stereo: boolean; sampleRate: number;
  range: [number, number];
  release: number;              // seconds
  layers: number[];             // upper velocity bound (0..1) of each layer
  defaultArticulation: string;
  articulations: Record<string, ArticulationSet>;
  bytes: number;
}
export interface InstrumentIndex { [id: string]: { manifest: string; bytes: number; files: number } }
