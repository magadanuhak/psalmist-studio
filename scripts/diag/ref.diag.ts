import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { analyze } from '../../src/dsp/analyze';
import { correctNotes } from '../../src/dsp/correct';
import { readWav } from '../../src/dsp/wavFixture';
import { DEFAULT_CORRECTION, type Genre, type Project, type Section } from '../../src/model/types';
import { TIME_SIGS } from '../../src/music/timesig';
import { buildHarmony, harmonyInputFor } from '../../src/store/harmonyInput';
import { chordName } from '../../src/theory/harmony/index';
import { midiName } from '../../src/music/theory';
it('ref', () => {
  const BPM = 85, sig = TIME_SIGS[0].sig;
  const { data, sr } = readWav('C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/ref2/v1.wav');
  const a = analyze(data, sr, BPM);
  const key = { tonic: a.keyEstimate!.tonic, mode: a.keyEstimate!.mode };
  const cor = correctNotes(a.notes, key, BPM, sig, DEFAULT_CORRECTION);
  const out: string[] = [];
  out.push('key ' + JSON.stringify(a.keyEstimate) + ' tuning ' + a.tuningCents + ' conc ' + a.tuningConcentration?.toFixed?.(2));
  out.push('range ' + JSON.stringify(a.rangeMidi) + ' notes ' + cor.length + ' pauses>=1beat ' + a.pauses.filter(p => p.durSec >= 60 / BPM).length);
  out.push('first notes: ' + cor.map(n => midiName(n.midi, 'letter') + '@' + n.startSec.toFixed(1)).join(' '));
  const bars = Math.round(data.length / sr * BPM / 60 / 4);
  for (const genre of ['cantare', 'worship', 'imn'] as Genre[]) {
    const sec: Section = { id: 's1', type: 'strofa', label: 'S', order: 0, bars, generated: false, activeTakeId: 't1',
      takes: [{ id: 't1', rawAudioId: 'r', latencyMs: 0, durationSec: data.length / sr, createdAt: 0, source: 'import', notesOriginal: a.notes, notesCorrected: cor, correction: DEFAULT_CORRECTION, analysis: a }] };
    const p: Project = { id: 'p', name: 'ref', version: 1, genre, emotion: 'inchinare', timeSig: sig, bpm: BPM, key, keyLocked: true, sections: [sec], voices: [], createdAt: 0, updatedAt: 0 } as Project;
    const inp = harmonyInputFor(p, sec); if (typeof inp === 'string') { out.push(genre + ' ERR ' + inp); continue; }
    const h = buildHarmony(inp);
    out.push(genre + ' rate/slots ' + h.slots.length + ' A: ' + h.variants.A.map((c, i) => h.slots[i].startSec.toFixed(1) + ' ' + chordName(c, 'letter', key)).join(' | '));
  }
  writeFileSync('C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/ref2/app-result.txt', out.join('\n'));
});
