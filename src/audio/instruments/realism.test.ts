import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyGroove, GROOVES, HUMAN_PROFILES, humanize, mulberry32, type NoteEv } from './humanize';
import { guitarVoicing, patternFor, STRUM_GAP_MAX_MS, STRUM_GAP_MIN_MS, strumBar, strumChord, strumGapMs } from './strum';
import { applyPedal, pedalDownAt, pedalEvents, pedalToCC64 } from './pedal';
import { applySwell, chooseArticulation, legato, mixDefaults, spreadPans, swellAttack, swellGain } from './articulation';
import { CATALOG, CATALOG_BY_ID } from './catalog';
import { BEATS_PER_BAR, deriveMeter, energyLevel, grooveToHits, pickGroove, type GrooveData } from './groove';
import { arpeggiate, cutoffHz, EMOTION_SYNTH, emotionParams, VOWEL_FORMANTS } from './synthParams';
import { layerFor, pickSample, velocityGain } from './sampler';
import type { InstrumentManifest } from './types';

const DIR = path.resolve(__dirname, '..', '..', '..', 'public', 'instruments');
const notes = (n = 40): NoteEv[] => Array.from({ length: n }, (_, i) => ({ midi: 48 + (i % 12), time: i * 0.25, dur: 0.2, vel: 0.7 }));

describe('humanize', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = humanize(notes(), { seed: 7, family: 'strings' }), b = humanize(notes(), { seed: 7, family: 'strings' }), c = humanize(notes(), { seed: 8, family: 'strings' });
    expect(a).toEqual(b); expect(a).not.toEqual(c);
  });
  it('result does not depend on the order or the other notes', () => {
    const all = humanize(notes(), { seed: 3, family: 'keys' });
    const rev = humanize(notes().reverse(), { seed: 3, family: 'keys' }).reverse();
    expect(rev).toEqual(all);
    const one = humanize([notes()[5]], { seed: 3, family: 'keys' })[0];
    expect(one).toEqual(all[5]);
  });
  it('timing jitter stays within the spec window (8-15 ms) per family and velocity stays valid', () => {
    for (const [fam, p] of Object.entries(HUMAN_PROFILES)) {
      expect(p.timingMs).toBeGreaterThanOrEqual(6); expect(p.timingMs).toBeLessThanOrEqual(15);
      const out = humanize(notes(200), { seed: 11, family: fam as keyof typeof HUMAN_PROFILES });
      const src = notes(200);
      out.forEach((o, i) => {
        const dt = (o.time - src[i].time) * 1000;
        expect(Math.abs(dt - p.layback)).toBeLessThanOrEqual(p.timingMs + 1e-6);
        expect(o.vel).toBeGreaterThan(0); expect(o.vel).toBeLessThanOrEqual(1);
        expect(Math.abs(o.vel / src[i].vel - 1)).toBeLessThanOrEqual(p.velJitter + 1e-6);
      });
    }
  });
  it('amount 0 is the identity and the real spread is non-trivial', () => {
    expect(humanize(notes(), { seed: 1, family: 'brass', amount: 0 })).toEqual(notes());
    const dts = humanize(notes(200), { seed: 1, family: 'woodwinds' }).map((o, i) => Math.abs(o.time - i * 0.25) * 1000);
    expect(Math.max(...dts)).toBeGreaterThan(5);
  });
  it('mulberry32 is reproducible', () => { const a = mulberry32(5), b = mulberry32(5); expect([a(), a(), a()]).toEqual([b(), b(), b()]); });
  it('swing template delays off-beat eighths', () => {
    const n: NoteEv[] = [0, 0.5, 1, 1.5].map((b) => ({ midi: 60, time: b * 0.5, dur: 0.1, vel: 0.8 }));
    const s = applyGroove(n, 120, GROOVES.shuffle);
    expect(s[1].time).toBeCloseTo((0 + 0.64) * 0.5, 5); expect(s[0].time).toBe(0);
  });
});

