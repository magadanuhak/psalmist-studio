import type { SectionHarmony } from '../theory/harmony/types';
import type { ArrangementSettings } from '../theory/arrange/types';

export const MODEL_VERSION = 2;

export type Genre = 'worship' | 'imn' | 'cantare' | 'pop' | 'rock' | 'popular';
export type Emotion =
  | 'trist' | 'romantic' | 'vesel' | 'energic' | 'epic' | 'nostalgic' | 'linistit' | 'dramatic'
  | 'inchinare' | 'lauda' | 'rugaciune' | 'biruinta';
export type SectionType = 'intro' | 'strofa' | 'prerefren' | 'refren' | 'bridge' | 'interlude' | 'outro';
export type Mode = 'major' | 'minor';

export interface TimeSig { num: number; den: number; grouping: number[] }
export interface KeySig { tonic: number; mode: Mode } // tonic = pitch class 0..11
export interface KeyCandidate extends KeySig { score: number }
export interface KeyEstimate extends KeySig { confidence: number; top3: KeyCandidate[]; ambiguous?: boolean }

export interface Note {
  id: string;
  midi: number;
  startSec: number;
  durSec: number;
  velocity: number; // 0..1
  centsDev: number;
  confidence: number;
  isChromaticIntent?: boolean;
}

export interface Pause { startSec: number; durSec: number }

export interface PitchTrack {
  hopSec: number;
  hz: Float32Array;       // 0 = unvoiced
  voicedProb: Float32Array;
  rms: Float32Array;
}

export interface Analysis {
  pitchTrack: PitchTrack;
  notes: Note[];
  pauses: Pause[];
  rangeMidi: { lo: number; hi: number } | null;
  keyEstimate: KeyEstimate | null;
  /** global tuning of the voice vs A440 in cents (+ sharp); 0 when intonation is too unstable */
  tuningCents: number;
  /** 0..1 concentration of the cents deviations; < 0.3 means unstable intonation */
  tuningConcentration: number;
}

export interface NoiseProfile { mean: number[]; std: number[]; fftSize: number; sampleRate: number }

export type QuantGrid = '1/4' | '1/8' | '1/16' | '1/8T';
export interface CorrectionSettings {
  snapToKey: boolean;
  quantizeStrength: number; // 0..100
  grid: QuantGrid;
  swing: boolean;
  cleanup: boolean;
}

export interface Take {
  id: string;
  rawAudioId: string;
  cleanAudioId?: string;
  /** every cleaning result kept for A/B; `cleanAudioId` is the active one */
  cleanIds?: { classic?: string; ai?: string; restore?: string };
  cleanKind?: 'classic' | 'ai' | 'restore';
  noiseProfile?: NoiseProfile;
  latencyMs: number;
  durationSec: number;
  createdAt: number;
  source: 'mic' | 'import';
  label?: string;
  /** true once the user hand-edited notesCorrected (settings no longer auto-apply) */
  manuallyEdited?: boolean;
  /** accompaniment follows the voice tuning, or is kept at 440 while the voice is shifted */
  tuningMode?: 'follow' | 'a440';
  analysis?: Analysis;
  notesOriginal: Note[];
  notesCorrected: Note[];
  correction: CorrectionSettings;
}

export interface Section {
  id: string;
  type: SectionType;
  label: string;
  order: number;
  bars: number;
  takes: Take[];
  activeTakeId: string | null;
  generated: boolean;
  /** for generated copies of a strofa/refren: id of the recorded source section */
  sourceSectionId?: string;
  /** chords (M3), stored on the recorded source section; copies inherit */
  harmony?: SectionHarmony;
}

/** A take of the whole song sung over the backing track (final recording). Audio index 0 = song time 0. */
export interface FinalTake {
  id: string;
  audioId: string;
  durationSec: number;
  latencyMs: number;
  createdAt: number;
  label: string;
  /** song range this take actually covers (a punch-in covers one section) */
  range: [number, number];
}
export interface FinalRecording { takes: FinalTake[]; /** chosen take per section id (comping) */ comp: Record<string, string> }

export interface Voice { id: string; role: 'lead' | 'backing'; name: string }

export interface MomentFlag { id: string; at: number; /** nearest accompaniment note per track at that moment */ near: { track: string; midi: number; start: number; dur: number }[]; createdAt: number }

export interface Project {
  id: string;
  name: string;
  version: number;
  genre: Genre;
  emotion: Emotion;
  timeSig: TimeSig;
  bpm: number;
  key: KeySig | null;
  keyLocked: boolean;
  roomTone?: NoiseProfile;
  /** moments the listener marked as strange ("Semnalează aici"): reviewed against the anomaly detector */
  flags?: MomentFlag[];
  sections: Section[];
  voices: Voice[];
  chords?: unknown[];      // M3
  /** user choices of the arrangement (M4): energy per section, drop before the last refren */
  arrangement?: ArrangementSettings;
  /** final recording over the minus (X0) */
  final?: FinalRecording;
  /** harmony busyness; undefined = Simplu */
  simplicity?: 'simplu' | 'normal' | 'bogat';
  /** the bar grid is exact (tapped by the user): the beat map never re-anchors on the first note */
  gridExact?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_CORRECTION: CorrectionSettings = {
  snapToKey: true, quantizeStrength: 70, grid: '1/8', swing: false, cleanup: true,
};
