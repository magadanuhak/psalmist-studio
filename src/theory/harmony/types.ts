/** Harmony data model (M3). Pure data, no React. Chords are stored per section on the recorded source section. */
export type VariantId = 'A' | 'B' | 'C';
export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'dom7' | 'maj7' | 'min7' | 'hdim7' | 'dim7' | 'sus2' | 'sus4' | 'add9';
export type Func = 'T' | 'S' | 'D';
export type CadenceKind = 'authentic' | 'half' | 'plagal' | 'deceptive';
export type HarmonicRate = 'auto' | 0.5 | 1 | 2;
/** How busy the harmony is: Simplu = i/iv/V held 1-2 bars, Normal = at most one chord per bar, Bogat = also 2 per bar, 7ths, secondary dominants */
export type Simplicity = 'simplu' | 'normal' | 'bogat';

export interface Chord {
  root: number;            // pitch class 0..11
  quality: ChordQuality;
  roman: string;           // e.g. "V7", "vi", "bVII", "V/vi"
  func: Func;
}

export interface HarmonySlot {
  idx: number;
  bar: number;             // 0-based bar of slot start
  startBeat: number;       // beats from section start
  beats: number;
  startSec: number;
  durSec: number;
  phraseEnd: boolean;
}

export interface SectionHarmony {
  version: 1;
  rate: HarmonicRate;
  slots: HarmonySlot[];
  variants: Record<VariantId, Chord[]>;
  active: VariantId;
  /** user-locked chords per variant, keyed by slot index */
  locks: Record<VariantId, Record<number, Chord>>;
  /** signature of the melody the chords were made for (stale detection) */
  notesSig: string;
  generatedAt: number;
}

export const VARIANTS: VariantId[] = ['A', 'B', 'C'];
export const chordKey = (c: Pick<Chord, 'root' | 'quality'>) => `${c.root}-${c.quality}`;
