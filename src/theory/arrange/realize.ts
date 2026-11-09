/** Realism + taste pass on a generated arrangement (M7 I4, Q2, Q3). Pure and seeded: same input, same output.
 *  1. the user's instrument choice per track, notes folded into the instrument's range;
 *  2. humanization by family, guitar strums, piano pedal, string legato, articulation by energy, no machine-gun repeats;
 *  3. taste: at most MAX_ACTIVE harmonic / melodic tracks sound together in a section (the least important ones rest). */
import type { Emotion, Genre, TimeSig } from '../../model/types';
import type { CatalogEntry } from '../../audio/instruments/types';
import { clampToRange, getInstrument } from '../../audio/instruments/catalog';
import { hashSeed, humanize, type NoteEv } from '../../audio/instruments/humanize';
import { strumChord, STRUM_GAP_MAX_MS } from '../../audio/instruments/strum';
import { applyPedal, pedalEvents } from '../../audio/instruments/pedal';
import { chooseArticulation, legato } from '../../audio/instruments/articulation';
import type { Arrangement, ArrNote, ArrTrack, PlanSection } from './types';

export const MAX_ACTIVE = 5;

export interface RealizeOptions {
  seed: number;
  bpm: number;
  sig: TimeSig;
  genre: Genre;
  emotion: Emotion;
  palette?: 'acustic' | 'clasic' | 'vesel';
  /** drop / trim accompaniment notes that sit a semitone (or flat 9th) from a sung note for more than 150 ms (default on when `vocal` is given) */
  clashGuard?: boolean;
  /** the user's choice: track id -> catalog id */
  overrides?: Record<string, string>;
  /** extra entries (the user's own instruments) */
  entryOf?: (id: string) => CatalogEntry | undefined;
  /** 0 = off (tests), 1 = default */
  amount?: number;
  /** the sung line on the song timeline: the restored third never makes a semitone clash with a held vocal note */
  vocal?: { midi: number; startSec: number; durSec: number }[];
}

/** default instruments of the melodic layers (hook / answers / counter-melody) by genre */
/** the Acustic (live) palette: real flute for the hook and the answers, real cello for the counter-line */
export const LAYER_INST_ACOUSTIC: Partial<typeof LAYER_INST> = {
  worship: { hook: 'flute', answers: 'flute', counter: 'bigcat_cello' },
  pop: { hook: 'flute', answers: 'flute', counter: 'bigcat_cello' },
};
/** the Vesel palette: violin takes the hook, a bright flute answers in the pauses, cello keeps the counter-line (every genre) */
export const LAYER_INST_VESEL: Record<'hook' | 'answers' | 'counter', string> = { hook: 'violin_solo', answers: 'flute', counter: 'bigcat_cello' };
export const LAYER_INST: Record<Genre, Record<'hook' | 'answers' | 'counter', string>> = {
  worship: { hook: 'flute', answers: 'harp', counter: 'violas' },
  pop: { hook: 'vibraphone', answers: 'flute', counter: 'violas' },
  cantare: { hook: 'oboe', answers: 'recorder', counter: 'bassoon' },
  imn: { hook: 'oboe', answers: 'flute', counter: 'violas' },
  rock: { hook: 'overdrive_guitar', answers: 'clean_electric', counter: 'clean_electric' },
  popular: { hook: 'fiddle', answers: 'pan_flute', counter: 'clarinet' },
};

const SOFT: Emotion[] = ['rugaciune', 'linistit', 'trist'];
const toEv = (n: ArrNote): NoteEv => ({ midi: n.midi, time: n.startSec, dur: n.durSec, vel: n.vel, art: n.art, attack: n.atk });
const fromEv = (e: NoteEv): ArrNote => ({ midi: e.midi, startSec: e.time, durSec: e.dur, vel: e.vel, ...(e.art ? { art: e.art } : {}), ...(e.attack ? { atk: e.attack } : {}) });

/** how far a family's timing humanization is scaled: a pianist is looser than a synth (about +-15 ms for keys) */
const FAMILY_AMOUNT: Partial<Record<string, number>> = { keys: 1.7, strings: 1.3, woodwinds: 1.2 };
const smooth = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

