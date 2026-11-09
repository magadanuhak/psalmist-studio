export { generateMelodicLayers, strongPositions } from './generate';
export {
  extractHook, defaultHook, hookToMotif, sequenceMotif, invertMotif, fragmentMotif, augmentMotif, diminishMotif, ornamentMotif,
  scalePcs, scaleMidis, shiftDiatonic,
} from './motif';
export type { Motif } from './motif';
export { INSTRUMENT_RANGES, rangeOf, GENRES, EMOTIONS, ENERGY_DENSITY, makeRng } from './data';
export type * from './types';