describe('strum engine', () => {
  const chord = guitarVoicing([60, 64, 67]);
  it('guitar voicing has <= 6 strings in range, bass = root', () => {
    expect(chord.length).toBeGreaterThanOrEqual(4); expect(chord.length).toBeLessThanOrEqual(6);
    expect(chord[0] % 12).toBe(0); chord.forEach((m) => { expect(m).toBeGreaterThanOrEqual(40); expect(m).toBeLessThanOrEqual(76); });
    expect([...chord].sort((a, b) => a - b)).toEqual(chord);
  });
  it('string spacing is 8-25 ms for every energy, direction and seed', () => {
    for (const dir of ['D', 'U'] as const) for (const energy of [0, 0.25, 0.5, 0.75, 1]) for (let seed = 0; seed < 20; seed++) {
      const ev = strumChord(chord, { time: 1, dur: 1, vel: 0.8, dir, energy, seed });
      for (let i = 1; i < ev.length; i++) {
        const gap = (ev[i].time - ev[i - 1].time) * 1000;
        expect(gap).toBeGreaterThanOrEqual(STRUM_GAP_MIN_MS - 1e-6); expect(gap).toBeLessThanOrEqual(STRUM_GAP_MAX_MS + 1e-6);
      }
    }
    expect(strumGapMs(0)).toBeLessThanOrEqual(25); expect(strumGapMs(1)).toBeGreaterThanOrEqual(8);
    expect(strumGapMs(0)).toBeGreaterThan(strumGapMs(1));
  });
  it('down strokes go low to high, up strokes high to low on the top strings, ghost strokes are short and quiet', () => {
    const d = strumChord(chord, { time: 0, dur: 1, vel: 0.8, dir: 'D', seed: 1 });
    expect(d.map((n) => n.midi)).toEqual(chord);
    const u = strumChord(chord, { time: 0, dur: 1, vel: 0.8, dir: 'U', seed: 1 });
    expect(u.length).toBeLessThanOrEqual(4); expect(u[0].midi).toBe(chord[chord.length - 1]); expect(u[0].vel).toBeLessThan(d[0].vel);
    const g = strumChord(chord, { time: 0, dur: 1, vel: 0.8, dir: 'x', seed: 1 });
    expect(g.every((n) => n.dur <= 0.07 && n.vel < 0.4 && n.art === 'mute')).toBe(true);
  });
  it('is deterministic and strumBar covers one bar at the grid', () => {
    const a = strumBar(chord, { startSec: 0, bpm: 100, vel: 0.8, energy: 0.6, seed: 4 }), b = strumBar(chord, { startSec: 0, bpm: 100, vel: 0.8, energy: 0.6, seed: 4 });
    expect(a).toEqual(b);
    const barSec = (60 / 100) * 4; expect(Math.max(...a.map((n) => n.time))).toBeLessThan(barSec);
    expect(patternFor('6/8', 0.5)).toHaveLength(6); expect(patternFor('3/4', 0.9)).toHaveLength(6);
  });
});

