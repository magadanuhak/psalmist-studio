/** Genre / emotion bias as DATA (weights added to the Viterbi score). Keys are roman numerals / chord qualities. */
import type { Emotion, Genre } from '../../model/types';
import type { ChordQuality } from './types';

export interface GenreBias {
  degree: Record<string, number>;
  quality: Partial<Record<ChordQuality, number>>;
  /** preferred progressions (roman bigrams) */
  bigrams: [string, string][];
  /** section-start preferences: first chord of strofă / refren */
  start: { strofa: Record<string, number>; refren: Record<string, number> };
  harmonicMinor: boolean;
  /** hymn: plagal "Amin" allowed at the very end */
  plagalAmen: boolean;
  satb: boolean;
  powerChords: boolean;
  /** allow colour chords and borrowed chords in variant B */
  colour: boolean;
  borrowed: boolean;
  bass: 'whole' | 'pulse8' | 'rootFifth' | 'folk';
  comp: 'block' | 'arp8' | 'beats' | 'pulse8' | 'oompah';
}

export const GENRE_BIAS: Record<Genre, GenreBias> = {
  worship: {
    degree: { I: 0.1, IV: 0.35, V: 0.1, vi: 0.35, ii: 0.05, iii: -0.1, 'vii°': -0.8, bVII: 0.1, i: 0.2, iv: 0.2, VI: 0.25, III: 0.1, VII: 0.15 },
    quality: { sus2: 0.28, add9: 0.32, sus4: 0.12, maj7: 0.08, dom7: -0.12 },
    bigrams: [['I', 'V'], ['V', 'vi'], ['vi', 'IV'], ['IV', 'I'], ['I', 'vi'], ['IV', 'V'], ['i', 'bVII'], ['bVII', 'bVI'], ['bVI', 'bVII'], ['bVII', 'i'], ['bVI', 'i'], ['i', 'bVI']],
    start: { strofa: { I: 0.4, vi: 0.2 }, refren: { IV: 0.5, I: 0.35 } },
    harmonicMinor: false, plagalAmen: false, satb: false, powerChords: false, colour: true, borrowed: false,
    bass: 'pulse8', comp: 'arp8',
  },
  imn: {
    degree: { I: 0.2, IV: 0.2, V: 0.3, vi: 0.05, ii: 0.1, iii: -0.3, 'vii°': -0.5, i: 0.2, iv: 0.2, VI: 0.1 },
    quality: { dom7: 0.15, sus2: -0.6, sus4: -0.4, add9: -0.6, maj7: -0.3, min7: -0.2 },
    bigrams: [['I', 'IV'], ['IV', 'V'], ['V', 'I'], ['I', 'V'], ['ii', 'V'], ['IV', 'I'], ['vi', 'ii']],
    start: { strofa: { I: 0.6 }, refren: { I: 0.6 } },
    harmonicMinor: true, plagalAmen: true, satb: true, powerChords: false, colour: false, borrowed: false,
    bass: 'whole', comp: 'block',
  },
  cantare: {
    degree: { i: 0.3, iv: 0.35, V: 0.45, VI: 0.2, III: 0.15, I: 0.2, IV: 0.2, vi: 0.15, 'V7/iv': 0.1, 'vii°7': 0.1, v: -0.4 },
    quality: { dom7: 0.2, sus2: -0.3, add9: -0.2 },
    bigrams: [['i', 'iv'], ['iv', 'V'], ['V', 'i'], ['i', 'VI'], ['VI', 'V'], ['I', 'IV'], ['IV', 'V']],
    start: { strofa: { i: 0.5, I: 0.4, vi: 0.2 }, refren: { i: 0.5, I: 0.5 } },
    harmonicMinor: true, plagalAmen: true, satb: false, powerChords: false, colour: false, borrowed: true,
    bass: 'rootFifth', comp: 'beats',
  },
  pop: {
    degree: { I: 0.2, V: 0.2, vi: 0.35, IV: 0.3, ii: 0.1, iii: 0, 'vii°': -0.7, i: 0.2, VI: 0.3, VII: 0.2, III: 0.15, iv: 0.1 },
    quality: { add9: 0.15, sus4: 0.1, maj7: 0.1, min7: 0.1 },
    bigrams: [['I', 'V'], ['V', 'vi'], ['vi', 'IV'], ['I', 'vi'], ['IV', 'V'], ['i', 'bVII'], ['bVII', 'bVI'], ['bVI', 'bVII'], ['bVII', 'i'], ['bVI', 'i'], ['i', 'bVI']],
    start: { strofa: { I: 0.4, vi: 0.3 }, refren: { I: 0.4, IV: 0.3 } },
    harmonicMinor: false, plagalAmen: false, satb: false, powerChords: false, colour: true, borrowed: true,
    bass: 'rootFifth', comp: 'beats',
  },
  rock: {
    degree: { bVII: 0.4, IV: 0.3, I: 0.2, V: 0.2, vi: -0.1, ii: -0.2, iii: -0.2, 'vii°': -0.9, i: 0.3, VII: 0.4, VI: 0.3, III: 0.2, iv: 0.2 },
    quality: { sus4: 0.12, dom7: 0.05, maj7: -0.3, min7: -0.2, add9: -0.1 },
    bigrams: [['I', 'bVII'], ['bVII', 'IV'], ['IV', 'I'], ['I', 'IV'], ['i', 'bVII'], ['bVII', 'bVI'], ['bVI', 'bVII'], ['bVII', 'i']],
    start: { strofa: { I: 0.5, i: 0.5 }, refren: { I: 0.4, IV: 0.3, i: 0.4 } },
    harmonicMinor: false, plagalAmen: false, satb: false, powerChords: true, colour: false, borrowed: true,
    bass: 'pulse8', comp: 'pulse8',
  },
  popular: {
    degree: { i: 0.4, iv: 0.3, V: 0.5, VI: 0.15, III: 0.1, I: 0.2, IV: 0.2, 'V7/iv': 0.2, 'vii°7': 0.15, v: -0.5, VII: -0.1 },
    quality: { dom7: 0.3, sus2: -0.4, add9: -0.3, maj7: -0.3 },
    bigrams: [['i', 'iv'], ['iv', 'V'], ['V', 'i'], ['i', 'V'], ['I', 'IV'], ['IV', 'V'], ['V', 'I']],
    start: { strofa: { i: 0.6, I: 0.5 }, refren: { i: 0.5, I: 0.5 } },
    harmonicMinor: true, plagalAmen: false, satb: false, powerChords: false, colour: false, borrowed: true,
    bass: 'folk', comp: 'oompah',
  },
};

