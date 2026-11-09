import { it } from 'vitest';
import { writeFileSync } from 'fs';
import type { Genre, KeySig, Note, SectionType, TimeSig } from '../../src/model/types';
import { TIME_SIGS } from '../../src/music/timesig';
import { buildSectionHarmony } from '../../src/theory/harmony';
import { generateArrangement, type ArrangeInput, type ArrSectionInput } from '../../src/theory/arrange';
import { addMelodicLayers } from '../../src/theory/arrange/melodic';
import { realizeArrangement } from '../../src/theory/arrange/realize';

const sig: TimeSig = TIME_SIGS.find((t) => t.id === '4/4')!.sig;
const key: KeySig = { tonic: 7, mode: 'minor' };
it('thirds', () => {
  const out: string[] = [];
  for (const genre of ['worship', 'cantare', 'pop'] as Genre[]) {
    const bpm = 85;
    const beat = 60 / bpm;
    const pit = [67, 69, 70, 72, 74, 62, 65];
    const notes: Note[] = Array.from({ length: 32 }, (_, i) => ({ id: 'n' + i, midi: pit[(i * 3) % pit.length], startSec: i * beat, durSec: beat * 0.9, velocity: 0.7, centsDev: 0, confidence: 1 }));
    const mk = (type: SectionType, id: string): ArrSectionInput => {
      const h = buildSectionHarmony({ notes, key, bpm, sig, bars: 8, genre, emotion: 'inchinare', sectionType: type, nextType: null, isLastSection: false, simplicity: 'simplu' });
      const ch = h.variants[h.active];
      return { id, type, label: id, bars: 8, notes: notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec })), chords: h.slots.map((s, i) => ({ startBeat: s.startBeat, beats: s.beats, chord: ch[i], phraseEnd: s.phraseEnd })) };
    };
    const inp: ArrangeInput = { genre, emotion: 'inchinare', key, bpm, sig, sections: [mk('strofa', 's1'), mk('refren', 'r1'), mk('strofa', 's2')] };
    let arr = addMelodicLayers(inp, generateArrangement(inp), 1);
    arr = realizeArrangement(arr, { seed: 1, bpm, sig, genre, emotion: 'inchinare' });
    let withThird = 0, minorChords = 0;
    for (const s of arr.plan) for (const c of s.chords) {
      if (c.chord.quality !== 'min') continue;
      minorChords++;
      const t0 = s.startSec + c.startSec, t1 = t0 + c.durSec;
      const pcs = new Map<number, number>();
      const per: string[] = [];
      for (const t of arr.tracks) {
        if (t.drums) continue;
        const set = new Set(t.notes.filter((n) => n.startSec < t1 && n.startSec + n.durSec > t0).map((n) => ((n.midi % 12) + 12) % 12));
        per.push(t.id + ':' + [...set].join('/'));
        set.forEach((p) => pcs.set(p, (pcs.get(p) ?? 0) + 1));
      }
      const third = (c.chord.root + 3) % 12;
      if ((pcs.get(third) ?? 0) >= 2) withThird++;
      if (minorChords <= 3) out.push(`${genre} root ${c.chord.root} third ${third}: ${per.join(' | ')}`);
    }
    out.push(`${genre}: minor chords with the third in >=2 tracks: ${withThird}/${minorChords}`);
  }
  writeFileSync('C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/third.txt', out.join(String.fromCharCode(10)));
});
