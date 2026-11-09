import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, CATALOG_BY_ID, FAMILIES, searchInstruments, tierCounts, clampToRange, forGenre } from './catalog';
import type { InstrumentIndex, InstrumentManifest } from './types';
import type { GrooveData } from './groove';
import type { ReverbManifest } from './reverb';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIR = path.join(ROOT, 'public', 'instruments');
const index: InstrumentIndex = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const manifests: Record<string, InstrumentManifest> = Object.fromEntries(
  Object.entries(index).map(([id, e]) => [id, JSON.parse(fs.readFileSync(path.join(DIR, e.manifest), 'utf8')) as InstrumentManifest]));

function dirSize(d: string): number {
  let t = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); t += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; }
  return t;
}

describe('instrument manifests (integrity)', () => {
  it('has the sampled sets and every manifest is valid', () => {
    expect(Object.keys(manifests).length).toBeGreaterThanOrEqual(40);
    for (const [id, m] of Object.entries(manifests)) {
      expect(m.id).toBe(id);
      expect(m.license).toBe('CC0-1.0');
      expect(m.layers.length).toBeGreaterThan(0);
      expect(m.layers[m.layers.length - 1]).toBe(1);
      expect(m.range[0]).toBeLessThanOrEqual(m.range[1]);
      expect(m.release).toBeGreaterThan(0);
      expect(m.articulations[m.defaultArticulation]).toBeTruthy();
      expect(m.source.url).toMatch(/^https:\/\/(github\.com\/(sgossner|freepats|sfzinstruments)|freepats\.zenvoid\.org)\//);
      for (const [an, a] of Object.entries(m.articulations)) {
        expect(a.samples.length, `${id}/${an}`).toBeGreaterThan(0);
        for (const s of a.samples) {
          const f = path.join(DIR, id, s.file);
          expect(fs.existsSync(f), `${id}: ${s.file}`).toBe(true);
          expect(fs.statSync(f).size).toBeGreaterThan(500);
          expect(s.dur).toBeGreaterThan(0.05);
          expect(s.key).toBeGreaterThanOrEqual(m.range[0]);
          expect(s.key).toBeLessThanOrEqual(m.range[1]);
          s.layers.forEach((l) => expect(l).toBeLessThan(m.layers.length));
          if (s.loopStart != null) { expect(s.loopEnd!).toBeGreaterThan(s.loopStart + 0.3); expect(s.loopEnd!).toBeLessThanOrEqual(s.dur + 1e-6); }
        }
        // every layer is served by at least one sample
        for (let l = 0; l < a.nLayers; l++) expect(a.samples.some((s) => s.layers.includes(l)), `${id}/${an} layer ${l}`).toBe(true);
      }
    }
  });

  it('index byte counts match the files on disk and the total is within the 400 MB budget', () => {
    for (const [id, e] of Object.entries(index)) {
      const m = manifests[id];
      const real = new Set(Object.values(m.articulations).flatMap((a) => a.samples.map((s) => s.file)));
      const bytes = [...real].reduce((t, f) => t + fs.statSync(path.join(DIR, id, f)).size, 0);
      expect(bytes).toBe(e.bytes);
    }
    expect(dirSize(DIR)).toBeLessThanOrEqual(400 * 1024 * 1024);
  });
});

describe('licenses', () => {
  const md = fs.readFileSync(path.join(DIR, 'LICENSES.md'), 'utf8');
  it('LICENSES.md lists every shipped file group with a permissive licence', () => {
    expect(md).toMatch(/VSCO 2 Community Edition/);
    expect(md).toMatch(/Versilian Community Sample Library/);
    expect(md).toMatch(/CC0 1\.0/);
    expect(md).toMatch(/Groove MIDI Dataset/);
    expect(md).toMatch(/CC BY 4\.0/);
    expect(md).toMatch(/ir\/\*\.wav/);
    for (const id of Object.keys(manifests)) expect(md, id).toContain(`| ${id} |`);
  });
  it('contains no restricted licences and ships the licence texts', () => {
    expect(md).not.toMatch(/AGPL|\bGPL\b|NonCommercial|CC[- ]BY[- ]NC|CC[- ]BY[- ]SA/i);
    for (const m of Object.values(manifests)) expect(m.license).not.toMatch(/GPL|NC|SA/);
    for (const f of ['licenses/LICENSE-vsco-CC0.txt', 'licenses/LICENSE-vcsl-CC0.txt', 'grooves/LICENSE-groove.txt']) expect(fs.existsSync(path.join(DIR, f)), f).toBe(true);
    expect(fs.readFileSync(path.join(DIR, 'licenses/LICENSE-vsco-CC0.txt'), 'utf8')).toMatch(/CC0 1\.0 Universal/);
    expect(fs.readFileSync(path.join(DIR, 'licenses/LICENSE-vcsl-CC0.txt'), 'utf8')).toMatch(/CC0 1\.0 Universal/);
    const g = JSON.parse(fs.readFileSync(path.join(DIR, 'grooves/grooves.json'), 'utf8')) as GrooveData;
    expect(g.license).toBe('CC-BY-4.0'); expect(g.attribution).toMatch(/Magenta/);
  });
});

describe('catalog', () => {
  it('has at least 45 instruments across all families, unique ids, mixed tiers', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(45);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const f of FAMILIES) expect(CATALOG.some((c) => c.family === f), f).toBe(true);
    const t = tierCounts(); expect(t.A).toBeGreaterThan(30); expect(t.B).toBeGreaterThanOrEqual(15); expect(t.C).toBeGreaterThanOrEqual(7);
  });
  it('tier A entries match their manifests (articulations, ranges)', () => {
    for (const c of CATALOG) {
      expect(c.range[0]).toBeLessThanOrEqual(c.range[1]);
      expect(c.pan).toBeGreaterThanOrEqual(-1); expect(c.pan).toBeLessThanOrEqual(1);
      expect(c.send).toBeGreaterThanOrEqual(0); expect(c.send).toBeLessThanOrEqual(1);
      expect(c.genres.length).toBeGreaterThan(0);
      if (c.tier === 'B') expect(c.gmFallback !== null || c.source.type === 'gm-drums').toBe(true);
      if (c.source.type === 'manifest') {
        const m = manifests[c.source.id]; expect(m, c.id).toBeTruthy();
        expect(c.id).toBe(c.source.id);
        expect(c.articulations.slice().sort()).toEqual(Object.keys(m.articulations).sort());
        expect(c.range[0]).toBeGreaterThanOrEqual(m.range[0] - 7); expect(c.range[1]).toBeLessThanOrEqual(m.range[1] + 7);
      }
    }
  });
  it('covers the spec instruments (GM fallbacks, folk, synth)', () => {
    for (const id of ['accordion', 'pan_flute', 'dulcimer', 'choir_aahs', 'church_organ', 'violins', 'timpani', 'vowel_choir', 'warm_pad', 'riser', 'bell_synth', 'synth_bass', 'arp_pluck', 'cajon', 'cellos', 'violin_solo', 'clarinet', 'contrabass']) expect(CATALOG_BY_ID[id], id).toBeTruthy();
    expect(forGenre('imn').map((c) => c.id)).toEqual(expect.arrayContaining(['church_organ', 'violins', 'timpani']));
    expect(forGenre('cantare').map((c) => c.id)).toEqual(expect.arrayContaining(['violin_solo', 'clarinet', 'accordion', 'pan_flute', 'dulcimer', 'contrabass']));
  });
  it('search ignores diacritics; clampToRange folds by octaves', () => {
    expect(searchInstruments('orga').map((c) => c.id)).toContain('church_organ');
    expect(searchInstruments('tambal').map((c) => c.id)).toContain('dulcimer');
    expect(clampToRange({ range: [55, 86] }, 40)).toBe(64);
    expect(clampToRange({ range: [55, 86] }, 100)).toBe(76);
  });
});