/** Style priors of contemporary Romanian sung genres in a MINOR key (relative degrees in semitones from the tonic). Used when a Simplitate level is set. */
export interface StylePrior {
  /** bonus for the MAJOR IV (C in G minor, Dorian / melodic-minor colour) when the melody avoids the flat 6th; a penalty when it sings it */
  majorIV: number;
  /** "refren deschis": first-chord bonus of a refren by degree (3 = III relative major, 8 = VI) */
  refrenOpen: Record<number, number>;
  /** chord-to-chord flow bonuses [from, to, bonus]: III -> VII -> iv -> i / V; VI -> VII -> i */
  flows: [number, number, number][];
  /** only at Simplitate "simplu" (the default); richer levels keep the classic scoring */
  simpluOnly?: boolean;
}
export const STYLE_PRIORS: Partial<Record<Genre, StylePrior>> = {
  cantare: { majorIV: 0.9, refrenOpen: { 3: 0.8, 8: 0.5 }, flows: [[3, 10, 0.6], [10, 5, 0.6], [5, 0, 0.4], [5, 7, 0.4], [8, 10, 0.5], [10, 0, 0.5]] },
  popular: { majorIV: 0.8, refrenOpen: { 3: 0.7, 8: 0.5 }, flows: [[3, 10, 0.6], [10, 5, 0.6], [5, 0, 0.4], [5, 7, 0.4], [8, 10, 0.5], [10, 0, 0.5]] },
  worship: { majorIV: 1.0, refrenOpen: { 3: 0.5, 8: 0.3 }, flows: [[3, 10, 0.4], [8, 10, 0.4], [10, 0, 0.4]], simpluOnly: true },
  pop: { majorIV: 1.0, refrenOpen: { 3: 0.5, 8: 0.3 }, flows: [[3, 10, 0.4], [8, 10, 0.4], [10, 0, 0.4]], simpluOnly: true },
  imn: { majorIV: 0.4, refrenOpen: { 3: 0.3, 8: 0.2 }, flows: [[5, 7, 0.3], [5, 0, 0.3]] },
};

