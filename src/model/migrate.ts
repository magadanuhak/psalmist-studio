/** Version-aware migration of projects stored by older builds (M1 / M2 / M3 schemas) to the current model. */
import { DEFAULT_CORRECTION, MODEL_VERSION, type Project, type Section, type Take, type TimeSig } from './types';
import { TIME_SIGS } from '../music/timesig';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function migrateSig(raw: Raw | undefined): TimeSig {
  const n = num(raw?.num, 4), d = num(raw?.den, 4);
  const g = Array.isArray(raw?.grouping) && raw!.grouping.length && raw!.grouping.every((x: unknown) => typeof x === 'number') ? (raw!.grouping as number[]) : null;
  if (g && g.reduce((a, b) => a + b, 0) === n) return { num: n, den: d, grouping: g };
  const hit = TIME_SIGS.find((x) => x.sig.num === n && x.sig.den === d);
  return { num: n, den: d, grouping: hit ? [...hit.sig.grouping] : [n] };
}

function migrateTake(raw: Raw): Take {
  const a = raw.analysis;
  return {
    ...raw,
    id: String(raw.id),
    rawAudioId: String(raw.rawAudioId ?? raw.id),
    latencyMs: num(raw.latencyMs, 0),
    durationSec: num(raw.durationSec, 0),
    createdAt: num(raw.createdAt, Date.now()),
    source: raw.source === 'import' ? 'import' : 'mic',
    notesOriginal: Array.isArray(raw.notesOriginal) ? raw.notesOriginal : [],
    notesCorrected: Array.isArray(raw.notesCorrected) ? raw.notesCorrected : [],
    correction: { ...DEFAULT_CORRECTION, ...(raw.correction ?? {}) },
    tuningMode: raw.tuningMode === 'a440' ? 'a440' : 'follow',
    analysis: a
      ? { ...a, notes: a.notes ?? [], pauses: a.pauses ?? [], rangeMidi: a.rangeMidi ?? null, keyEstimate: a.keyEstimate ?? null, tuningCents: num(a.tuningCents, 0), tuningConcentration: num(a.tuningConcentration, 1) }
      : undefined,
  } as Take;
}

function migrateSection(raw: Raw, i: number): Section {
  const h = raw.harmony;
  const goodHarmony = h && Array.isArray(h.slots) && h.variants && h.variants.A && h.variants.B && h.variants.C;
  const takes: Take[] = Array.isArray(raw.takes) ? raw.takes.map(migrateTake) : [];
  return {
    ...raw,
    id: String(raw.id),
    type: raw.type ?? 'strofa',
    label: typeof raw.label === 'string' ? raw.label : `Secțiunea ${i + 1}`,
    order: num(raw.order, i),
    bars: num(raw.bars, 8),
    takes,
    activeTakeId: takes.some((x) => x.id === raw.activeTakeId) ? raw.activeTakeId : takes[0]?.id ?? null,
    generated: !!raw.generated,
    harmony: goodHarmony ? { ...h, locks: h.locks ?? { A: {}, B: {}, C: {} }, active: h.active ?? 'B', rate: h.rate ?? 'auto' } : undefined,
  } as Section;
}

export function migrateProject(raw: unknown): Project {
  const r = (raw ?? {}) as Raw;
  const sections: Section[] = Array.isArray(r.sections) ? r.sections.map(migrateSection) : [];
  const a = r.arrangement;
  return {
    ...r,
    id: String(r.id),
    name: typeof r.name === 'string' ? r.name : 'Cântare',
    version: MODEL_VERSION,
    genre: r.genre ?? 'worship',
    emotion: r.emotion ?? 'inchinare',
    timeSig: migrateSig(r.timeSig),
    bpm: num(r.bpm, 90),
    key: r.key && typeof r.key.tonic === 'number' ? r.key : null,
    keyLocked: !!r.keyLocked,
    sections,
    voices: Array.isArray(r.voices) && r.voices.length ? r.voices : [{ id: 'lead', role: 'lead', name: 'Voce principală' }],
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
    final: r.final && Array.isArray(r.final.takes)
      ? { takes: r.final.takes.filter((x: Raw) => x && typeof x.audioId === 'string'), comp: r.final.comp && typeof r.final.comp === 'object' ? r.final.comp : {} }
      : undefined,
    arrangement: a && typeof a === 'object'
      ? {
          v: 1,
          energy: a.energy && typeof a.energy === 'object' ? a.energy : {},
          drop: !!a.drop,
          seed: typeof a.seed === 'number' ? a.seed : undefined,
          transpose: typeof a.transpose === 'number' ? Math.max(-6, Math.min(6, Math.round(a.transpose))) : undefined,
          fx: a.fx && typeof a.fx === 'object' ? a.fx : undefined,
          pans: a.pans && typeof a.pans === 'object' ? a.pans : undefined,
          layersOff: Array.isArray(a.layersOff) ? a.layersOff.filter((x: unknown) => x === 'lead' || x === 'answers' || x === 'counter') : undefined,
        }
      : undefined,
  } as Project;
}
