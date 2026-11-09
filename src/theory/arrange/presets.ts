/** Genre / emotion presets as DATA (A2). GM program numbers are 0-based. */
import type { Emotion, Genre } from '../../model/types';
import type { GenrePreset, TrackDef } from './types';

export const GM = {
  piano: 0, rhodes: 4, dulcimer: 15, organ: 19, accordion: 21, nylon: 24, steel: 25, cleanE: 27, overdrive: 29,
  distortion: 30, acBass: 32, fingerBass: 33, pickBass: 34, violin: 40, strings: 48, panFlute: 75, warmPad: 89,
} as const;

/** GM percussion keys (channel 10) */
export const DR = {
  kick: 36, rim: 37, snare: 38, clap: 39, hatC: 42, hatP: 44, hatO: 46, tomLo: 41, tomMid: 45, tomHi: 50,
  crash: 49, ride: 51, tamb: 54, cowbell: 56, shaker: 70, claves: 75,
} as const;
export const DRUM_LO = 35;
export const DRUM_HI = 81;

const O = 'off' as const;

const t = (d: TrackDef): TrackDef => d;

const PIAN = t({ id: 'pian', name: 'Pian', gm: GM.piano, role: 'harm', sampler: 'salamander', inst: 'piano', lo: 36, hi: 96, level: 0.62, pan: -0.1, tone: 'piano', styles: ['arp4', 'arp4', 'arp8', 'arp8', 'arp8'] });
const PAD = t({ id: 'pad', name: 'Pad', gm: GM.warmPad, role: 'harm', inst: 'warm_pad', lo: 36, hi: 96, level: 0.42, pan: 0, tone: 'pad', styles: ['sustain', 'sustain', 'sustain', 'sustain', 'sustain'] });

