import { describe, expect, it } from 'vitest';
import {
  augmentMotif, diminishMotif, fragmentMotif, generateMelodicLayers, hookToMotif, invertMotif, makeRng, ornamentMotif,
  rangeOf, scaleMidis, scalePcs, sequenceMotif, strongPositions,
} from './index';
import type { ChordSlotIn, EmotionId, GenreId, MelodyInput, MelodyResult, OutNote, SectionIn, VocalNoteIn } from './types';

const GENRES: GenreId[] = ['worship', 'imn', 'cantare', 'pop', 'rock', 'popular'];
const METERS = [
  { num: 4, den: 4, grouping: [2, 2] },
  { num: 3, den: 4, grouping: [3] },
  { num: 6, den: 8, grouping: [3, 3] },
  { num: 7, den: 8, grouping: [3, 2, 2] },
];
const KEYS: { tonic: number; mode: 'major' | 'minor' | 'harmonicMinor' }[] = [
  { tonic: 0, mode: 'major' }, { tonic: 7, mode: 'major' }, { tonic: 11, mode: 'minor' },
  { tonic: 9, mode: 'harmonicMinor' }, { tonic: 4, mode: 'minor' },
];
const RANGES = { low: { low: 47, high: 64 }, mid: { low: 57, high: 74 }, high: { low: 64, high: 81 } };
const EMO: EmotionId[] = ['nostalgic', 'energic', 'inchinare', 'trist', 'lauda', 'epic'];

interface SongOpts {
  key: (typeof KEYS)[number]; meter: (typeof METERS)[number]; genre: GenreId; energy: number;
  voice?: 'low' | 'mid' | 'high'; seed?: number; bpm?: number; emotion?: EmotionId; cpb?: number;
}
interface Song extends MelodyInput { vocalPauses: { startSec: number; durSec: number }[] }

function build(o: SongOpts): Song {
  const { key, meter } = o;
  const bpm = o.bpm ?? 96;
  const unit = 240 / (bpm * meter.den), bar = unit * meter.num;
  const voice = o.voice ?? 'mid';
  const range = RANGES[voice];
  const rng = makeRng((o.seed ?? 1) * 7919 + key.tonic);
  const sc = scalePcs({ tonic: key.tonic, mode: key.mode }, false);
  const isMajor = key.mode === 'major';
  const tri = (rootOff: number, minor: boolean, dom = false): { root: number; pcs: number[] } => {
    const r = (key.tonic + rootOff) % 12;
    return { root: r, pcs: [r, (r + (minor && !dom ? 3 : 4)) % 12, (r + 7) % 12] };
  };
  const I = isMajor ? tri(0, false) : tri(0, true);
  const VI = isMajor ? tri(9, true) : tri(8, false);
  const IV = isMajor ? tri(5, false) : tri(5, true);
  const V = tri(7, false, true);
  const cyc = [I, VI, IV, V, I, IV, V, I];
  const layout: [SectionIn['type'], number][] = [['intro', 4], ['strofa', 4], ['refren', 4], ['bridge', 4], ['refren', 4], ['outro', 4]];
  const cpb = o.cpb ?? 1;
  let t = 0;
  const sections: SectionIn[] = [];
  const vocal: VocalNoteIn[] = [];
  let refrenCache: { dt: number; midi: number; dur: number }[] | null = null;
  const gapUnits = 2 * (meter.den / 4);
  const strong = new Set(strongPositions(meter));
  const centre = (range.low + range.high) / 2;
  let prevP = Math.round(centre);
  for (const [type, bars] of layout) {
    const start = t;
    const chords: ChordSlotIn[] = [];
    let gi = 0;
    for (let b = 0; b < bars; b++) {
      const last = b === bars - 1;
      for (let h = 0; h < cpb; h++) {
        let ch = cyc[(b * cpb + h) % cyc.length];
        if (last && ((type === 'bridge') || type === 'intro')) ch = V;
        if (last && (type === 'outro' || type === 'refren')) ch = I;
        const dur = bar / cpb;
        chords.push({ startSec: start + b * bar + h * dur, durSec: dur, pcs: ch.pcs, root: ch.root, function: 'T' });
        gi++;
      }
    }
    void gi;
    sections.push({ type, startSec: start, bars, energy: o.energy, chords });
    if (type === 'strofa' || type === 'refren') {
      if (type === 'refren' && refrenCache) {
        for (const n of refrenCache) vocal.push({ midi: n.midi, startSec: start + n.dt, durSec: n.dur });
      } else {
        const created: { dt: number; midi: number; dur: number }[] = [];
        for (let b = 0; b < bars; b++) {
          const endGap = b % 2 === 1 ? gapUnits : 0;
          let u = 0;
          while (u < meter.num - endGap) {
            const d = Math.min(rng.pick([1, 2, 2, 3]), meter.num - endGap - u);
            const tt = b * bar + u * unit;
            const ch = chords[b * cpb + Math.min(cpb - 1, Math.floor((u / meter.num) * cpb))];
            // random walk in scale, chord tones on strong beats
            const step = rng.pick([-2, -1, -1, 0, 1, 1, 2]);
            let p = prevP;
            for (let k = 0; k < Math.abs(step); k++) {
              let q = p + Math.sign(step);
              while (!sc.includes(((q % 12) + 12) % 12)) q += Math.sign(step);
              p = q;
            }
            if (p > range.high - 1) p -= 2; if (p < range.low + 1) p += 2;
            while (!sc.includes(((p % 12) + 12) % 12)) p++;
            if (strong.has(u)) {
              let bp = p, bd = 99;
              for (let q = p - 3; q <= p + 3; q++) if (ch.pcs.includes(((q % 12) + 12) % 12) && Math.abs(q - p) < bd && q >= range.low && q <= range.high) { bd = Math.abs(q - p); bp = q; }
              p = bp;
            }
            prevP = p;
            created.push({ dt: tt, midi: p, dur: d * unit * 0.95 });
            u += d;
          }
        }
        for (const n of created) vocal.push({ midi: n.midi, startSec: start + n.dt, durSec: n.dur });
        if (type === 'refren') refrenCache = created;
      }
    }
    t += bars * bar;
  }
  vocal.sort((a, b) => a.startSec - b.startSec);
  const beat = 60 / bpm;
  const pauses: { startSec: number; durSec: number }[] = [];
  for (let i = 0; i + 1 < vocal.length; i++) {
    const e = vocal[i].startSec + vocal[i].durSec, g = vocal[i + 1].startSec - e;
    if (g >= beat * 0.5) pauses.push({ startSec: e, durSec: g });
  }
  return {
    sections, vocalNotes: vocal, vocalPauses: pauses, key, meter, bpm, genre: o.genre,
    emotion: o.emotion ?? 'nostalgic', vocalRange: range, seed: o.seed ?? 1,
  };
}

