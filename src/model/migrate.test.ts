import { describe, expect, it } from 'vitest';
import { migrateProject } from './migrate';
import { MODEL_VERSION } from './types';

const m1 = {
  id: 'a', name: 'Vechi', version: 1, genre: 'imn', emotion: 'lauda', timeSig: { num: 6, den: 8 }, bpm: 80, key: null,
  sections: [{ id: 's1', type: 'strofa', label: 'Strofă', order: 0, bars: 8, takes: [{ id: 't1', rawAudioId: 'r1', latencyMs: 0, durationSec: 5, notesOriginal: [], notesCorrected: [] }], activeTakeId: 't1', generated: false }],
};
const m3 = {
  id: 'b', name: 'M3', version: 1, genre: 'worship', emotion: 'inchinare', timeSig: { num: 4, den: 4, grouping: [4] }, bpm: 90, key: { tonic: 0, mode: 'major' }, keyLocked: true,
  voices: [{ id: 'lead', role: 'lead', name: 'x' }], createdAt: 1, updatedAt: 2,
  sections: [{
    id: 's1', type: 'strofa', label: 'Strofă', order: 0, bars: 8, activeTakeId: 'gone', generated: false,
    takes: [{ id: 't1', rawAudioId: 'r1', latencyMs: 0, durationSec: 5, source: 'mic', notesOriginal: [], notesCorrected: [], correction: { snapToKey: true }, analysis: { notes: [] } }],
    harmony: { version: 1, slots: [], variants: { A: [], B: [], C: [] }, notesSig: '' },
  }, { id: 's2', type: 'refren', harmony: { broken: true } }],
  arrangement: { energy: { s1: 3 }, layersOff: ['counter', 'x'] },
};

describe('project migration', () => {
  it('M1-era project gets safe defaults', () => {
    const p = migrateProject(m1);
    expect(p.version).toBe(MODEL_VERSION);
    expect(p.timeSig).toEqual({ num: 6, den: 8, grouping: [3, 3] });
    expect(p.keyLocked).toBe(false);
    expect(p.voices.length).toBe(1);
    const tk = p.sections[0].takes[0];
    expect(tk.correction.quantizeStrength).toBeGreaterThan(0);
    expect(tk.tuningMode).toBe('follow');
    expect(p.arrangement).toBeUndefined();
    expect(p.sections[0].harmony).toBeUndefined();
  });
  it('M3-era project keeps its data and repairs the rest', () => {
    const p = migrateProject(m3);
    expect(p.key).toEqual({ tonic: 0, mode: 'major' });
    expect(p.sections[0].activeTakeId).toBe('t1');
    expect(p.sections[0].harmony?.locks).toEqual({ A: {}, B: {}, C: {} });
    expect(p.sections[0].takes[0].analysis?.tuningCents).toBe(0);
    expect(p.sections[1].harmony).toBeUndefined();
    expect(p.sections[1].takes).toEqual([]);
    expect(p.arrangement?.layersOff).toEqual(['counter']);
    expect(p.arrangement?.energy).toEqual({ s1: 3 });
  });
  it('survives garbage', () => {
    expect(() => migrateProject({ id: 'z', sections: [{ id: 'q' }] })).not.toThrow();
  });
});