export const GENRE_PRESETS: Record<Genre, GenrePreset> = {
  worship: {
    genre: 'worship', bassApproach: true,
    tracks: [
      PIAN, PAD,
      t({ id: 'chit', name: 'Chitară acustică', gm: GM.steel, role: 'harm', inst: 'emily_guitar', lo: 40, hi: 84, level: 0.5, pan: -0.35, tone: 'rhythm', styles: [O, O, 'strum', 'strum', 'strum'] }),
      t({ id: 'chitE', name: 'Chitară electrică ambientală', gm: GM.cleanE, role: 'harm', inst: 'ambient_electric', lo: 40, hi: 88, level: 0.4, pan: 0.4, tone: 'colour', styles: [O, O, O, 'swell', 'swell'], shift: 12 }),
      t({ id: 'cello', name: 'Violoncel', gm: GM.strings, role: 'harm', inst: 'cellos', lo: 36, hi: 72, level: 0.4, pan: -0.2, tone: 'colour', styles: [O, O, O, 'sustain', 'sustain'], voices: 1, shift: 0 }),
      t({ id: 'bas', name: 'Bas', gm: GM.fingerBass, role: 'bass', inst: 'finger_bass', lo: 28, hi: 55, level: 0.86, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'off', 'pulse8', 'pulse8', 'pulse8'] }),
      t({ id: 'tobe', name: 'Tobe', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.58, pan: 0, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['off', 'sparse', 'kit', 'kit8', 'kit8'] }),
    ],
  },
  imn: {
    genre: 'imn', bassApproach: false,
    tracks: [
      t({ id: 'orga', name: 'Orgă de biserică', gm: GM.organ, role: 'harm', inst: 'church_organ', lo: 36, hi: 96, level: 0.5, pan: 0, tone: 'pad', styles: ['sustain', 'sustain', 'beats', 'beats', 'beats'] }),
      t({ id: 'corzi', name: 'Corzi', gm: GM.strings, role: 'harm', inst: 'violins', lo: 55, hi: 96, level: 0.42, pan: 0.2, tone: 'colour', styles: [O, O, 'sustain', 'sustain', 'beats'], voices: 3, shift: 12 }),
      t({ id: 'cor', name: 'Cor – Aaa', gm: 52, role: 'harm', inst: 'choir_aahs', lo: 48, hi: 84, level: 0.34, pan: 0, tone: 'pad', styles: [O, O, 'sustain', 'sustain', 'sustain'], voices: 3 }),
      t({ id: 'bas', name: 'Bas', gm: GM.acBass, role: 'bass', inst: 'acoustic_bass', lo: 28, hi: 55, level: 0.82, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['whole', 'whole', 'half', 'half', 'half'] }),
    ],
  },
  cantare: {
    genre: 'cantare', bassApproach: true,
    tracks: [
      t({ id: 'acor', name: 'Acordeon', gm: GM.accordion, role: 'harm', inst: 'accordion', lo: 41, hi: 89, level: 0.32, pan: -0.15, tone: 'rhythm', styles: ['sustain', 'sustain', 'oompah', 'oompah', 'oompah'] }),
      t({ id: 'bas', name: 'Contrabas', gm: GM.acBass, role: 'bass', inst: 'contrabass', lo: 28, hi: 55, level: 0.84, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'rootFifth', 'rootFifth', 'rootFifth', 'rootFifth'] }),
      t({ id: 'clar', name: 'Clarinet', gm: 71, role: 'harm', inst: 'clarinet', lo: 55, hi: 88, level: 0.4, pan: -0.3, tone: 'colour', styles: [O, O, O, 'holdTop', 'holdTop'], voices: 1 }),
      t({ id: 'vioara', name: 'Vioară', gm: GM.violin, role: 'harm', inst: 'violin_solo', lo: 55, hi: 100, level: 0.46, pan: 0.3, tone: 'colour', styles: [O, O, 'holdTop', 'holdTop', 'holdTop'], voices: 1 }),
      t({ id: 'perc', name: 'Percuție', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.45, pan: 0.15, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['off', 'off', 'perc', 'perc', 'percFull'] }),
    ],
  },
  pop: {
    genre: 'pop', bassApproach: true,
    tracks: [
      PIAN,
      t({ id: 'corzi', name: 'Corzi', gm: GM.strings, role: 'harm', inst: 'violins', lo: 55, hi: 96, level: 0.42, pan: 0.2, tone: 'colour', styles: [O, O, 'sustain', 'sustain', 'sustain'], voices: 3, shift: 12 }),
      t({ id: 'chitE', name: 'Chitară electrică (clean)', gm: GM.cleanE, role: 'harm', inst: 'clean_electric', lo: 40, hi: 88, level: 0.4, pan: -0.4, tone: 'rhythm', styles: [O, O, 'strum', 'strum', 'strum'] }),
      t({ id: 'bas', name: 'Bas', gm: GM.fingerBass, role: 'bass', inst: 'finger_bass', lo: 28, hi: 55, level: 0.84, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'rootFifth', 'rootFifth', 'rootFifth', 'rootFifth'] }),
      t({ id: 'tobe', name: 'Tobe', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.5, pan: 0, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['off', 'sparse', 'kit', 'kit8', 'kit8'] }),
    ],
  },
  rock: {
    genre: 'rock', bassApproach: false,
    tracks: [
      t({ id: 'chit1', name: 'Chitară ritm', gm: GM.overdrive, role: 'harm', inst: 'overdrive_guitar', lo: 40, hi: 84, level: 0.5, pan: -0.5, tone: 'rhythm', styles: ['strum', 'strum', 'strum', 'pulse8', 'pulse8'] }),
      t({ id: 'chit2', name: 'Chitară distorsionată', gm: GM.distortion, role: 'harm', inst: 'overdrive_guitar', lo: 40, hi: 88, level: 0.44, pan: 0.5, tone: 'rhythm', styles: [O, O, 'strum', 'pulse8', 'pulse8'], shift: 12 }),
      t({ id: 'bas', name: 'Bas', gm: GM.pickBass, role: 'bass', inst: 'finger_bass', lo: 28, hi: 55, level: 0.88, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['rootFifth', 'rootFifth', 'rootFifth', 'pulse8', 'pulse8'] }),
      t({ id: 'tobe', name: 'Tobe', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.62, pan: 0, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['kit', 'kit', 'kit', 'rock', 'rock'] }),
    ],
  },
  popular: {
    genre: 'popular', bassApproach: false,
    tracks: [
      t({ id: 'acor', name: 'Acordeon', gm: GM.accordion, role: 'harm', inst: 'accordion', lo: 41, hi: 89, level: 0.32, pan: -0.2, tone: 'rhythm', styles: ['oompah', 'oompah', 'oompah', 'oompah', 'oompah'] }),
      t({ id: 'taml', name: 'Ţambal', gm: GM.dulcimer, role: 'harm', inst: 'dulcimer', lo: 48, hi: 96, level: 0.45, pan: 0.35, tone: 'colour', styles: [O, 'arp4', 'arp8', 'arp8', 'arp8'] }),
      t({ id: 'vioara', name: 'Vioară', gm: GM.violin, role: 'harm', inst: 'violin_solo', lo: 55, hi: 100, level: 0.46, pan: 0.25, tone: 'colour', styles: [O, O, 'holdTop', 'holdTop', 'holdTop'], voices: 1 }),
      t({ id: 'nai', name: 'Nai', gm: GM.panFlute, role: 'harm', inst: 'pan_flute', lo: 55, hi: 96, level: 0.4, pan: -0.3, tone: 'colour', styles: [O, O, O, 'holdTop', 'holdTop'], voices: 1, shift: 12 }),
      t({ id: 'bas', name: 'Contrabas', gm: GM.acBass, role: 'bass', inst: 'contrabass', lo: 28, hi: 55, level: 0.84, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'folk', 'folk', 'folk', 'folk'] }),
      t({ id: 'tobe', name: 'Tobe populare', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.52, pan: 0, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['off', 'hora', 'hora', 'hora', 'hora'] }),
    ],
  },
};

export interface EmotionArr {
  /** velocity multiplier */
  vel: number;
  /** shift of the effective energy used for instruments and patterns (never below 1 / above 5) */
  shift: number;
  /** reverb send 0..127 */
  reverb: number;
  /** only these tones play (calm emotions); undefined = all */
  only?: TrackDef['tone'][];
  noDrums?: boolean;
  noElectric?: boolean;
}

