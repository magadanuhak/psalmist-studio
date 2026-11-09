import { it } from 'vitest';
import { analyze } from '../../dsp/analyze';
import { correctNotes } from '../../dsp/correct';
import { readWav } from '../../dsp/wavFixture';
import { DEFAULT_CORRECTION } from '../../model/types';
import { TIME_SIGS } from '../../music/timesig';
import { makeCtx } from './harmonize';
import * as H from './harmonize';
it('dbg', () => {
  const { data, sr } = readWav('test-audio/real/strofa-curat.wav');
  const a = analyze(data, sr, 60);
  const key = { tonic: 11, mode: 'minor' as const };
  const notes = correctNotes(a.notes, key, 60, TIME_SIGS[0].sig, DEFAULT_CORRECTION);
  const inp = { notes, key, bpm: 60, sig: TIME_SIGS[0].sig, bars: 4, genre: 'worship' as const, emotion: 'inchinare' as const, sectionType: 'strofa' as const, nextType: 'refren' as const, isLastSection: false };
  const ctx = makeCtx(inp);
  const alts = H.rankSlot(inp, 'A', [], 0);
  void alts;
  console.log('pcs0', [...ctx.slotPcs[0]].join(','), 'smp', ctx.samples[0].map((x) => (x.pc === null ? '.' : x.pc + (x.held ? 'h' : '') + '@' + x.w.toFixed(2))).join(' '));
  console.log('roles', JSON.stringify(ctx.roles), 'slots', ctx.slots.map((s) => `${s.startSec.toFixed(2)}+${s.durSec.toFixed(2)}`).join(' '));
  for (let i = 0; i < 4; i++) {
    const r = H.rankSlot(inp, 'A', Array(4).fill({ root: 0, quality: 'min', roman: 'i', func: 'T' }), i);
    console.log(i, r.slice(0, 8).map((x) => `${x.chord.root}${x.chord.quality}:${x.chord.roman}:${x.score.toFixed(1)}`).join('  '));
  }
});