describe('piano pedal', () => {
  const changes = [{ time: 0, chord: 'C' }, { time: 2, chord: 'F' }, { time: 4, chord: 'G' }, { time: 6, chord: 'C' }];
  it('re-pedals at every chord change (lift after the new chord starts, press again) and ends released', () => {
    const ev = pedalEvents(changes, 8);
    expect(ev[0].down).toBe(true);
    for (let i = 1; i < ev.length; i++) { expect(ev[i].down).toBe(!ev[i - 1].down); expect(ev[i].time).toBeGreaterThanOrEqual(ev[i - 1].time); }
    expect(ev[ev.length - 1].down).toBe(false);
    for (const c of changes.slice(1)) {
      const lift = ev.find((e) => !e.down && e.time >= c.time && e.time < c.time + 0.2);
      expect(lift, `lift at ${c.time}`).toBeTruthy();
      expect(pedalDownAt(ev, c.time + 0.2)).toBe(true);
      expect(pedalDownAt(ev, c.time - 0.1)).toBe(true);
    }
    expect(pedalDownAt(ev, 9)).toBe(false);
  });
  it('same chord repeated does not re-pedal; a very long chord does', () => {
    const same = pedalEvents([{ time: 0, chord: 'C' }, { time: 2, chord: 'C' }], 4);
    expect(same.filter((e) => !e.down)).toHaveLength(1);
    const long = pedalEvents([{ time: 0, chord: 'C' }], 14, { maxHoldSec: 4 });
    expect(long.filter((e) => !e.down).length).toBeGreaterThan(1);
  });
  it('notes ring only until the next pedal lift; CC64 export', () => {
    const ev = pedalEvents(changes, 8);
    const out = applyPedal([{ midi: 48, time: 0, dur: 0.5, vel: 0.7 }, { midi: 53, time: 2.1, dur: 0.3, vel: 0.7 }], ev);
    expect(out[0].dur).toBeGreaterThan(1.5); expect(out[0].dur).toBeLessThanOrEqual(2.1);
    expect(out[1].dur).toBeGreaterThan(1.5); expect(out[1].time + out[1].dur).toBeLessThanOrEqual(4.1);
    expect(pedalToCC64(ev).every((e) => e.value === 0 || e.value === 127)).toBe(true);
  });
});

describe('articulation, legato, swell, mix defaults', () => {
  const vio = CATALOG_BY_ID.violins, tr = CATALOG_BY_ID.trumpet;
  it('chooses by energy and always returns a supported articulation', () => {
    expect(chooseArticulation(vio, { energy: 0.2, durSec: 2 })).toBe('sus');
    expect(chooseArticulation(vio, { energy: 0.9, durSec: 0.2 })).toBe('spic');
    expect(chooseArticulation(vio, { energy: 0.45, durSec: 0.4, role: 'comp' })).toBe('pizz');
    expect(chooseArticulation(vio, { energy: 0.95, durSec: 3, role: 'pad' })).toBe('trem');
    expect(chooseArticulation(tr, { energy: 0.5, durSec: 0.15 })).toBe('stac');
    expect(chooseArticulation(tr, { energy: 0.5, durSec: 2 })).toBe('vib');
    for (const c of CATALOG) for (const e of [0, 0.3, 0.6, 0.95]) for (const d of [0.1, 0.5, 2]) for (const role of ['pad', 'comp', 'melody'])
      expect(c.articulations).toContain(chooseArticulation(c, { energy: e, durSec: d, role, soft: e < 0.3 }));
  });
  it('legato overlaps close notes and softens the attack; far notes stay detached', () => {
    const out = legato([{ midi: 60, time: 0, dur: 0.4, vel: 0.7 }, { midi: 62, time: 0.5, dur: 0.4, vel: 0.7 }, { midi: 64, time: 3, dur: 0.4, vel: 0.7 }]);
    expect(out[0].time + out[0].dur).toBeGreaterThan(out[1].time); expect(out[1].attack).toBeGreaterThan(0.05);
    expect(out[1].time + out[1].dur).toBeLessThan(out[2].time); expect(out[2].attack).toBeUndefined();
  });
  it('swell curve rises to the peak and falls; swell notes get a longer attack when long and calm', () => {
    expect(swellGain(0)).toBeCloseTo(0.45, 3); expect(swellGain(0.7)).toBeCloseTo(1, 3); expect(swellGain(1)).toBeLessThan(0.9);
    expect(swellAttack(4, 0.1)).toBeGreaterThan(swellAttack(1, 0.1)); expect(swellAttack(4, 0.1)).toBeGreaterThan(swellAttack(4, 1));
    const n = applySwell([{ midi: 60, time: 0, dur: 1, vel: 1 }, { midi: 60, time: 5, dur: 1, vel: 1 }], 0, 10);
    expect(n[0].vel).toBeLessThan(n[1].vel);
  });
  it('pan / send defaults exist for every instrument and shrink with the room size; spreadPans separates clashes', () => {
    for (const c of CATALOG) { const m = mixDefaults(c); expect(Math.abs(m.pan)).toBeLessThanOrEqual(1); expect(m.send).toBeGreaterThanOrEqual(0); expect(m.send).toBeLessThanOrEqual(1); }
    expect(mixDefaults(CATALOG_BY_ID.church_organ, 'studio').send).toBeLessThan(mixDefaults(CATALOG_BY_ID.church_organ, 'biserica').send);
    expect(CATALOG_BY_ID.contrabass.send).toBeLessThan(CATALOG_BY_ID.violins.send); // low instruments stay dry
    const p = spreadPans([{ id: 'a', pan: 0.3 }, { id: 'b', pan: 0.3 }, { id: 'c', pan: 0.32 }]);
    const v = Object.values(p).sort((x, y) => x - y); expect(v[1] - v[0]).toBeGreaterThanOrEqual(0.17); expect(v[2] - v[1]).toBeGreaterThanOrEqual(0.17);
  });
});