export const EMOTION_ARR: Record<Emotion, EmotionArr> = {
  rugaciune: { vel: 0.72, shift: -1, reverb: 78, only: ['pad', 'piano'], noDrums: true },
  linistit: { vel: 0.78, shift: -1, reverb: 64, noDrums: true, noElectric: true },
  inchinare: { vel: 0.88, shift: 0, reverb: 60 },
  trist: { vel: 0.8, shift: -1, reverb: 56 },
  nostalgic: { vel: 0.84, shift: 0, reverb: 62 },
  romantic: { vel: 0.86, shift: 0, reverb: 56 },
  dramatic: { vel: 0.98, shift: 0, reverb: 50 },
  lauda: { vel: 1.0, shift: 0, reverb: 40 },
  vesel: { vel: 1.0, shift: 0, reverb: 34 },
  energic: { vel: 1.06, shift: 1, reverb: 30 },
  epic: { vel: 1.06, shift: 1, reverb: 58 },
  biruinta: { vel: 1.06, shift: 1, reverb: 52 },
};

/** Accompaniment velocities stay under the sung line. */
export const ACC_VEL_MAX = 0.86;

/** "Acustic (live)": real instruments only (Salamander piano, VSCO 2 cello, violas, violins); no synth pads, organs or SoundFont sounds. The flute (hook, answers) and the cello counter-line
 *  come from the melodic layers (LAYER_INST). Default for worship and pop; the classic palette stays selectable. */
export const ACOUSTIC_PRESETS: Partial<Record<Genre, GenrePreset>> = {
  worship: {
    genre: 'worship', bassApproach: true,
    tracks: [
      PIAN,
      t({ id: 'cello', name: 'Violoncel', gm: GM.strings, role: 'bass', inst: 'cellos', lo: 36, hi: 60, level: 0.7, pan: -0.2, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['whole', 'whole', 'half', 'half', 'half'] }),
      t({ id: 'bas', name: 'Contrabas (arco)', gm: GM.acBass, role: 'bass', inst: 'contrabass', lo: 28, hi: 55, level: 0.62, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'whole', 'whole', 'whole', 'whole'] }),
    ],
  },
  pop: {
    genre: 'pop', bassApproach: true,
    tracks: [
      PIAN,
      t({ id: 'cello', name: 'Violoncel', gm: GM.strings, role: 'bass', inst: 'cellos', lo: 36, hi: 60, level: 0.7, pan: -0.2, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'whole', 'half', 'half', 'half'] }),
      t({ id: 'corzi', name: 'Corzi', gm: GM.strings, role: 'harm', inst: 'violins', lo: 55, hi: 96, level: 0.36, pan: 0.2, tone: 'colour', styles: [O, O, 'sustain', 'sustain', 'sustain'], voices: 3, shift: 12 }),
    ],
  },
};

/** "Vesel" (cheerful): piano off-beat chords / oom-pah (vals in 3/4 and 6/8), acoustic guitar strums, root-fifth bass with walk-ups,
 *  a light kit, a flute answering in the pauses. Available for every genre; the default of cantare / popular. No organ, no pads. */
export const veselPreset = (genre: Genre): GenrePreset => ({
  genre, bassApproach: true,
  tracks: [
    t({ ...PIAN, level: 0.5, pan: 0.25, styles: [O, 'beats', 'beats', 'oompah', 'oompah'] }), // piano + guitar carry the off-beat / oom-pah role (the accordion is only in the instrument picker)
    t({ id: 'chit', name: 'Chitară acustică', gm: GM.steel, role: 'harm', inst: 'emily_guitar', lo: 40, hi: 84, level: 0.55, pan: -0.35, tone: 'rhythm', styles: [O, 'strum', 'strum', 'strum', 'strum'] }),
    t({ id: 'bas', name: 'Bas', gm: GM.fingerBass, role: 'bass', inst: 'finger_bass', lo: 28, hi: 55, level: 0.8, pan: 0, tone: 'bass', styles: [O, O, O, O, O], bassStyles: ['off', 'rootFifth', 'rootFifth', 'folk', 'folk'] }),
    t({ id: 'tobe', name: 'Percuție ușoară', gm: 0, role: 'drums', inst: 'drum_kit', lo: 35, hi: 81, level: 0.45, pan: 0, tone: 'drums', styles: [O, O, O, O, O], drumStyles: ['off', 'sparse', 'sparse', 'kit', 'kit'] }),
  ],
});
/** default palette of a genre: organ only in Imn (Clasic, picked by the user), Acustic for worship / pop, Vesel for everything else */
export const defaultPalette = (genre: Genre): 'acustic' | 'clasic' | 'vesel' => (genre === 'imn' ? 'clasic' : genre === 'worship' || genre === 'pop' ? 'acustic' : 'vesel');

/** melodic layers that are OFF until the user switches them on: the answers sounded random to listeners in Acustic / Vesel (opt-in) */
export const defaultLayersOff = (palette: 'acustic' | 'clasic' | 'vesel'): ('answers')[] => (palette === 'clasic' ? [] : ['answers']);
