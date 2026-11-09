import { describe, expect, it } from 'vitest';
import { ACOUSTIC_PRESETS, defaultPalette, GENRE_PRESETS, veselPreset } from './presets';
import type { Genre } from '../../model/types';

const GENRES = Object.keys(GENRE_PRESETS) as Genre[];
const presetOf = (g: Genre) => { const p = defaultPalette(g); return p === 'vesel' ? veselPreset(g) : p === 'acustic' ? ACOUSTIC_PRESETS[g] ?? GENRE_PRESETS[g] : GENRE_PRESETS[g]; };

describe('default palettes', () => {
  it('no default palette carries an accordion or an organ (the organ only in Imn / Clasic)', () => {
    for (const g of GENRES) {
      const ids = presetOf(g).tracks.map((t) => t.inst ?? '');
      expect(ids, g).not.toContain('accordion');
      if (g !== 'imn') expect(ids.some((i) => /organ/.test(i)), g).toBe(false);
    }
  });
  it('Vesel: guitar + piano carry the rhythm, with a bass and a light kit', () => {
    const ids = veselPreset('cantare').tracks.map((t) => t.inst);
    expect(ids).toEqual(expect.arrayContaining(['emily_guitar', 'piano', 'finger_bass']));
    expect(defaultPalette('cantare')).toBe('vesel');
    expect(defaultPalette('imn')).toBe('clasic');
  });
});