describe('groove patterns (Groove MIDI Dataset)', () => {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, 'grooves', 'grooves.json'), 'utf8')) as GrooveData;
  it('is large, tagged and attributed', () => {
    expect(data.patterns.length).toBeGreaterThan(500);
    expect(data.attribution).toMatch(/CC BY 4\.0/);
    for (const p of data.patterns) {
      expect(['beat', 'fill']).toContain(p.type); expect(['4/4', '3/4', '6/8']).toContain(p.sig);
      expect(['slow', 'mid', 'fast']).toContain(p.tempo); expect(['low', 'mid', 'high']).toContain(p.energy); expect(['straight8', 'straight16', 'swing']).toContain(p.feel);
    }
    for (const t of ['slow', 'mid', 'fast']) expect(data.patterns.some((p) => p.type === 'beat' && p.sig === '4/4' && p.tempo === t), t).toBe(true);
    for (const e of ['low', 'mid', 'high']) expect(data.patterns.some((p) => p.type === 'beat' && p.energy === e)).toBe(true);
    expect(data.patterns.some((p) => p.feel === 'swing')).toBe(true);
    expect(data.patterns.some((p) => p.type === 'fill')).toBe(true);
  });
  it('every event lies inside the bar(s) of its meter and uses valid roles / velocities', () => {
    for (const p of data.patterns) {
      const len = BEATS_PER_BAR[p.sig] * p.bars;
      for (const [pos, role, vel] of p.ev) { expect(pos).toBeGreaterThanOrEqual(0); expect(pos).toBeLessThan(len); expect(data.roles[role]).toBeTruthy(); expect(vel).toBeGreaterThanOrEqual(1); expect(vel).toBeLessThanOrEqual(127); }
      expect(p.ev.length).toBeGreaterThanOrEqual(3);
    }
    const beats = data.patterns.filter((p) => p.type === 'beat');
    expect(beats.filter((p) => p.ev.some((e) => data.roles[e[1]] === 'k')).length / beats.length).toBeGreaterThan(0.9);
  });
  it('picks a pattern that fits meter and tempo for every supported meter, deterministically; null where no data exists', () => {
    for (const sig of ['4/4', '3/4', '6/8', '2/4']) for (const bpm of [64, 90, 120, 150]) {
      const a = pickGroove(data, { sig, bpm, seed: 3, genre: 'worship' }), b = pickGroove(data, { sig, bpm, seed: 3, genre: 'worship' });
      expect(a, `${sig}@${bpm}`).toBeTruthy(); expect(a).toEqual(b); expect(a!.sig).toBe(sig);
      if (sig === '4/4') expect(Math.abs(Math.log2(bpm / a!.bpm))).toBeLessThan(0.45);
      const hits = grooveToHits(a!, data.roles, { startSec: 10, bpm });
      const barSec = (60 / bpm) * BEATS_PER_BAR[sig] * a!.bars;
      expect(hits.length).toBeGreaterThan(2);
      hits.forEach((h) => { expect(h.time).toBeGreaterThanOrEqual(10); expect(h.time).toBeLessThan(10 + barSec); });
    }
    for (const sig of ['7/8', '5/8', '9/8']) expect(pickGroove(data, { sig, bpm: 100, seed: 1 })).toBeNull();
  });
  it('energy / feel / fill requests are honoured when available', () => {
    expect(pickGroove(data, { sig: '4/4', bpm: 100, seed: 1, energy: 'high' })!.energy).toBe('high');
    expect(pickGroove(data, { sig: '4/4', bpm: 100, seed: 1, feel: 'swing' })!.feel).toBe('swing');
    expect(pickGroove(data, { sig: '4/4', bpm: 100, seed: 1, type: 'fill' })!.type).toBe('fill');
    expect(energyLevel(0.1)).toBe('low'); expect(energyLevel(0.9)).toBe('high');
    const p = data.patterns.find((x) => x.type === 'beat' && x.sig === '4/4' && x.bars === 1)!;
    expect(deriveMeter(p, '2/4')?.ev.every((e) => e[0] < 2)).toBe(true);
  });
});

