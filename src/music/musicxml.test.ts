import { describe, expect, it } from 'vitest';
import { buildMusicXml } from './musicxml';
import { TIME_SIGS } from './timesig';

/** tiny well-formedness check: balanced tags, one root */
function wellFormed(x: string): boolean {
  const st: string[] = [];
  const re = /<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(x.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g, '')))) {
    if (m[4] === '/') continue;
    if (m[1]) { if (st.pop() !== m[2]) return false; } else st.push(m[2]);
  }
  return st.length === 0;
}
const sigOf = (id: string) => TIME_SIGS.find((t) => t.id === id)!.sig;

describe('X3 MusicXML', () => {
  const bpm = 90, beat = 60 / bpm;
  const mk = (sigId: string) => {
    const sig = sigOf(sigId);
    const bar = beat * sig.num;
    const notes = Array.from({ length: 24 }, (_, i) => ({ midi: 47 + (i * 3) % 9, startSec: 0.2 * 0 + i * beat * 1.5 % (bar * 8), durSec: beat * 1.2 })).sort((a, b) => a.startSec - b.startSec);
    // make them non-overlapping at beat resolution
    const clean = notes.filter((n, i) => i === 0 || n.startSec >= notes[i - 1].startSec + notes[i - 1].durSec - 1e-6).map((n) => ({ ...n, durSec: Math.min(n.durSec, beat) }));
    const chords = Array.from({ length: 8 }, (_, b) => ({ startSec: b * bar, chord: { root: [11, 7, 4, 9][b % 4], quality: (b % 2 ? 'maj' : 'min') as 'maj' | 'min' } }));
    return { sig, notes: clean, chords, bars: 8 };
  };
  for (const id of ['4/4', '3/4', '6/8', '7/8a', '5/8']) {
    it(`${id}: well-formed, all melody notes and chord symbols present, key/meter/tempo/rehearsal marks`, () => {
      const { sig, notes, chords, bars } = mk(id);
      const x = buildMusicXml({ title: 'Ești vrednic & Co', key: { tonic: 11, mode: 'minor' }, sig, bpm, notes, chords, sections: [{ label: 'Strofă', startSec: 0, bars: 4 }, { label: 'Refren', startSec: 4 * beat * sig.num, bars: 4 }] });
      expect(wellFormed(x)).toBe(true);
      expect((x.match(/<measure /g) ?? []).length).toBe(bars);
      expect((x.match(/<harmony>/g) ?? []).length).toBe(chords.length);
      expect((x.match(/<fifths>2<\/fifths>/g) ?? []).length).toBe(1); // B minor = 2 sharps
      expect(x).toContain(`<beats>${sig.num}</beats><beat-type>${sig.den}</beat-type>`);
      expect(x).toContain('<rehearsal>Strofă</rehearsal>');
      expect(x).toContain('<rehearsal>Refren</rehearsal>');
      expect(x).toContain('Ești vrednic &amp; Co');
      // every sung note appears as a pitched note starting a tie chain or a plain note (tie-stop pieces excluded)
      const pitched = (x.match(/<note><pitch>/g) ?? []).length;
      const stops = (x.match(/<tie type="stop"\/>/g) ?? []).length;
      expect(pitched - stops).toBeGreaterThanOrEqual(notes.length);
      // every measure is filled exactly
      const per = sig.num * 16 / sig.den;
      for (const m of x.split('<measure ').slice(1)) {
        const sum = [...m.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((s, d) => s + Number(d[1]), 0);
        expect(sum).toBe(per);
      }
    });
  }
  it('transposition shifts the key signature, chord roots and pitches', () => {
    const { sig, notes, chords } = mk('4/4');
    const base = { title: 't', key: { tonic: 0, mode: 'major' as const }, sig, bpm, notes, chords, sections: [{ label: 'A', startSec: 0, bars: 8 }] };
    const a = buildMusicXml(base), b = buildMusicXml({ ...base, transpose: 2 });
    expect(a).toContain('<fifths>0</fifths>');
    expect(b).toContain('<fifths>2</fifths>');
    expect(a).not.toBe(b);
  });
});
