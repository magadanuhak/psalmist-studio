import { describe, expect, it } from 'vitest';
import { findAnomalies } from './anomaly';
import type { Arrangement, ArrNote, ArrTrack } from './types';

const track = (id: string, notes: ArrNote[]): ArrTrack => ({ id, name: id, gm: 0, channel: 0, drums: false, level: 0.5, pan: 0, reverb: 0, notes });
const arr = (tracks: ArrTrack[]): Arrangement => ({
  tracks, songSec: 20, markers: [], transitions: [], register: { mode: 'above', lo: 60, hi: 80, vocalLo: 50, vocalHi: 70 },
  plan: [{ id: 's', type: 'strofa', label: 's', bars: 4, startSec: 0, durSec: 8, startBar: 0, energy: 3, chordSource: 'own', active: [], chords: [{ startBeat: 0, beats: 16, startSec: 0, durSec: 8, chord: { root: 0, quality: 'maj' } as never, phraseEnd: false }] }],
});
const o = { key: { tonic: 0, mode: 'major' as const }, vocal: [], beatSec: 0.5, beatsPerBar: 4 };

describe('A4 anomaly detector', () => {
  it('a clean arrangement has 0 anomalies', () => {
    const a = arr([track('pian', [60, 64, 67].map((m, i) => ({ midi: m, startSec: i * 2, durSec: 1.5, vel: 0.5 })))]);
    expect(findAnomalies(a, o)).toEqual([]);
  });
  it('flags a tiny note, an off-key strong-beat note, a big leap and an answer over the voice', () => {
    const a = arr([
      track('pian', [{ midi: 60, startSec: 0, durSec: 0.04, vel: 0.5 }, { midi: 61, startSec: 2, durSec: 1, vel: 0.5 }]),
      track('answers', [{ midi: 60, startSec: 4, durSec: 0.5, vel: 0.5 }, { midi: 78, startSec: 4.6, durSec: 0.5, vel: 0.5 }]),
    ]);
    const kinds = findAnomalies(a, { ...o, vocal: [{ midi: 62, startSec: 4, durSec: 1.5 }] }).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['tinyNote', 'outOfKey', 'bigLeap', 'answerOverVoice']));
  });
  it('flags an out-of-range note', () => {
    const a = arr([track('hook', [{ midi: 100, startSec: 1, durSec: 1, vel: 0.5 }])]);
    expect(findAnomalies(a, { ...o, rangeOf: () => [60, 96] }).map((x) => x.kind)).toContain('outOfRange');
  });
});