export interface EmotionBias {
  degree: Record<string, number>;
  quality: Partial<Record<ChordQuality, number>>;
  /** extra willingness to end a non-final phrase with a deceptive cadence (V–vi) */
  deceptive: number;
}

export const EMOTION_BIAS: Record<Emotion, EmotionBias> = {
  trist: { degree: { vi: 0.4, iv: 0.3, i: 0.2, VI: 0.2 }, quality: { min7: 0.2 }, deceptive: 0.4 },
  rugaciune: { degree: { vi: 0.35, iv: 0.3, IV: 0.2, i: 0.15 }, quality: { min7: 0.2, sus2: 0.15, add9: 0.1 }, deceptive: 0.2 },
  biruinta: { degree: { I: 0.25, IV: 0.25, V: 0.3, i: 0.1 }, quality: { add9: 0.2 }, deceptive: 0 },
  lauda: { degree: { I: 0.25, IV: 0.25, V: 0.25 }, quality: { add9: 0.2, sus4: 0.1 }, deceptive: 0 },
  vesel: { degree: { I: 0.25, IV: 0.25, V: 0.25 }, quality: { add9: 0.15 }, deceptive: 0 },
  energic: { degree: { I: 0.15, IV: 0.2, V: 0.25, bVII: 0.15 }, quality: { sus4: 0.15 }, deceptive: 0 },
  epic: { degree: { i: 0.2, VI: 0.4, III: 0.3, VII: 0.4, bVI: 0.35, bVII: 0.35, IV: 0.1 }, quality: {}, deceptive: 0.3 },
  nostalgic: { degree: { iv: 0.5, vi: 0.25, bVI: 0.2 }, quality: { maj7: 0.15 }, deceptive: 0.3 },
  linistit: { degree: { I: 0.1, IV: 0.2, vi: 0.2 }, quality: { sus2: 0.3, maj7: 0.3, add9: 0.2 }, deceptive: 0 },
  dramatic: { degree: { i: 0.2, iv: 0.2, VI: 0.2, 'V/vi': 0.2, 'vii°7': 0.2 }, quality: { dim7: 0.15, dom7: 0.15 }, deceptive: 0.5 },
  romantic: { degree: { vi: 0.2, IV: 0.2, ii: 0.2, 'V7/ii': 0.1 }, quality: { maj7: 0.2, min7: 0.2 }, deceptive: 0.2 },
  inchinare: { degree: { vi: 0.25, IV: 0.3, I: 0.1 }, quality: { sus2: 0.2, add9: 0.2 }, deceptive: 0.1 },
};

/** Typical 4-chord loops (roman numerals) of modern genres; a loop wins when it fits the melody about as well as free harmonization. */
export interface LoopSet { major: string[][]; minor: string[][]; bonus: number; /** per-slot bonus for loops in a major key (melody fit counts more there) */ bonusMajor?: number; /** the single most idiomatic minor loop gets an extra bonus */ topMinor?: { loop: string[]; bonus: number } }
const NONE: LoopSet = { major: [], minor: [], bonus: 0 };
export const LOOPS: Record<Genre, LoopSet> = {
  worship: {
    major: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'vi', 'V'], ['vi', 'IV', 'I', 'V'], ['I', 'vi', 'IV', 'V']],
    minor: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'bVI', 'bIII', 'bVII'], ['i', 'iv', 'bVI', 'bVII'], ['i', 'bVII', 'bVI', 'iv']],
    bonus: 3.0, bonusMajor: 0.6, topMinor: { loop: ['i', 'bVII', 'bVI', 'bVII'], bonus: 25 },
  },
  pop: {
    major: [['I', 'V', 'vi', 'IV'], ['I', 'vi', 'IV', 'V'], ['vi', 'IV', 'I', 'V']],
    minor: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'bVI', 'bIII', 'bVII'], ['i', 'bVI', 'iv', 'bVII']],
    bonus: 3.0, bonusMajor: 0.6, topMinor: { loop: ['i', 'bVII', 'bVI', 'bVII'], bonus: 25 },
  },
  rock: { major: [['I', 'bVII', 'IV', 'I'], ['I', 'IV', 'V', 'IV']], minor: [['i', 'bVII', 'bVI', 'bVII'], ['i', 'bVI', 'bVII', 'i']], bonus: 1.2 },
  imn: NONE, cantare: NONE, popular: NONE,
};
