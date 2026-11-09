/** Arrangement data model (M4). Pure data, no React, no audio. */
import type { Emotion, Genre, KeySig, SectionType, TimeSig } from '../../model/types';
import type { Chord } from '../harmony/types';

export type Style =
  | 'off' | 'sustain' | 'strum' | 'arp4' | 'arp8' | 'oompah' | 'pulse8' | 'swell' | 'holdTop' | 'beats';
export type BassStyle = 'off' | 'whole' | 'half' | 'rootFifth' | 'pulse8' | 'folk';
export type DrumStyle = 'off' | 'sparse' | 'kit' | 'kit8' | 'rock' | 'perc' | 'percFull' | 'hora';
export type TrackRole = 'harm' | 'bass' | 'drums';
export type Energy = 1 | 2 | 3 | 4 | 5;

/** One instrument of a genre preset. `styles[e-1]` is what it plays at energy e. */
export interface TrackDef {
  id: string;
  name: string;            // Romanian label
  gm: number;              // GM program (0-based)
  role: TrackRole;
  /** play through the bundled Salamander piano instead of the SoundFont */
  sampler?: 'salamander';
  /** catalog instrument (src/audio/instruments/catalog.ts); the user may swap it per track */
  inst?: string;
  /** practical range of the instrument (MIDI) */
  lo: number; hi: number;
  /** default mixer level 0..1 (accompaniment sits under the voice) */
  level: number;
  /** pan -1..1 */
  pan: number;
  /** pad/organ/strings/piano... kind used for the whitelist of calm emotions */
  tone: 'piano' | 'pad' | 'colour' | 'rhythm' | 'bass' | 'drums';
  styles: [Style, Style, Style, Style, Style];
  bassStyles?: [BassStyle, BassStyle, BassStyle, BassStyle, BassStyle];
  drumStyles?: [DrumStyle, DrumStyle, DrumStyle, DrumStyle, DrumStyle];
  /** sit one octave higher / lower than the shared voicing when the range allows */
  shift?: -12 | 0 | 12;
  /** how many of the top voices of the voicing it plays (0 = all) */
  voices?: number;
}

export interface GenrePreset { genre: Genre; tracks: TrackDef[]; bassApproach: boolean }

export interface ArrNote { midi: number; startSec: number; durSec: number; vel: number; /** articulation id of the instrument (sampler) */ art?: string; /** attack time in seconds (bow swell, breath) */ atk?: number }

export interface ArrTrack {
  id: string;
  name: string;
  gm: number;
  /** MIDI channel 0..15 (drums = 9) */
  channel: number;
  drums: boolean;
  sampler?: 'salamander';
  /** catalog instrument id (set by the preset, or by the user's choice) */
  inst?: string;
  level: number;
  pan: number;
  /** 0..127 reverb send */
  reverb: number;
  notes: ArrNote[];
}

export interface PlanSection {
  id: string;
  type: SectionType;
  label: string;
  bars: number;
  startSec: number;
  durSec: number;
  startBar: number;
  /** nominal energy 1..5 (user override applied) */
  energy: Energy;
  /** build / fade: energy moves linearly from `energy` to `rampTo` across the section */
  rampTo?: Energy;
  /** how the chords of the section came about */
  chordSource: 'own' | 'copy' | 'generated' | 'none';
  chords: PlannedChord[];
  /** track ids that play at least one note in this section */
  active: string[];
}

export interface PlannedChord {
  /** beats from section start */
  startBeat: number;
  beats: number;
  startSec: number;
  durSec: number;
  chord: Chord;
  phraseEnd: boolean;
}

export interface Marker { time: number; text: string }

export interface Transition { kind: 'fill' | 'crash' | 'drop' | 'swell' | 'ritardando' | 'holdChord'; sectionId: string; timeSec: number }

export interface MelodicInfo {
  hook: string;
  perSection: Record<string, { lead: number; answers: number; counter: number }>;
  voiceClass: 'low' | 'mid' | 'high';
}

export interface Arrangement {
  /** outro ritardando time warp (see warpTime) */
  ritard?: { fromSec: number; beat: number; n: number; k: number };
  /** M5 melodic layers (filled by addMelodicLayers) */
  melodic?: MelodicInfo;
  tracks: ArrTrack[];
  plan: PlanSection[];
  /** end of the song in seconds (includes the ritardando / held last chord) */
  songSec: number;
  markers: Marker[];
  transitions: Transition[];
  register: { mode: 'above' | 'below'; lo: number; hi: number; vocalLo: number; vocalHi: number };
}

export interface ArrVocalNote { midi: number; startSec: number; durSec: number }

export interface ArrSectionInput {
  id: string;
  type: SectionType;
  label: string;
  bars: number;
  /** vocal notes in section time (sung material, copies carry their source's notes) */
  notes: ArrVocalNote[];
  /** chords of the section (own or inherited from the source), null when none yet */
  chords: { startBeat: number; beats: number; chord: Chord; phraseEnd: boolean }[] | null;
  /** true for copies of a source section (chords inherited) */
  isCopy?: boolean;
}

export interface ArrangeInput {
  genre: Genre;
  emotion: Emotion;
  key: KeySig;
  bpm: number;
  sig: TimeSig;
  sections: ArrSectionInput[];
  /** user energy per section id */
  energy?: Record<string, number>;
  /** one bar of silence before the final refren */
  drop?: boolean;
  /** ritardando + held last chord in the outro (default true) */
  ritardando?: boolean;
  /** instrument palette: 'acustic' (real instruments only; worship / pop) or the classic one; undefined = classic */
  palette?: 'acustic' | 'clasic' | 'vesel';
}

export type MelodicLayer = 'lead' | 'answers' | 'counter';

export interface ArrangementSettings {
  v: 1;
  energy: Record<string, number>;
  drop: boolean;
  /** seed of the melodic layers ("Regenerează" changes it) */
  /** semitones the backing track is transposed by (recommended key, "Transpune minusul") */
  transpose?: number;
  seed?: number;
  /** vocal effect overrides (0..1 sends) and ducking depth in dB */
  fx?: { reverb?: number; delay?: number; duckDb?: number; on?: boolean };
  /** pan per track id (-1..1) */
  pans?: Record<string, number>;
  /** melodic layers switched off by the user */
  layersOff?: MelodicLayer[];
  /** catalog instrument per track id (the user's choice) */
  instruments?: Record<string, string>;
  /** tempo map: song time of every bar's downbeat (smoothed taps); the whole arrangement is warped through it */
  tempoMap?: number[];
  /** instrument palette of the project (default: Acustic for worship and pop) */
  palette?: 'acustic' | 'clasic' | 'vesel';
  /** church reverb space (studio | capela | biserica | catedrala | sala); default by genre */
  space?: string;
  /** reverb amount trim 0..1.5 (1 = default) */
  spaceLevel?: number;
  /** "Variantă AI": rule-filtered notes of the local generator that replace a layer's rule-based notes (key = track id) */
  aiVariants?: Record<string, { notes: ArrNote[]; kept: number; input: number }>;
}