describe('church reverb spaces', () => {
  const man = JSON.parse(fs.readFileSync(path.join(DIR, 'ir', 'manifest.json'), 'utf8')) as ReverbManifest;
  it('has the five spaces with valid WAV files', () => {
    expect(man.spaces.map((s) => s.id)).toEqual(['studio', 'capela', 'biserica', 'catedrala', 'sala']);
    for (const s of man.spaces) {
      const b = fs.readFileSync(path.join(DIR, 'ir', s.file));
      expect(b.toString('ascii', 0, 4)).toBe('RIFF'); expect(b.readUInt16LE(22)).toBe(2); expect(b.readUInt32LE(24)).toBe(man.sampleRate);
      expect(b.length).toBeGreaterThan(40000);
    }
  });
  it('decay times are ordered studio < chapel < church < cathedral', () => {
    const t60 = (id: string) => man.spaces.find((s) => s.id === id)!.rt60;
    expect(t60('studio')).toBeLessThan(t60('capela')); expect(t60('capela')).toBeLessThan(t60('biserica')); expect(t60('biserica')).toBeLessThan(t60('catedrala'));
    // measured: time for the energy to fall 30 dB (Schroeder integral) follows the same order
    const meas = (id: string) => {
      const b = fs.readFileSync(path.join(DIR, 'ir', `${id}.wav`)); const n = (b.length - 44) / 4; const e = new Float64Array(n);
      for (let i = 0; i < n; i++) { const l = b.readInt16LE(44 + i * 4) / 32768; e[i] = l * l; }
      let tot = 0; for (let i = n - 1; i >= 0; i--) { tot += e[i]; e[i] = tot; }
      for (let i = 0; i < n; i++) if (10 * Math.log10(e[i] / e[0]) < -30) return i / man.sampleRate;
      return n / man.sampleRate;
    };
    expect(meas('studio')).toBeLessThan(meas('capela')); expect(meas('capela')).toBeLessThan(meas('biserica')); expect(meas('biserica')).toBeLessThan(meas('catedrala'));
  });
});