/* ---------- helpers mirroring the spec (independent of the engine internals) */
function isStrong(song: Song, t: number): boolean {
  const unit = 240 / (song.bpm * song.meter.den);
  const sec = song.sections.find((s) => t >= s.startSec - 1e-6 && t < s.startSec + s.bars * unit * song.meter.num - 1e-6);
  if (!sec) return false;
  const u = (t - sec.startSec) / unit;
  const r = Math.round(u);
  if (Math.abs(u - r) * unit > 0.03) return false;
  return strongPositions(song.meter).includes(((r % song.meter.num) + song.meter.num) % song.meter.num);
}
function chordAt(song: Song, t: number): ChordSlotIn {
  const all = song.sections.flatMap((s) => s.chords);
  let best = all[0];
  for (const c of all) if (c.startSec <= t + 1e-6) best = c;
  return best;
}
const allNotes = (r: MelodyResult) => r.tracks.flatMap((tr) => tr.notes.map((n) => ({ ...n, role: tr.role })));
const end = (n: OutNote) => n.startSec + n.durSec;
const sectionEnd = (song: Song, s: SectionIn) => s.startSec + s.bars * (240 / (song.bpm * song.meter.den)) * song.meter.num;

function matrix(): SongOpts[] {
  const out: SongOpts[] = [];
  GENRES.forEach((genre, gi) => METERS.forEach((meter, mi) => KEYS.forEach((key, ki) => {
    out.push({
      key, meter, genre, energy: ((gi * 7 + mi * 3 + ki) % 5) + 1, voice: (['low', 'mid', 'high'] as const)[(gi + mi + ki) % 3],
      seed: gi * 100 + mi * 10 + ki + 1, emotion: EMO[(gi + ki) % EMO.length], bpm: [72, 96, 120][(mi + ki) % 3],
    });
  })));
  GENRES.forEach((genre, gi) => METERS.forEach((meter, mi) => out.push({
    key: KEYS[2], meter, genre, energy: 5, voice: (['low', 'mid', 'high'] as const)[(gi + mi) % 3], seed: 900 + gi * 10 + mi, emotion: 'energic', cpb: meter.num === 4 ? 2 : 1,
  })));
  return out;
}
const MATRIX = matrix();
const RESULTS = MATRIX.map((o) => { const s = build(o); return { o, s, r: generateMelodicLayers(s) }; });