/** Shared rubato: every part slows a little at the end of each 4-bar phrase and more at the end of a section, so the band breathes together. */
export function rubatoShift(t: number, plan: PlanSection[], barSec: number): number {
  const s = plan.find((x, i) => t >= x.startSec - 1e-6 && (i === plan.length - 1 || t < plan[i + 1].startSec - 1e-6));
  if (!s) return 0;
  const rel = (t - s.startSec) / barSec;
  const phrase = 4;
  const inPhrase = rel % phrase;
  let shift = 0.022 * smooth((inPhrase - (phrase - 1)) / 1);
  const left = s.bars - rel;
  if (left < 1.5) shift = Math.max(shift, 0.05 * smooth((1.5 - left) / 1.5));
  return shift;
}

/** Velocity contour of a phrase: crescendo into the peak (70% of the phrase), decrescendo at the end. */
export function phraseContour(t: number, plan: PlanSection[], barSec: number): number {
  const s = plan.find((x, i) => t >= x.startSec - 1e-6 && (i === plan.length - 1 || t < plan[i + 1].startSec - 1e-6));
  if (!s) return 1;
  const u = (((t - s.startSec) / barSec) % 4) / 4;
  const c = u < 0.7 ? -0.5 + u / 0.7 : 0.5 - 1.6 * (u - 0.7) / 0.3 * 0.5 * 2 / 2;
  return 1 + 0.14 * Math.max(-0.5, Math.min(0.5, c));
}

function sectionAt(plan: PlanSection[], t: number): PlanSection | undefined {
  for (let i = plan.length - 1; i >= 0; i--) if (t >= plan[i].startSec - 1e-6) return plan[i];
  return plan[0];
}

/** lower number = more important; the last ones rest first when too many tracks sound together */
export function priorityOf(t: Pick<ArrTrack, 'id' | 'drums'>, entry?: CatalogEntry): number {
  if (t.drums) return 0;
  if (entry?.roles.includes('bass') && !entry.roles.includes('comp') && entry.family !== 'strings') return 1;
  if (t.id === 'hook') return 2;
  if (t.id === 'pian' || t.id === 'acor' || t.id === 'orga' || t.id === 'chit' || t.id === 'chit1') return 3;
  if (t.id === 'pad' || t.id === 'corzi' || t.id === 'cor') return 4;
  if (t.id === 'answers') return 5;
  if (t.id === 'counter') return 7;
  return 6;
}

