/** M5 melodic-layers engine: pure data types (no React, no audio). */
export type GenreId = 'worship' | 'imn' | 'cantare' | 'pop' | 'rock' | 'popular';
export type EmotionId =
  | 'trist' | 'romantic' | 'vesel' | 'energic' | 'epic' | 'nostalgic' | 'linistit' | 'dramatic'
  | 'inchinare' | 'lauda' | 'rugaciune' | 'biruinta';
export type SectionKind = 'intro' | 'strofa' | 'prerefren' | 'refren' | 'bridge' | 'interlude' | 'outro';

export interface ChordSlotIn {
  startSec: number;
  durSec: number;
  /** chord pitch classes 0..11 */
  pcs: number[];
  /** root pitch class */
  root: number;
  /** harmonic function: 'T' | 'S' | 'D' (or a roman numeral); informational */
  function: string;
}
export interface SectionIn {
  type: SectionKind;
  startSec: number;
  bars: number;
  /** 1..5 */
  energy: number;
  chords: ChordSlotIn[];
}
export interface VocalNoteIn { midi: number; startSec: number; durSec: number }
export interface PauseIn { startSec: number; durSec: number }
/** `den` unit = grid unit; `grouping` is in den units (7/8 -> [3,2,2]). 4/4 with grouping [4] is treated as [2,2]. */
export interface MeterIn { num: number; den: number; grouping: number[] }
export interface KeyIn { tonic: number; mode: 'major' | 'minor' | 'harmonicMinor' }

export interface MelodyInput {
  sections: SectionIn[];
  vocalNotes: VocalNoteIn[];
  vocalPauses: PauseIn[];
  key: KeyIn;
  meter: MeterIn;
  /** quarter-note BPM. "beat" in margins/pause thresholds = 60/bpm seconds. */
  bpm: number;
  genre: GenreId;
  emotion: EmotionId;
  vocalRange: { low: number; high: number };
  seed: number | string;
}

export interface OutNote { midi: number; startSec: number; durSec: number; vel: number }
export type TrackRole = 'lead' | 'answers' | 'counter';
export interface OutTrack { name: string; role: TrackRole; gmProgram: number; channel: number; notes: OutNote[] }

export interface Hook {
  pitches: number[];
  /** onsets relative to the first note, in beats (60/bpm) */
  onsetsBeats: number[];
  durBeats: number[];
  intervals: number[];
  source: 'refren' | 'song' | 'default';
}

export interface MelodyDiagnostics {
  hook: Hook;
  voiceClass: 'low' | 'mid' | 'high';
  instruments: { lead: number; answers: number; counter: number };
  counts: { lead: number; answers: number; counter: number };
  /** outro ritardando flag for the playback engine (tempo factor applied from `fromSec` to the end) */
  ritardando: { flag: boolean; fromSec: number; toSec: number; factor: number };
  answerWindows: { startSec: number; endSec: number }[];
  ms: number;
}

export interface MelodyResult { tracks: OutTrack[]; diagnostics: MelodyDiagnostics }