describe('M5 melodic layers', () => {
  it('generates non-empty layers for every song', () => {
    for (const { o, r } of RESULTS) {
      const n = allNotes(r).length;
      expect(n, JSON.stringify(o.genre)).toBeGreaterThan(5);
    }
  });

  it('AC1: no answer/fill/lead note overlaps a sung note (>= 1/8 beat after, >= 1/4 beat before)', () => {
    let checked = 0;
    for (const { s, r } of RESULTS) {
      const beat = 60 / s.bpm;
      for (const tr of r.tracks.filter((x) => x.role !== 'counter')) {
        for (const n of tr.notes) {
          for (const v of s.vocalNotes) {
            const vEnd = v.startSec + v.durSec;
            const bad = n.startSec < vEnd + beat / 8 - 1e-6 && end(n) > v.startSec - beat / 4 + 1e-6;
            if (bad) throw new Error(`overlap ${tr.name} ${n.startSec} vs vocal ${v.startSec}`);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('AC2: >= 90% of strong-beat melodic notes are chord tones (every song)', () => {
    const fr: number[] = [];
    for (const { s, r } of RESULTS) {
      let tot = 0, ok = 0;
      for (const n of allNotes(r)) {
        if (!isStrong(s, n.startSec)) continue;
        tot++;
        if (chordAt(s, n.startSec).pcs.includes(n.midi % 12)) ok++;
      }
      if (tot >= 4) fr.push(ok / tot);
      if (tot >= 4) {
        const bad = allNotes(r).filter((n) => isStrong(s, n.startSec) && !chordAt(s, n.startSec).pcs.includes(n.midi % 12)).map((n) => `${n.role}:${n.midi}@${n.startSec.toFixed(2)}`);
        expect(ok / tot, `${s.genre} ${JSON.stringify(s.meter)} ${JSON.stringify(s.key)} ${bad.join(' ')}`).toBeGreaterThanOrEqual(0.9);
      }
    }
    // eslint-disable-next-line no-console
    console.log('strong-beat chord-tone fraction: min', Math.min(...fr).toFixed(3), 'songs', fr.length);
  });

  it('AC3: no m2 / M7 / b9 against a concurrent sung note; AC4: no parallel 5ths/8ves with the voice', () => {
    let concurrent = 0;
    for (const { s, r } of RESULTS) {
      for (const tr of r.tracks) {
        for (const n of tr.notes) {
          for (const v of s.vocalNotes) {
            if (n.startSec < v.startSec + v.durSec - 1e-6 && end(n) > v.startSec + 1e-6) {
              concurrent++;
              const iv = (((n.midi - v.midi) % 12) + 12) % 12;
              if (iv === 1 || iv === 11) throw new Error(`dissonance iv=${iv} ${tr.name}`);
              if (tr.role === 'counter' && (iv === 0 || iv === 7)) throw new Error(`perfect interval ${iv}`);
            }
          }
        }
      }
      const vAt = (t: number) => s.vocalNotes.find((v) => v.startSec <= t + 1e-6 && v.startSec + v.durSec > t + 1e-6);
      for (const tr of r.tracks) {
        for (let i = 0; i + 1 < tr.notes.length; i++) {
          const a = tr.notes[i], b = tr.notes[i + 1];
          const v1 = vAt(a.startSec), v2 = vAt(b.startSec);
          if (!v1 || !v2 || v1 === v2) continue;
          const i1 = (((a.midi - v1.midi) % 12) + 12) % 12, i2 = (((b.midi - v2.midi) % 12) + 12) % 12;
          if (i1 === i2 && (i1 === 7 || i1 === 0) && a.midi !== b.midi && v1.midi !== v2.midi) throw new Error('parallel perfect');
        }
      }
    }
    expect(concurrent).toBeGreaterThan(50);
  });

  it('counter-melody: 3rds/6ths/10ths on strong beats, never in energy < 4, no unisons', () => {
    let strongN = 0, cons = 0, counterNotes = 0;
    for (const { s, r } of RESULTS) {
      const ctr = r.tracks.find((t) => t.role === 'counter')!.notes;
      counterNotes += ctr.length;
      for (const n of ctr) {
        const sec = s.sections.find((x) => n.startSec >= x.startSec - 1e-6 && n.startSec < sectionEnd(s, x))!;
        expect(sec.energy).toBeGreaterThanOrEqual(4);
        expect(['strofa', 'prerefren', 'refren']).toContain(sec.type);
        const v = s.vocalNotes.find((x) => x.startSec <= n.startSec + 0.03 && x.startSec + x.durSec > n.startSec + 0.03);
        if (v && isStrong(s, n.startSec)) { strongN++; if ([3, 4, 8, 9].includes((((n.midi - v.midi) % 12) + 12) % 12)) cons++; }
      }
    }
    expect(counterNotes).toBeGreaterThan(100);
    expect(strongN).toBeGreaterThan(30);
    expect(cons / strongN).toBeGreaterThanOrEqual(0.99);
  });

  it('register: answers/counter above low voices, below high voices', () => {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    for (const voice of ['low', 'high'] as const) {
      for (const genre of ['worship', 'pop', 'popular'] as GenreId[]) {
        const s = build({ key: KEYS[0], meter: METERS[0], genre, energy: 5, voice, seed: 3 });
        const r = generateMelodicLayers(s);
        const vm = mean(s.vocalNotes.map((v) => v.midi));
        for (const role of ['answers', 'counter'] as const) {
          const ns = r.tracks.find((t) => t.role === role)!.notes;
          expect(ns.length).toBeGreaterThan(5);
          const m = mean(ns.map((n) => n.midi));
          if (voice === 'low') expect(m).toBeGreaterThan(vm + 5); else expect(m).toBeLessThan(vm - 5);
        }
      }
    }
  });

  it('real low male voice B2-E3 puts answers and counter above the singer', () => {
    const base = build({ key: KEYS[2], meter: METERS[0], genre: 'worship', energy: 5, voice: 'low', seed: 11 });
    // squeeze the vocal into B2..E3 (47..52) region
    const vocalNotes = base.vocalNotes.map((v) => ({ ...v, midi: 47 + ((v.midi * 5) % 6) }));
    const s: Song = { ...base, vocalNotes, vocalRange: { low: 47, high: 52 } };
    const r = generateMelodicLayers(s);
    for (const role of ['answers', 'counter'] as const) {
      const ns = r.tracks.find((t) => t.role === role)!.notes;
      expect(ns.length).toBeGreaterThan(3);
      expect(Math.min(...ns.map((n) => n.midi))).toBeGreaterThan(52);
    }
  });

  it('AC5: intro contains the hook (interval match >= 80%) and leads into the first strofa note', () => {
    let leadOk = 0, n = 0;
    const leadDbg: string[] = [];
    for (const { s, r } of RESULTS) {
      const intro = s.sections.find((x) => x.type === 'intro')!;
      const iEnd = sectionEnd(s, intro);
      const lead = r.tracks.find((t) => t.role === 'lead')!.notes.filter((x) => x.startSec < iEnd - 1e-6);
      const ints = r.diagnostics.hook.intervals;
      const L = ints.length + 1;
      let best = 0;
      for (let i = 0; i + L <= lead.length; i++) {
        let m = 0;
        for (let k = 0; k < ints.length; k++) if (lead[i + k + 1].midi - lead[i + k].midi === ints[k]) m++;
        best = Math.max(best, m / ints.length);
      }
      expect(best, `hook match ${s.genre} ${JSON.stringify(s.meter)} hook=${JSON.stringify(r.diagnostics.hook)} lead=${lead.map((x) => `${x.midi}@${x.startSec.toFixed(2)}`).join(' ')}`).toBeGreaterThanOrEqual(0.8);
      const first = s.vocalNotes.find((v) => v.startSec >= iEnd - 1e-3)!;
      const lastN = lead[lead.length - 1];
      const x = (((lastN.midi - first.midi) % 12) + 12) % 12;
      n++;
      if (Math.min(x, 12 - x) <= 2) leadOk++; else leadDbg.push(`${s.genre} ${JSON.stringify(s.meter)} last=${lastN.midi}@${lastN.startSec.toFixed(2)} introEnd=${iEnd.toFixed(2)} first=${first.midi}@${first.startSec.toFixed(2)} lead=${lead.slice(-4).map((z) => z.midi + '@' + z.startSec.toFixed(2)).join(',')}`);
      expect(end(lastN)).toBeLessThanOrEqual(iEnd + 1e-6);
    }
    expect(leadOk / n, 'lead-in ' + leadDbg.slice(0, 3).join(' || ')).toBeGreaterThanOrEqual(0.95);
  });

  it('hook comes from the refren first phrase when available', () => {
    const s = build({ key: KEYS[0], meter: METERS[0], genre: 'pop', energy: 3, seed: 5 });
    const r = generateMelodicLayers(s);
    expect(r.diagnostics.hook.source).toBe('refren');
    expect(r.diagnostics.hook.pitches.length).toBeGreaterThanOrEqual(3);
    expect(r.diagnostics.hook.pitches.length).toBeLessThanOrEqual(6);
  });

  it('AC6: bridge ends on V, outro on the tonic with a ritardando flag', () => {
    for (const { s, r } of RESULTS) {
      const lead = r.tracks.find((t) => t.role === 'lead')!.notes;
      const br = s.sections.find((x) => x.type === 'bridge')!, ou = s.sections.find((x) => x.type === 'outro')!;
      const inSec = (x: SectionIn) => lead.filter((n) => n.startSec >= x.startSec - 1e-6 && n.startSec < sectionEnd(s, x) - 1e-6);
      const b = inSec(br), o = inSec(ou);
      expect(b.length).toBeGreaterThan(2);
      expect(b[b.length - 1].midi % 12, `${s.genre} ${JSON.stringify(s.meter)} ${JSON.stringify(s.key)} ${b.map((n) => `${n.midi}@${n.startSec.toFixed(3)}+${n.durSec.toFixed(2)}`).join(" ")} bpm=${s.bpm} end=${sectionEnd(s, br)}`).toBe((s.key.tonic + 7) % 12);
      expect(Math.max(...b.map((n) => n.midi)), `${s.genre} ${JSON.stringify(s.meter)} ${b.map((n) => `${n.midi}@${n.startSec.toFixed(2)}`).join(' ')}`).toBeGreaterThan(b[0].midi);
      const half = b.slice(Math.floor(b.length / 2));
      expect(Math.max(...half.map((n) => n.midi))).toBe(Math.max(...b.map((n) => n.midi)));
      expect(o[o.length - 1].midi % 12).toBe(s.key.tonic);
      expect(end(o[o.length - 1])).toBeLessThanOrEqual(sectionEnd(s, ou) + 1e-6);
      expect(o[o.length - 1].durSec).toBeGreaterThan(60 / s.bpm);
      expect(r.diagnostics.ritardando.flag).toBe(true);
    }
  });

  it('AC7: all notes in instrument range', () => {
    for (const { r } of RESULTS) for (const tr of r.tracks) {
      const rg = rangeOf(tr.gmProgram);
      for (const n of tr.notes) {
        expect(n.midi).toBeGreaterThanOrEqual(rg.low);
        expect(n.midi).toBeLessThanOrEqual(rg.high);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(127);
        expect(n.durSec).toBeGreaterThan(0);
      }
    }
  });

  it('AC8: density increases with energy (all genres)', () => {
    const rows: string[] = [];
    for (const genre of GENRES) {
      const dens: number[] = [];
      for (let e = 1; e <= 5; e++) {
        let tot = 0, cnt = 0;
        for (const meter of METERS) for (const key of [KEYS[0], KEYS[2]]) for (const voice of ['mid', 'low'] as const) {
          const s = build({ key, meter, genre, energy: e, voice, seed: 4, emotion: 'nostalgic' });
          const r = generateMelodicLayers(s);
          tot += allNotes(r).length; cnt++;
        }
        dens.push(tot / cnt);
      }
      rows.push(`${genre}: ${dens.map((d) => d.toFixed(1)).join(' < ')}`);
      for (let e = 1; e < 5; e++) expect(dens[e], `${genre} e${e + 1}`).toBeGreaterThan(dens[e - 1]);
    }
    // eslint-disable-next-line no-console
    console.log('density by energy\n' + rows.join('\n'));
  });

  it('AC9: deterministic for the same seed, different for another seed; AC10: < 100 ms per song', () => {
    const s = build({ key: KEYS[3], meter: METERS[3], genre: 'popular', energy: 5, seed: 21 });
    const a = generateMelodicLayers(s), b = generateMelodicLayers(s);
    expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
    const c = generateMelodicLayers({ ...s, seed: 99 });
    expect(JSON.stringify(c.tracks)).not.toBe(JSON.stringify(a.tracks));
    let worst = 0;
    for (const { r } of RESULTS) worst = Math.max(worst, r.diagnostics.ms);
    const t0 = performance.now();
    generateMelodicLayers(s);
    worst = Math.max(worst, performance.now() - t0);
    // eslint-disable-next-line no-console
    console.log('worst ms per song', worst.toFixed(1));
    expect(worst).toBeLessThan(100);
  });

  it('genre behaviour: imn is minimal (organ, held), populara uses ornaments, worship uses piano/guitar', () => {
    const sImn = build({ key: KEYS[0], meter: METERS[0], genre: 'imn', energy: 3 });
    const rImn = generateMelodicLayers(sImn);
    const a = rImn.tracks.find((t) => t.role === 'answers')!;
    expect(a.gmProgram).toBe(19);
    expect(a.notes.every((n) => n.durSec >= 60 / sImn.bpm * 0.5)).toBe(true);
    const sPop = build({ key: KEYS[3], meter: METERS[3], genre: 'popular', energy: 4, emotion: 'nostalgic', seed: 2 });
    const rPop = generateMelodicLayers(sPop);
    const pa = rPop.tracks.find((t) => t.role === 'answers')!;
    expect([40, 75, 21]).toContain(pa.gmProgram);
    const short = pa.notes.filter((n) => n.durSec < 0.15).length;
    expect(short).toBeGreaterThan(0);
    // harmonic minor: ornament notes stay in A harmonic minor
    const hm = new Set(scalePcs({ tonic: 9, mode: 'harmonicMinor' }, false));
    const inHm = pa.notes.filter((n) => hm.has(n.midi % 12)).length / pa.notes.length;
    expect(inHm).toBeGreaterThan(0.95);
    const rW = generateMelodicLayers(build({ key: KEYS[0], meter: METERS[0], genre: 'worship', energy: 3 }));
    expect([0, 27]).toContain(rW.tracks.find((t) => t.role === 'answers')!.gmProgram);
  });

  it('emotion table changes density/velocity', () => {
    const base = build({ key: KEYS[0], meter: METERS[0], genre: 'pop', energy: 3 });
    const calm = generateMelodicLayers({ ...base, emotion: 'rugaciune' });
    const hot = generateMelodicLayers({ ...base, emotion: 'energic' });
    expect(allNotes(hot).length).toBeGreaterThan(allNotes(calm).length);
    const avg = (r: MelodyResult) => allNotes(r).reduce((a, n) => a + n.vel, 0) / allNotes(r).length;
    expect(avg(hot)).toBeGreaterThan(avg(calm));
  });

  it('motif transformations', () => {
    const s = build({ key: KEYS[0], meter: METERS[0], genre: 'pop', energy: 3 });
    const m = hookToMotif(generateMelodicLayers(s).diagnostics.hook);
    const sc = scaleMidis(scalePcs({ tonic: 0, mode: 'major' }, false));
    const seq = sequenceMotif(m, 1, sc);
    expect(seq.pitches.every((p, i) => p > m.pitches[i] && p - m.pitches[i] <= 2)).toBe(true);
    expect(seq.onsets).toEqual(m.onsets);
    const inv = invertMotif(m, sc);
    expect(inv.pitches[0]).toBe(m.pitches[0]);
    inv.pitches.forEach((p, i) => { if (i > 0) expect(Math.sign(p - m.pitches[0])).toBe(-Math.sign(m.pitches[i] - m.pitches[0]) || 0); });
    const fr = fragmentMotif(m, 1, 2);
    expect(fr.pitches.length).toBe(2);
    expect(fr.onsets[0]).toBe(0);
    const au = augmentMotif(m, 2), di = diminishMotif(m, 2);
    expect(au.durs[0]).toBe(m.durs[0] * 2);
    expect(di.onsets[1]).toBeCloseTo(m.onsets[1] / 2);
    const orn = ornamentMotif({ pitches: [60, 64], onsets: [0, 2], durs: [2, 2] }, sc, makeRng(1), 1);
    expect(orn.pitches.length).toBe(6);
  });
});