export function realizeArrangement(arr: Arrangement, o: RealizeOptions): Arrangement {
  const amount = o.amount ?? 1;
  const entryOf = o.entryOf ?? getInstrument;
  const beatsPerBar = o.sig.num;
  const soft = SOFT.includes(o.emotion);
  arr = restoreThirds(arr, o);
  const changes = arr.plan.flatMap((s) => s.chords.map((c) => ({ time: s.startSec + c.startSec, chord: `${c.chord.root}${c.chord.quality}` })));
  const tracks: ArrTrack[] = arr.tracks.map((t, ti) => {
    const id = o.overrides?.[t.id] ?? t.inst ?? (t.id === 'hook' || t.id === 'answers' || t.id === 'counter' ? (o.palette === 'acustic' ? LAYER_INST_ACOUSTIC[o.genre] : o.palette === 'vesel' ? LAYER_INST_VESEL : undefined)?.[t.id] ?? LAYER_INST[o.genre][t.id] : undefined);
    const entry = id ? entryOf(id) : undefined;
    const out: ArrTrack = { ...t };
    if (entry) {
      out.inst = entry.id;
      if (entry.gmFallback !== null && !t.drums) out.gm = entry.gmFallback;
      out.sampler = entry.source.type === 'salamander' ? 'salamander' : undefined;
    }
    if (!entry || amount <= 0) return out;
    const family = entry.family;
    const seed = hashSeed(o.seed, ti, family.length);
    const energyAt = (time: number) => (sectionAt(arr.plan, time)?.energy ?? 3) / 5;
    let ev: NoteEv[] = t.notes.map(toEv);
    if (!t.drums) ev = ev.map((n) => ({ ...n, midi: clampToRange(entry, n.midi) }));
    ev.sort((a, b) => a.time - b.time || a.midi - b.midi);

    // guitar: chord hits (same start) become strums; down / up strokes alternate
    if (family === 'guitars' && !t.drums) {
      const grouped: NoteEv[][] = [];
      for (const n of ev) { const g = grouped[grouped.length - 1]; if (g && Math.abs(g[0].time - n.time) < 0.004) g.push(n); else grouped.push([n]); }
      const strummed: NoteEv[] = [];
      grouped.forEach((g, i) => {
        if (g.length < 3) { strummed.push(...g); return; }
        const dur = Math.max(...g.map((n) => n.dur));
        const dir = i % 2 === 0 ? 'D' : 'U';
        strummed.push(...strumChord(g.map((n) => n.midi), { time: g[0].time, dur, vel: Math.max(...g.map((n) => n.vel)), dir, energy: energyAt(g[0].time), seed: hashSeed(seed, i) }));
      });
      ev = strummed;
    }
    // piano / electric piano: re-pedal at every chord change
    if (family === 'keys' && changes.length) ev = applyPedal(ev, pedalEvents(changes, arr.songSec));
    // strings and pads: notes of a line overlap a little
    if (family === 'strings' && entry.roles.includes('pad') && !t.drums) ev = legato(ev);

    ev = humanize(ev, { seed, family: t.drums ? 'drums' : family, amount: amount * (FAMILY_AMOUNT[family] ?? 1), bpm: o.bpm, beatsPerBar });
    {
      const barSec = (60 / o.bpm) * beatsPerBar;
      ev = ev.map((n) => ({ ...n, time: n.time + rubatoShift(n.time, arr.plan, barSec), vel: Math.min(1, Math.max(0.02, n.vel * (t.drums ? 1 : phraseContour(n.time, arr.plan, barSec)))) }));
    }
    ev.sort((a, b) => a.time - b.time || a.midi - b.midi);

    // no machine-gun: the same note twice in a row never has the same velocity
    const last = new Map<number, number>();
    ev = ev.map((n) => {
      const prev = last.get(n.midi);
      let vel = n.vel;
      if (prev !== undefined && Math.abs(prev - vel) < 0.012) {
        let v = vel >= prev ? prev + 0.014 : prev - 0.014;
        if (v > 1 || v < 0.02) v = prev + (v > 1 ? -0.014 : 0.014);
        vel = v;
      }
      last.set(n.midi, vel);
      return { ...n, vel };
    });

    // articulation by energy and length
    if (!t.drums && entry.articulations.length > 1) {
      const role = entry.roles.includes('pad') && t.id !== 'hook' ? 'pad' : entry.roles.includes('comp') ? 'comp' : 'melody';
      ev = ev.map((n) => ({ ...n, art: chooseArticulation(entry, { energy: energyAt(n.time), durSec: n.dur, role, soft }) }));
    }
    if (!t.drums && family === 'woodwinds') ev = ev.filter((n) => n.dur >= WIND_DROP_SEC).map((n) => ({ ...n, dur: Math.max(n.dur, WIND_MIN_SEC) })); // a wind note under ~180 ms never settles into a pitched tone
    if (t.id === 'hook' || t.id === 'answers' || t.id === 'counter') ev = ev.filter((n) => n.dur >= WIND_DROP_SEC); // melodic layers: tracker debris under 90 ms is never a played note
    // bow swells and breath: long notes of strings and winds do not start at full level; a flute vibrates only on its long notes
    if (!t.drums && (family === 'strings' || family === 'woodwinds')) {
      ev = ev.map((n) => {
        let art = n.art;
        if (family === 'woodwinds' && entry.articulations.includes('vib') && n.dur >= 0.9) art = 'vib';
        const attack = n.dur >= 1 ? Math.min(family === 'strings' ? 0.32 : 0.12, n.dur * 0.22) : family === 'woodwinds' ? 0.05 : undefined;
        return { ...n, art, attack };
      });
    }
    out.notes = ev.map(fromEv).filter((n) => n.startSec < arr.songSec + 2);
    return out;
  });
  const limited = limitSimultaneous({ ...arr, tracks }, entryOf);
  return o.vocal?.length && o.clashGuard !== false ? guardClashes(limited, o.vocal) : limited;
}

/** Shortest wind note (s): below this the sample is all attack and sounds like a puff of air. */
export const WIND_MIN_SEC = 0.18;
/** Wind notes shorter than this are grace / tracker debris, not playable notes: dropped. */
export const WIND_DROP_SEC = 0.09;

export interface Clash { track: string; midi: number; vocalMidi: number; startSec: number; overlapSec: number }
export const CLASH_MIN_SEC = 0.15;

