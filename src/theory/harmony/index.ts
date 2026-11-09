import { harmonize, notesSignature, type HarmonizeInput } from './harmonize';
import type { SectionHarmony, VariantId } from './types';

export * from './types';
export * from './chords';
export * from './bias';
export * from './rhythm';
export * from './beatmap';
export * from './harmonize';
export * from './voicing';
export * from './render';

/** Run the harmonizer and package the result as stored section data. Locks are kept where slots still exist. */
export function buildSectionHarmony(inp: HarmonizeInput, prev?: SectionHarmony | null): SectionHarmony {
  const locks = prev ? prev.locks : { A: {}, B: {}, C: {} };
  const res = harmonize({ ...inp, locks });
  const kept: SectionHarmony['locks'] = { A: {}, B: {}, C: {} };
  for (const v of ['A', 'B', 'C'] as VariantId[]) {
    for (const [k, c] of Object.entries(locks[v] ?? {})) if (Number(k) < res.slots.length) kept[v][Number(k)] = c;
  }
  return {
    version: 1,
    rate: inp.rate ?? 'auto',
    slots: res.slots,
    variants: res.variants,
    active: prev?.active ?? 'A',
    locks: kept,
    notesSig: notesSignature(inp.notes),
    generatedAt: Date.now(),
  };
}
