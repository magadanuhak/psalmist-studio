/** Types for the local AI service (ai-service/, http://127.0.0.1:5175). */

export type AiErrorCode =
  | 'offline' // service not running / unreachable
  | 'timeout' // request took longer than the configured timeout
  | 'aborted' // caller aborted via AbortSignal
  | 'not_ready' // service is up but models are still loading
  | 'bad_request' // 4xx: unusable input (bad audio, bad chord chart, ...)
  | 'server'; // 5xx / unexpected response

export type ModelStatus = 'idle' | 'loading' | 'ready' | `error: ${string}`;

export interface AiModelInfo {
  name: string;
  status: ModelStatus;
  license: string;
}

export interface AiHealth {
  ok: boolean;
  service: string;
  api_version: string;
  uptime_s: number;
  device: 'cuda' | 'cpu';
  gpu: { name: string; vram_total_mb: number; vram_free_mb: number; compute_capability: string } | null;
  models: { denoise: AiModelInfo; separate: AiModelInfo; accompany: AiModelInfo };
  versions: Record<string, string | null>;
}

/** Coarse state for UI: show "Curățare AI" only when `ready` (or `loading` with a hint). */
export type AiState = 'offline' | 'loading' | 'ready' | 'error';

export interface AiStatus {
  state: AiState;
  health: AiHealth | null;
  /** per feature availability */
  available: { denoise: boolean; separate: boolean; accompany: boolean };
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** overrides the default timeout of that call (ms) */
  timeoutMs?: number;
  /** 0..1; denoise reports only 0 then 1 (single request), separate/accompany report real progress */
  onProgress?: (fraction: number) => void;
}

export interface DenoiseOptions extends RequestOptions {
  /** limit the noise attenuation (dB), e.g. 12 keeps some ambience. Omit for full suppression. */
  attenLimDb?: number;
}

export type AudioInput = Blob | ArrayBuffer | Uint8Array;

export type DemucsModel = 'htdemucs' | 'htdemucs_ft' | 'htdemucs_6s';
export type WavFormat = 'pcm16' | 'pcm24' | 'float';

export interface SeparateOptions extends RequestOptions {
  model?: DemucsModel;
  /** stem name ('vocals', 'drums', ...) -> `<stem>` + `no_<stem>`; 'all' = every stem of the model. Default 'vocals'. */
  twoStems?: string;
  /** test-time augmentation passes 0..10 (quality vs time) */
  shifts?: number;
  /** 0..0.95 */
  overlap?: number;
  /** segment length in seconds (clamped to the model maximum) */
  segment?: number;
  format?: WavFormat;
}

export interface SeparateResult {
  /** every output stem as audio/wav (44.1 kHz stereo). Two-stems mode: `vocals`, `no_vocals` and alias `accompaniment`. */
  stems: Record<string, Blob>;
  vocals?: Blob;
  accompaniment?: Blob;
  /** server cache key (file hash + params): pass to analyzeSong / analyzePart / practice / stemUrl */
  cacheKey: string;
  cacheHit: boolean;
  model: string;
  /** 10*log10(|mix - sum(stems)|^2 / |mix|^2); htdemucs ~ -31..-35 dB */
  residualDb: number | null;
  seconds: number;
  /** server-side compute time of the model (ms) */
  modelMs: number;
}

export interface SeparateModels {
  models: Record<string, { stems: string[]; note: string }>;
  formats: WavFormat[];
  default: string;
}

export interface RhythmAnalysis {
  ok: boolean;
  error?: string;
  duration: number;
  /** pulse tempo of the drum grid (bpm of one beat); bar = beatsPerBar * 60 / pulseBpm seconds */
  bpm: number;
  pulse_bpm: number;
  beats_per_bar: number;
  bar_seconds: number | null;
  beats: number[];
  downbeats: number[];
  tempo_map: { t: number; bpm: number }[];
  groove: {
    slots_per_bar: number;
    pattern: { kick: number[]; snare: number[]; hat: number[] };
    micro_timing_ms: number[];
    /** position of the off-beat 8th inside the beat: 0.5 straight .. 0.667 triplet */
    swing: number;
    bars_used: number;
  };
  method: string;
}

export interface BassAnalysis {
  ok: boolean;
  notes: { t: number; dur: number; midi: number; level: number }[];
  roots_per_segment: { t: number; end: number; root: string }[];
  pitch_class_hist: number[];
}

export interface ChordAnalysis {
  ok: boolean;
  method: string;
  chords: { t: number; end: number; chord: string }[];
  fallback_reason?: string;
}

export interface KeyEstimate {
  key: string;
  mode: 'major' | 'minor';
  confidence: number;
}

export interface AnalysisParts {
  rhythm: RhythmAnalysis;
  bass: BassAnalysis;
  chords: ChordAnalysis;
  key: KeyEstimate;
}

export interface SongAnalysis {
  cache_key: string;
  model: string;
  seconds: number;
  rhythm: RhythmAnalysis;
  bass: BassAnalysis;
  chords: ChordAnalysis;
  key: KeyEstimate;
  /** hand-off: the vocals stem (use client.stemUrl(cache_key, 'vocals')) for the "Din vocea completă" flow */
  vocals: { cache_key: string; stem: string; url: string; hint: string } | null;
  harmonic_stems: string[];
  separation: { model: string; residual_db: number; model_ms: number; stems: string[]; cache_hit: boolean };
}