/** Every accompaniment note (not drums) that is a semitone or a flat 9th (13 semitones) from a sung note for longer than 150 ms. */
export function findClashes(arr: Pick<Arrangement, 'tracks'>, vocal: { midi: number; startSec: number; durSec: number }[], minSec = CLASH_MIN_SEC): Clash[] {
  const out: Clash[] = [];
  const v = [...vocal].sort((a, b) => a.startSec - b.startSec);
  for (const t of arr.tracks) {
    if (t.drums) continue;
    for (const n of t.notes) {
      for (const s of v) {
        if (s.startSec >= n.startSec + n.durSec) break;
        const ov = Math.min(n.startSec + n.durSec, s.startSec + s.durSec) - Math.max(n.startSec, s.startSec);
        const d = Math.abs(n.midi - s.midi);
        if (ov > minSec && (d === 1 || d === 13)) out.push({ track: t.id, midi: n.midi, vocalMidi: s.midi, startSec: Math.max(n.startSec, s.startSec), overlapSec: ov });
      }
    }
  }
  return out;
}

/** Removes the clashes found by `findClashes`: a note that starts before the sung note is cut short, one that starts inside it is dropped. */
export function guardClashes(arr: Arrangement, vocal: { midi: number; startSec: number; durSec: number }[]): Arrangement {
  const v = [...vocal].sort((a, b) => a.startSec - b.startSec);
  const tracks = arr.tracks.map((t) => {
    if (t.drums) return t;
    const notes: ArrNote[] = [];
    for (const n of t.notes) {
      let end = n.startSec + n.durSec, drop = false;
      for (const s of v) {
        if (s.startSec >= end) break;
        const ov = Math.min(end, s.startSec + s.durSec) - Math.max(n.startSec, s.startSec);
        const d = Math.abs(n.midi - s.midi);
        if (ov > CLASH_MIN_SEC && (d === 1 || d === 13)) {
          if (s.startSec - n.startSec > 0.1) end = Math.min(end, s.startSec + CLASH_MIN_SEC * 0.9); else { drop = true; break; }
        }
      }
      if (!drop && end - n.startSec > 0.04) notes.push(end === n.startSec + n.durSec ? n : { ...n, durSec: end - n.startSec });
    }
    return { ...t, notes };
  });
  return { ...arr, tracks };
}

/** Chords whose third is missing from every accompaniment part (clash-drop, open voicing) get it back in a lower register of a pad / keys / bass part,
 *  unless a held sung note would be a semitone from it. The third decides major / minor for the listener. */
export function restoreThirds(arr: Arrangement, o: Pick<RealizeOptions, 'vocal'>): Arrangement {
  const host = ['pad', 'corzi', 'cor', 'orga', 'pian', 'acor', 'chit', 'bas'].map((id) => arr.tracks.findIndex((t) => t.id === id)).find((i) => i >= 0);
  if (host === undefined) return arr;
  const add: ArrNote[] = [];
  for (const s of arr.plan) for (const c of s.chords) {
    const q = c.chord.quality;
    const third = q === 'maj' || q === 'maj7' || q === 'dom7' || q === 'add9' ? 4 : q === 'min' || q === 'min7' ? 3 : 0;
    if (!third) continue;
    const t0 = s.startSec + c.startSec, t1 = t0 + c.durSec;
    const pc = (c.chord.root + third) % 12;
    const has = arr.tracks.some((t) => !t.drums && t.notes.some((n) => n.startSec < t1 - 0.05 && n.startSec + n.durSec > t0 + 0.05 && n.midi % 12 === pc));
    if (has) continue;
    const clash = (o.vocal ?? []).some((n) => n.durSec >= 0.25 && n.startSec < t1 && n.startSec + n.durSec > t0 && [1, 11].includes((((n.midi - pc) % 12) + 12) % 12));
    if (clash) continue;
    let m = 48 + ((pc - 48 + 120) % 12);
    if (m > 59) m -= 12;
    add.push({ midi: m, startSec: t0, durSec: Math.max(0.1, c.durSec * 0.97), vel: 0.4 });
  }
  if (!add.length) return arr;
  return { ...arr, tracks: arr.tracks.map((t, i) => (i === host ? { ...t, notes: [...t.notes, ...add].sort((a, b) => a.startSec - b.startSec) } : t)) };
}