describe('sampler selection', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'violins', 'manifest.json'), 'utf8')) as InstrumentManifest;
  it('maps velocity to layers and picks the nearest recording (ties go lower)', () => {
    expect(layerFor(m, 0.2)).toBe(0); expect(layerFor(m, 0.95)).toBe(1);
    const p = pickSample(m, 'sus', 60, 0.9)!;
    expect(Math.abs(p.sample.key - 60)).toBeLessThanOrEqual(3); expect(p.shift).toBe(60 - p.sample.key); expect(p.sample.layers).toContain(1);
    expect(pickSample(m, 'nope', 60, 0.5)!.art).toBe(m.defaultArticulation);
    expect(velocityGain(1)).toBeCloseTo(1, 5); expect(velocityGain(0)).toBeGreaterThan(0);
  });
  it('round-robins one-shot hits and loops sustained notes', () => {
    const cajon = JSON.parse(fs.readFileSync(path.join(DIR, 'cajon', 'manifest.json'), 'utf8')) as InstrumentManifest;
    const a = pickSample(cajon, 'bass', 60, 0.9, 0)!, b = pickSample(cajon, 'bass', 60, 0.9, 1)!;
    expect(a.sample.file).not.toBe(b.sample.file); expect(a.shift).toBe(0);
    expect(m.articulations.sus.samples.every((s) => s.loopStart != null)).toBe(true);
    expect(m.articulations.pizz.samples.every((s) => s.loopStart == null)).toBe(true);
  });
});

describe('synth params', () => {
  it('has emotion presets for all 12 emotions with sane ranges', () => {
    expect(Object.keys(EMOTION_SYNTH)).toHaveLength(12);
    for (const p of Object.values(EMOTION_SYNTH)) { expect(p.bright).toBeGreaterThanOrEqual(0); expect(p.bright).toBeLessThanOrEqual(1); expect(p.attack).toBeGreaterThan(0); expect(p.release).toBeGreaterThan(p.attack * 0.2); }
    expect(emotionParams('rugaciune').attack).toBeGreaterThan(emotionParams('energic').attack);
    expect(emotionParams('biruinta').bright).toBeGreaterThan(emotionParams('trist').bright);
    expect(cutoffHz(0)).toBeCloseTo(300, 0); expect(cutoffHz(1)).toBeCloseTo(9000, 0);
    expect(Object.keys(VOWEL_FORMANTS)).toHaveLength(3);
  });
  it('arpeggiator is deterministic and respects the grid', () => {
    const a = arpeggiate([60, 64, 67], 'updown', 1, 0.125, 8);
    expect(a.map((n) => n.midi)).toEqual([60, 64, 67, 64, 60, 64, 67, 64]);
    expect(a[3].time).toBeCloseTo(1.375, 5); expect(arpeggiate([67, 60, 64], 'up', 0, 0.1, 3).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(arpeggiate([], 'up', 0, 0.1, 4)).toEqual([]);
  });
});
