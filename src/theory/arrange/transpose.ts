import type { ArrangeInput } from './types';

const pc = (m: number) => ((m % 12) + 12) % 12;

/** The whole arrangement input moved by `t` semitones: key, chord roots and the vocal line that the register policy follows. */
export function transposeInput(inp: ArrangeInput, t: number): ArrangeInput {
  if (!t) return inp;
  return {
    ...inp,
    key: { tonic: pc(inp.key.tonic + t), mode: inp.key.mode },
    sections: inp.sections.map((s) => ({
      ...s,
      notes: s.notes.map((n) => ({ ...n, midi: n.midi + t })),
      chords: s.chords ? s.chords.map((c) => ({ ...c, chord: { ...c.chord, root: pc(c.chord.root + t) } })) : null,
    })),
  };
}