/** Fewer, better parts: in every section at most MAX_ACTIVE non-drum tracks sound; the least important ones rest in that section. */
export function limitSimultaneous(arr: Arrangement, entryOf: (id: string) => CatalogEntry | undefined = getInstrument, max = MAX_ACTIVE): Arrangement {
  const secOf = (t: number) => arr.plan.findIndex((s, i) => t >= s.startSec - 1e-6 && (i === arr.plan.length - 1 || t < arr.plan[i + 1].startSec - 1e-6));
  const keep = new Set<string>();
  arr.plan.forEach((_s, si) => {
    const act = arr.tracks.filter((t) => !t.drums && t.notes.some((n) => secOf(n.startSec) === si));
    act.sort((a, b) => priorityOf(a, a.inst ? entryOf(a.inst) : undefined) - priorityOf(b, b.inst ? entryOf(b.inst) : undefined));
    act.slice(max).forEach((t) => keep.add(`${t.id}@${si}`)); // "keep" here = muted in this section
  });
  if (!keep.size) return arr;
  const tracks = arr.tracks.map((t) => (t.drums ? t : { ...t, notes: t.notes.filter((n) => !keep.has(`${t.id}@${secOf(n.startSec)}`)) }));
  const plan = arr.plan.map((s, si) => ({ ...s, active: s.active.filter((id) => !keep.has(`${id}@${si}`)) }));
  return { ...arr, tracks, plan };
}

export { STRUM_GAP_MAX_MS };

// ------------------------------------------------------------------------------------------------ taste audit (Q3 / Q4)

export interface TasteReport {
  maxSimultaneous: number;
  /** per section: number of non-drum tracks with notes, and notes per second */
  perSection: { label: string; active: number; density: number }[];
  /** share of the section pairs (neighbours) whose instrument sets differ (contrast) */
  contrast: number;
  /** counter-melody notes per bar overall (sparse = low) */
  counterPerBar: number;
  /** a bass or low track above 200 Hz average, or a lead below a low voice */
  registerIssues: string[];
  warnings: string[];
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function tasteAudit(arr: Arrangement, bpm: number, beatsPerBar: number): TasteReport {
  const bar = (60 / bpm) * beatsPerBar;
  const secOf = (t: number) => arr.plan.findIndex((s, i) => t >= s.startSec - 1e-6 && (i === arr.plan.length - 1 || t < arr.plan[i + 1].startSec - 1e-6));
  const sets: Set<string>[] = arr.plan.map(() => new Set<string>());
  const dens: number[] = arr.plan.map(() => 0);
  for (const t of arr.tracks) for (const n of t.notes) { const i = secOf(n.startSec); if (i >= 0) { if (!t.drums) sets[i].add(t.id); dens[i]++; } }
  const warnings: string[] = [];
  const registerIssues: string[] = [];
  let maxSim = 0;
  const perSection = arr.plan.map((s, i) => {
    maxSim = Math.max(maxSim, sets[i].size);
    return { label: s.label, active: sets[i].size, density: dens[i] / Math.max(0.1, s.durSec) };
  });
  let diff = 0, pairs = 0;
  for (let i = 1; i < sets.length; i++) { pairs++; const a = sets[i - 1], b = sets[i]; if ([...a].some((x) => !b.has(x)) || [...b].some((x) => !a.has(x))) diff++; }
  const contrast = pairs ? diff / pairs : 1;
  const counter = arr.tracks.find((t) => t.id === 'counter');
  const bars = Math.max(1, arr.songSec / bar);
  const counterPerBar = counter ? counter.notes.length / bars : 0;
  for (const t of arr.tracks) {
    if (t.drums || !t.notes.length) continue;
    const mean = t.notes.reduce((a, n) => a + hz(n.midi), 0) / t.notes.length;
    const bassy = /^bas/.test(t.id);
    if (!bassy && mean < 130 && t.id !== 'cello') registerIssues.push(t.id);
    if (bassy && mean > 200) registerIssues.push(t.id);
  }
  if (maxSim > MAX_ACTIVE) warnings.push('tooMany');
  if (arr.plan.length > 3 && contrast < 0.34) warnings.push('flat');
  if (counterPerBar > 3) warnings.push('busyCounter');
  if (registerIssues.length) warnings.push('register');
  return { maxSimultaneous: maxSim, perSection, contrast, counterPerBar, registerIssues, warnings };
}