export interface PracticeRequest {
  cacheKey?: string;
  /** stems to sum, e.g. ['no_vocals'] (default) or ['drums','bass','other'] */
  stems?: string[];
  audio?: AudioInput;
  /** -6..+6 */
  semitones?: number;
  /** 0.70..1.20 */
  tempo?: number;
  format?: WavFormat;
}

export interface BatchResult {
  aggregate: Record<string, unknown>;
  songs: { name_hash: string; index: number; stats?: Record<string, unknown>; residual_db?: number; error?: string }[];
  stats_file: string;
}

export type ChordSpec = string | { bar: number; beat?: number; symbol: string };

export interface AccompanyRequest {
  melodyMidi: Blob | ArrayBuffer | Uint8Array;
  /** tonic name, e.g. "G", "F#", "Bb" */
  key: string;
  mode?: 'major' | 'minor';
  /** "4/4" | "3/4" | "6/8" | "2/4" | "7/8" ... */
  meter: string;
  /** quarter-note BPM (for 6/8 pass dotted-quarter bpm * 1.5) */
  bpm: number;
  bars: number;
  /** one chord symbol per bar, or explicit {bar, beat, symbol} entries (bar is 0-based after the pickup) */
  chords: ChordSpec[];
  /** anacrusis length in quarter-note beats; MIDI time 0 is the start of the pickup */
  pickupBeats?: number;
  /** worship | hymn | pop | ballad | rock | folk | popular | piano | strings | guitar | bass | full */
  style?: string;
  /** GM programs the model may generate (overrides the style) */
  instruments?: number[];
  /** GM program of the rule-based chord bed fed to the model; null/false disables it */
  skeleton?: number | null | false;
  nCandidates?: number; // 1..8, default 1
  topP?: number;
  temperature?: number;
  seed?: number;
  /** snap to a 16th (or 1/6 beat for compound) grid and repair pitches (default true) */
  quantize?: boolean;
  includeMelody?: boolean;
}

export interface AccompanyCandidate {
  index: number;
  seed: number | null;
  /** Standard MIDI file bytes (type 1, 480 tpb, request tempo/meter/key). One track per GM program. */
  midi: Uint8Array;
  notes: number;
  programs: number[];
  genMs: number;
}

export interface AccompanyResult {
  candidates: AccompanyCandidate[];
  bars: number;
  bpm: number;
  meter: string;
  totalSeconds: number;
  /** wall time of the whole job on the server (ms) */
  elapsedMs: number;
}

export interface AccompanyStyles {
  styles: Record<string, { skeleton: number | null; generated: number[] }>;
  instruments: Record<string, { role: 'harmony' | 'bass' | 'pad'; low: number; high: number }>;
}

// ---------------------------------------------------------------- A6: beats / structure / pitch / restore / assistant

export interface BeatsResult {
  ok: boolean;
  error?: string;
  bpm: number;
  beats_per_bar: number;
  bar_seconds: number | null;
  beats: number[];
  downbeats: number[];
  tempo_map: { t: number; bpm: number }[];
  method: string;
  elapsed_ms: number;
}

export type StructureLabel = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro' | 'interlude';

export interface StructureSegment {
  start: number;
  end: number;
  bars: number;
  label: StructureLabel;
  /** matching app SectionType */
  section_type: 'strofa' | 'refren' | 'bridge' | 'intro' | 'outro' | 'interlude';
  cluster: number;
}

export interface StructureResult {
  ok: boolean;
  error?: string;
  segments: StructureSegment[];
  beats: number[];
  downbeats: number[];
  bpm: number;
  beats_per_bar: number;
  bar_seconds: number | null;
  method: string;
  elapsed_ms: number;
}

export interface PitchOptions extends RequestOptions {
  fmin?: number;
  fmax?: number;
  /** 'full' (accurate, default) | 'tiny' (faster) */
  model?: 'full' | 'tiny';
  /** periodicity below this = unvoiced (default 0.3) */
  voicingThreshold?: number;
}

export interface PitchResult {
  hop_ms: number;
  frames: number;
  model: string;
  /** Hz per 10 ms frame, 0 = unvoiced */
  f0_hz: number[];
  voicing: number[];
  voiced: boolean[];
  elapsed_ms: number;
}

export type AssistantTask = 'patch' | 'explain' | 'coach' | 'chords';

export interface AssistantPatch {
  /** only known fields with allowed values (constrained decoding + server-side validation + grounding in the request) */
  patch: Partial<{
    genre: 'worship' | 'imn' | 'cantare' | 'pop' | 'rock' | 'popular';
    emotion: string;
    bpm: number;
    timeSig: string;
    mode: 'major' | 'minor';
    tonic: string;
    simplicity: 'simplu' | 'normal' | 'bogat';
  }> &
    Record<string, unknown>;
  /** what the server dropped (unknown field / value not allowed / out of range) */
  rejected: string[];
  explanation: string;
  valid: boolean;
  elapsed_ms: number;
}

export interface AssistantText {
  text: string;
  elapsed_ms: number;
}

export interface AssistantStatus {
  installed: boolean;
  running: boolean;
  model: string;
  idle_unload_s: number;
  needs_mb: number;
  free_mb: number;
}
