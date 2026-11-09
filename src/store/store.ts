import { create } from 'zustand';
import {
  DEFAULT_CORRECTION, MODEL_VERSION,
  type CorrectionSettings, type Emotion, type Genre, type KeySig, type Note, type Project,
  type Section, type SectionType, type Take, type TimeSig,
} from '../model/types';
import { STRUCTURES, defaultBarsFor } from '../model/presets';
import { feltBpm } from '../music/timesig';
import { uid } from '../model/id';
import { defaultLayersOff, defaultPalette } from '../theory/arrange/presets';
import { t } from '../i18n/ro';
import * as db from './db';
import { loadAudio, storeAudio, dropAudio } from './audioCache';
import { dsp } from '../workers/client';
import { correctNotes } from '../dsp/correct';
import { analyze as analyzeSync, pitchTrackFromFrames } from '../dsp/analyze';
const analyzeWith = (a: Float32Array, sr: number, bpm: number, p: { f0: number[]; voicing: number[] }) => analyzeSync(a, sr, bpm, pitchTrackFromFrames(a, sr, p.f0, p.voicing));
import type { NameStyle } from '../music/theory';
import { assignRoles, effectiveSection } from '../model/sections';
import { buildHarmony, harmonyInputFor } from './harmonyInput';
import { songLayout } from './arrangeInput';
import { candFromChord, type Chord, type ChordNaming, type HarmonicRate, type VariantId } from '../theory/harmony';

export type Mode = 'simplu' | 'pro';
export type Toast = { id: number; kind: 'info' | 'error' | 'ok'; text: string };
export interface Busy { label: string; progress: number }

const HISTORY_LIMIT = 100;
let toastSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const pref = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem('psalmist.' + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const setPref = (k: string, v: unknown) => { try { localStorage.setItem('psalmist.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export interface ProjectDraft {
  name: string; genre: Genre; emotion: Emotion; timeSig: TimeSig; bpm: number;
  structure: { type: SectionType; bars: number }[];
}

interface AppState {
  ready: boolean;
  projects: Project[];
  project: Project | null;
  sectionId: string | null;
  mode: Mode;
  noteStyle: NameStyle;
  chordNaming: ChordNaming;
  setChordNaming(n: ChordNaming): void;
  setTuningMode(takeId: string, mode: 'follow' | 'a440'): void;
  harmonize(sectionId: string): void;
  setHarmonyVariant(sectionId: string, v: VariantId): void;
  setHarmonyRate(sectionId: string, rate: HarmonicRate): void;
  /** Simplitate: re-harmonizes every harmonized section (locks kept where the slots still exist) */
  setSimplicity(s: 'simplu' | 'normal' | 'bogat'): void;
  /** arrangement energy 1..5 for a section (null = automatic) */
  setSectionEnergy(sectionId: string, energy: number | null): void;
  setDrop(on: boolean): void;
  /** instrument of one arrangement track (catalog id, `user:<id>`), null = the genre's default */
  setInstrument(trackId: string, id: string | null): void;
  /** church reverb space of the project and its amount trim */
  setSpace(space: string | null, level?: number): void;
  setPalette(palette: 'acustic' | 'clasic' | 'vesel'): void;
  /** "Semnalează aici": stores the playback time and the notes sounding around it */
  flagMoment(at: number, near: NonNullable<Project['flags']>[number]['near']): void;
  removeFlag(id: string): void;
  /** "Curățare AI": the AI result becomes the clean audio, the classic one stays as the A/B alternative */
  applyAiClean(sectionId: string, takeId: string, aiAudioId: string, kind?: 'ai' | 'restore'): void;
  setCleanKind(sectionId: string, takeId: string, kind: 'classic' | 'ai' | 'restore'): void;
  /** tempo map from the singer's beats (smoothed); null clears it */
  setTempoMap(map: number[] | null): void;
  setTranspose(semitones: number): void;
  patchFx(patch: { reverb?: number; delay?: number; duckDb?: number; on?: boolean }): void;
  setPan(trackId: string, pan: number | null): void;
  /** "Mix automat": clears pans and vocal-FX overrides (keeps the on/off switch) */
  autoMix(): void;
  addFinalTake(take: import('../model/types').FinalTake): void;
  deleteFinalTake(id: string): void;
  setComp(sectionId: string, takeId: string | null): void;
  /** shiftSec > 0 pads silence in front (pickup bar), < 0 trims the audio in front of the first downbeat */
  applyMeter(o: { bpm: number; sig: TimeSig; bars: number; sectionId: string; takeId: string; shiftSec: number }): Promise<void>;
  regenerateMelody(): void;
  toggleLayer(layer: 'lead' | 'answers' | 'counter'): void;
  setAiVariant(trackId: string, v: { notes: import('../theory/arrange/types').ArrNote[]; kept: number; input: number } | null): void;
  setChord(sectionId: string, idx: number, chord: Pick<Chord, 'root' | 'quality'>): void;
  toggleLock(sectionId: string, idx: number): void;
  viewNotes: 'corrected' | 'original';
  voiceSource: 'clean' | 'raw';
  past: Project[];
  future: Project[];
  saveState: 'saved' | 'saving' | 'error';
  busy: Record<string, Busy>;
  /** generated sections the user chose to record themselves */
  overrides: Record<string, true>;
  startOverride(id: string): void;
  endOverride(id: string): void;
  toasts: Toast[];

  init(): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): void;
  createProject(d: ProjectDraft): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  patchProject(patch: Partial<Pick<Project, 'name' | 'genre' | 'emotion' | 'timeSig' | 'bpm' | 'gridExact'>>): void;
  selectSection(id: string): void;
  setMode(m: Mode): void;
  setNoteStyle(s: NameStyle): void;
  setViewNotes(v: 'corrected' | 'original'): void;
  setVoiceSource(v: 'clean' | 'raw'): void;

  addSection(type: SectionType): void;
  removeSection(id: string): void;
  moveSection(id: string, dir: -1 | 1): void;
  patchSection(id: string, patch: Partial<Pick<Section, 'bars' | 'label' | 'type'>>): void;
  applyStructure(presetId: string): void;
  applyStructureTypes(types: SectionType[], bars?: number[]): void;

  addTake(sectionId: string, take: Take): void;
  /** the full-vocal import analyses the whole song once; every section takes ITS notes from that one analysis (harmony and the clash guard agree) */
  adoptNotes(sectionId: string, takeId: string, notes: Note[]): void;
  deleteTake(sectionId: string, takeId: string): void;
  setActiveTake(sectionId: string, takeId: string): void;
  setRoomTone(profile: Project['roomTone']): void;

  setKey(key: KeySig | null): void;
  setKeyLocked(locked: boolean): void;
  setCorrection(sectionId: string, takeId: string, patch: Partial<CorrectionSettings>): void;
  reapplyCorrection(sectionId: string, takeId: string, reset?: boolean): void;
  editNotes(sectionId: string, takeId: string, notes: Note[]): void;
  undo(): void;
  redo(): void;

  runClean(sectionId: string, takeId: string): Promise<void>;
  runAnalyze(sectionId: string, takeId: string): Promise<void>;
  runAll(sectionId: string, takeId: string): Promise<void>;

  notify(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
}

function makeSection(type: SectionType, order: number, bars: number, existing: Section[]): Section {
  const n = existing.filter((s) => s.type === type).length + 1;
  const base = t.sectionTypes[type];
  const same = existing.filter((s) => s.type === type).length;
  return {
    id: uid(), type, label: same > 0 || n > 1 ? `${base} ${n}` : base, order, bars, takes: [], activeTakeId: null, generated: false,
  };
}

function defaultBars(type: SectionType, bpm: number): number {
  return defaultBarsFor(type, bpm);
}

function relabel(sections: Section[]): Section[] {
  const counts: Partial<Record<SectionType, number>> = {};
  const totals: Partial<Record<SectionType, number>> = {};
  for (const s of sections) totals[s.type] = (totals[s.type] ?? 0) + 1;
  return assignRoles(sections).map((s, i) => {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
    const base = t.sectionTypes[s.type];
    const autoLabel = /^(.+?)( \d+)?$/.exec(s.label)?.[1] === base || s.label === base;
    return {
      ...s, order: i,
      label: autoLabel ? ((totals[s.type] ?? 0) > 1 ? `${base} ${counts[s.type]}` : base) : s.label,
    };
  });
}

function mapTake(p: Project, _sectionId: string, takeId: string, fn: (t: Take) => Take): Project {
  return {
    ...p,
    sections: p.sections.map((s) => s.takes.some((tk) => tk.id === takeId) ? { ...s, takes: s.takes.map((tk) => tk.id === takeId ? fn(tk) : tk) } : s),
  };
}

export const useApp = create<AppState>((set, get) => {
  const scheduleSave = () => {
    set({ saveState: 'saving' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = get().project;
      if (!p) return;
      try {
        await db.saveProject(p);
        const projects = get().projects.some((x) => x.id === p.id)
          ? get().projects.map((x) => (x.id === p.id ? p : x))
          : [p, ...get().projects];
        set({ saveState: 'saved', projects: projects.sort((a, b) => b.updatedAt - a.updatedAt) });
      } catch {
        set({ saveState: 'error' });
      }
    }, 300);
  };

  /** Apply a project change; pushes undo history when `history` is true. */
  const commit = (next: Project, history = true) => {
    const cur = get().project;
    const stamped = { ...next, updatedAt: Date.now() };
    set({
      project: stamped,
      past: history && cur ? [...get().past, cur].slice(-HISTORY_LIMIT) : get().past,
      future: history ? [] : get().future,
    });
    scheduleSave();
  };

  const setBusy = (takeId: string, b: Busy | null) => {
    const busy = { ...get().busy };
    if (b) busy[takeId] = b; else delete busy[takeId];
    set({ busy });
  };

  const recompute = (p: Project, take: Take): Note[] =>
    correctNotes(take.notesOriginal, p.key, p.bpm, p.timeSig, take.correction);

  return {
    ready: false,
    projects: [],
    project: null,
    sectionId: null,
    mode: pref<Mode>('mode', 'simplu'),
    noteStyle: pref<NameStyle>('noteStyle', 'solfege'),
    chordNaming: pref<ChordNaming>('chordNaming', 'letter'),
    setChordNaming(n) { setPref('chordNaming', n); set({ chordNaming: n }); },
    setTuningMode(takeId, mode) {
      const p = get().project;
      if (!p) return;
      commit({ ...p, sections: p.sections.map((s) => ({ ...s, takes: s.takes.map((tk) => (tk.id === takeId ? { ...tk, tuningMode: mode } : tk)) })) }, false);
    },
    harmonize(sectionId) {
      const p = get().project;
      const sec = p?.sections.find((s) => s.id === sectionId);
      if (!p || !sec) return;
      const inp = harmonyInputFor(p, sec);
      if (typeof inp === 'string') { get().notify('error', inp === 'noKey' ? t.chords.errKey : t.chords.errNotes); return; }
      const harmony = buildHarmony(inp, sec.harmony);
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, harmony } : s)) });
    },
    setHarmonyVariant(sectionId, v) {
      const p = get().project;
      if (!p) return;
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId && s.harmony ? { ...s, harmony: { ...s.harmony, active: v } } : s)) }, false);
    },
    setSectionEnergy(sectionId, energy) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const en = { ...cur.energy };
      if (energy === null) delete en[sectionId]; else en[sectionId] = Math.max(1, Math.min(5, Math.round(energy)));
      commit({ ...p, arrangement: { ...cur, energy: en } });
    },
    regenerateMelody() {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      commit({ ...p, arrangement: { ...cur, seed: Math.floor(Math.random() * 1e6) + 2 } });
    },
    setAiVariant(trackId, v) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const next = { ...(cur.aiVariants ?? {}) };
      if (v) next[trackId] = v; else delete next[trackId];
      commit({ ...p, arrangement: { ...cur, aiVariants: next } });
    },
    toggleLayer(layer) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const off = new Set(cur.layersOff ?? defaultLayersOff(cur.palette ?? defaultPalette(p.genre)));
      if (off.has(layer)) off.delete(layer); else off.add(layer);
      commit({ ...p, arrangement: { ...cur, layersOff: [...off] } });
    },
    patchFx(patch) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      commit({ ...p, arrangement: { ...cur, fx: { ...(cur.fx ?? {}), ...patch } } }, false);
    },
    autoMix() {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const { pans: _pans, fx, ...rest } = cur;
      void _pans;
      commit({ ...p, arrangement: { ...rest, ...(fx?.on === false ? { fx: { on: false } } : {}) } }, false);
    },
    setPan(trackId, pan) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const pans = { ...(cur.pans ?? {}) };
      if (pan === null) delete pans[trackId]; else pans[trackId] = Math.max(-1, Math.min(1, pan));
      commit({ ...p, arrangement: { ...cur, pans } }, false);
    },
    addFinalTake(take) {
      const p = get().project;
      if (!p) return;
      const fin = p.final ?? { takes: [], comp: {} };
      const comp = { ...fin.comp };
      // the new take becomes the chosen one for every section it covers
      for (const s of songLayout(p).sections) if (take.range[0] <= s.startSec + 0.05 && take.range[1] >= s.startSec + s.durSec - 0.3) comp[s.id] = take.id;
      commit({ ...p, final: { takes: [...fin.takes, take], comp } });
    },
    deleteFinalTake(id) {
      const p = get().project;
      if (!p?.final) return;
      const takes = p.final.takes.filter((x) => x.id !== id);
      const comp = Object.fromEntries(Object.entries(p.final.comp).filter(([, v]) => v !== id));
      commit({ ...p, final: { takes, comp } });
    },
    setComp(sectionId, takeId) {
      const p = get().project;
      if (!p?.final) return;
      const comp = { ...p.final.comp };
      if (takeId) comp[sectionId] = takeId; else delete comp[sectionId];
      commit({ ...p, final: { ...p.final, comp } }, false);
    },
    async applyMeter(o) {
      const p = get().project;
      if (!p) return;
      const sec = p.sections.find((s) => s.id === o.sectionId);
      const take = sec?.takes.find((x) => x.id === o.takeId);
      if (!sec || !take) return;
      // align: the first downbeat lands on a bar line (trim in front of it, or pad a short pickup bar), then re-run the analysis
      if (Math.abs(o.shiftSec) > 0.01) {
        for (const id of [take.rawAudioId, take.cleanAudioId]) {
          if (!id) continue;
          const a = await loadAudio(id);
          if (!a) continue;
          if (o.shiftSec < 0) await storeAudio(id, a.data.slice(Math.round(-o.shiftSec * a.sr)), a.sr);
          else { const out = new Float32Array(Math.round(o.shiftSec * a.sr) + a.data.length); out.set(a.data, Math.round(o.shiftSec * a.sr)); await storeAudio(id, out, a.sr); }
        }
        const raw = await loadAudio(take.rawAudioId);
        commit({ ...p, sections: p.sections.map((s) => s.id !== sec.id ? s : { ...s, takes: s.takes.map((x) => x.id === take.id ? { ...x, durationSec: raw ? raw.data.length / raw.sr : x.durationSec, analysis: undefined, notesOriginal: [], notesCorrected: [] } : x) }) });
      }
      get().patchProject({ bpm: o.bpm, timeSig: o.sig });
      get().patchSection(sec.id, { bars: o.bars });
      await get().runAll(sec.id, take.id);
    },
    setTranspose(semitones) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      commit({ ...p, arrangement: { ...cur, transpose: Math.max(-6, Math.min(6, Math.round(semitones))) || undefined } });
    },
    setInstrument(trackId, id) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const ins = { ...(cur.instruments ?? {}) };
      if (id) ins[trackId] = id; else delete ins[trackId];
      commit({ ...p, arrangement: { ...cur, instruments: ins } });
    },
    setTempoMap(map) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const next = { ...cur, tempoMap: map ?? undefined };
      if (!map) delete next.tempoMap;
      commit({ ...p, arrangement: next }, false);
    },
    flagMoment(at, near) {
      const p = get().project;
      if (!p) return;
      commit({ ...p, flags: [...(p.flags ?? []), { id: uid(), at, near, createdAt: Date.now() }] }, false);
      get().notify('ok', t.player.flagged(at));
    },
    applyAiClean(sectionId, takeId, aiAudioId, kind = 'ai') {
      const p = get().project;
      if (!p) return;
      commit(mapTake(p, sectionId, takeId, (x) => ({ ...x, cleanIds: { classic: x.cleanIds?.classic ?? (x.cleanKind ? undefined : x.cleanAudioId), ...x.cleanIds, [kind]: aiAudioId }, cleanAudioId: aiAudioId, cleanKind: kind })), false);
    },
    setCleanKind(sectionId, takeId, kind) {
      const p = get().project;
      if (!p) return;
      commit(mapTake(p, sectionId, takeId, (x) => (x.cleanIds?.[kind] ? { ...x, cleanAudioId: x.cleanIds[kind], cleanKind: kind } : x)), false);
    },
    removeFlag(id) {
      const p = get().project;
      if (p) commit({ ...p, flags: (p.flags ?? []).filter((f) => f.id !== id) }, false);
    },
    setPalette(palette) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      commit({ ...p, arrangement: { ...cur, palette, instruments: {} } });
    },
    setSpace(space, level) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      const next = { ...cur, space: space ?? undefined, spaceLevel: level ?? cur.spaceLevel };
      if (!space) delete next.space;
      commit({ ...p, arrangement: next });
    },
    setDrop(on) {
      const p = get().project;
      if (!p) return;
      const cur = p.arrangement ?? { v: 1 as const, energy: {}, drop: false };
      commit({ ...p, arrangement: { ...cur, drop: on } });
    },
    setSimplicity(s) {
      const p0 = get().project;
      if (!p0) return;
      const p = { ...p0, simplicity: s };
      const sections = p.sections.map((sec) => {
        if (!sec.harmony) return sec;
        const inp = harmonyInputFor(p, sec);
        if (typeof inp === 'string') return sec;
        return { ...sec, harmony: buildHarmony({ ...inp, rate: 'auto' }, sec.harmony) };
      });
      commit({ ...p, sections });
    },
    setHarmonyRate(sectionId, rate) {
      const p = get().project;
      const sec = p?.sections.find((s) => s.id === sectionId);
      if (!p || !sec) return;
      const inp = harmonyInputFor(p, sec);
      if (typeof inp === 'string') return;
      const harmony = buildHarmony({ ...inp, rate }, sec.harmony ? { ...sec.harmony, locks: { A: {}, B: {}, C: {} } } : null);
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, harmony } : s)) });
    },
    setChord(sectionId, idx, chord) {
      const p = get().project;
      const sec = p?.sections.find((s) => s.id === sectionId);
      if (!p || !p.key || !sec?.harmony) return;
      const h = sec.harmony;
      const c = candFromChord(chord, p.key).chord;
      const v = h.active;
      const chords = h.variants[v].map((x, i) => (i === idx ? c : x));
      const next = { ...h, variants: { ...h.variants, [v]: chords }, locks: { ...h.locks, [v]: { ...h.locks[v], [idx]: c } } };
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, harmony: next } : s)) });
    },
    toggleLock(sectionId, idx) {
      const p = get().project;
      const sec = p?.sections.find((s) => s.id === sectionId);
      if (!p || !sec?.harmony) return;
      const h = sec.harmony;
      const v = h.active;
      const locks = { ...h.locks[v] };
      if (locks[idx]) delete locks[idx]; else locks[idx] = h.variants[v][idx];
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, harmony: { ...h, locks: { ...h.locks, [v]: locks } } } : s)) });
    },

    viewNotes: 'corrected',
    voiceSource: 'clean',
    past: [],
    future: [],
    saveState: 'saved',
    busy: {},
    overrides: {},
    startOverride(id) { set({ overrides: { ...get().overrides, [id]: true } }); },
    endOverride(id) { const o = { ...get().overrides }; delete o[id]; set({ overrides: o }); },
    toasts: [],

    async init() {
      try {
        set({ projects: await db.listProjects(), ready: true });
      } catch {
        set({ ready: true });
        get().notify('error', t.errors.storage);
      }
    },

    async openProject(id) {
      if (get().project?.id === id) return;
      const p = (await db.loadProject(id)) ?? null;
      if (!p) { get().notify('error', t.errors.projectMissing); location.hash = '#/'; return; }
      const first = (p.sections.find((s) => !s.generated) ?? p.sections[0])?.id ?? null;
      let sel = first;
      try { const last = localStorage.getItem('psalmist.section.' + id); if (last && p.sections.some((s) => s.id === last)) sel = last; } catch { /* ignore */ }
      set({ project: p, sectionId: sel, past: [], future: [], overrides: {}, saveState: 'saved' });
    },
    closeProject() { set({ project: null, sectionId: null, past: [], future: [] }); },

    async createProject(d) {
      const now = Date.now();
      const sections: Section[] = [];
      d.structure.forEach((s, i) => sections.push(makeSection(s.type, i, s.bars, sections)));
      const p: Project = {
        id: uid(), name: d.name.trim() || t.project.untitled, version: MODEL_VERSION,
        genre: d.genre, emotion: d.emotion, timeSig: d.timeSig, bpm: d.bpm,
        key: null, keyLocked: false, sections: relabel(sections),
        voices: [{ id: uid(), role: 'lead', name: t.project.leadVoice }],
        createdAt: now, updatedAt: now,
      };
      await db.saveProject(p);
      set({ projects: [p, ...get().projects] });
      return p;
    },

    async deleteProject(id) {
      const p = get().projects.find((x) => x.id === id) ?? (await db.loadProject(id));
      if (p) {
        for (const s of p.sections) for (const tk of s.takes) { dropAudio(tk.rawAudioId); if (tk.cleanAudioId) dropAudio(tk.cleanAudioId); }
        await db.deleteProjectFully(p);
      }
      set({ projects: get().projects.filter((x) => x.id !== id) });
      if (get().project?.id === id) get().closeProject();
    },

    async renameProject(id, name) {
      const p = get().projects.find((x) => x.id === id);
      if (!p) return;
      const next = { ...p, name: name.trim() || p.name, updatedAt: Date.now() };
      await db.saveProject(next);
      set({ projects: get().projects.map((x) => (x.id === id ? next : x)) });
      if (get().project?.id === id) set({ project: next });
    },

    patchProject(patch) {
      const p = get().project;
      if (!p) return;
      let next = { ...p, ...patch };
      // tempo / meter changes invalidate corrected notes: recompute where not hand-edited
      if (patch.bpm !== undefined || patch.timeSig !== undefined) {
        next = {
          ...next,
          sections: next.sections.map((s) => ({
            ...s,
            takes: s.takes.map((tk) => tk.manuallyEdited || !tk.notesOriginal.length ? tk : { ...tk, notesCorrected: recompute(next, tk) }),
          })),
        };
      }
      commit(next);
    },

    selectSection(id) {
      set({ sectionId: id });
      const p = get().project;
      if (p) try { localStorage.setItem('psalmist.section.' + p.id, id); } catch { /* ignore */ }
    },
    setMode(m) { setPref('mode', m); set({ mode: m }); },
    setNoteStyle(s) { setPref('noteStyle', s); set({ noteStyle: s }); },
    setViewNotes(v) { set({ viewNotes: v }); },
    setVoiceSource(v) { set({ voiceSource: v }); },

    addSection(type) {
      const p = get().project;
      if (!p) return;
      const s = makeSection(type, p.sections.length, defaultBars(type, p.bpm), p.sections);
      commit({ ...p, sections: relabel([...p.sections, s]) });
      set({ sectionId: s.id });
    },
    removeSection(id) {
      const p = get().project;
      if (!p) return;
      const target = p.sections.find((s) => s.id === id);
      if (target) for (const tk of target.takes) { dropAudio(tk.rawAudioId); void db.deleteAudio(tk.rawAudioId); if (tk.cleanAudioId) void db.deleteAudio(tk.cleanAudioId); }
      const sections = relabel(p.sections.filter((s) => s.id !== id));
      commit({ ...p, sections });
      if (get().sectionId === id) set({ sectionId: sections[0]?.id ?? null });
    },
    moveSection(id, dir) {
      const p = get().project;
      if (!p) return;
      const i = p.sections.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.sections.length) return;
      const arr = [...p.sections];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      commit({ ...p, sections: relabel(arr) });
    },
    patchSection(id, patch) {
      const p = get().project;
      if (!p) return;
      commit(relabel2({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, patch.type !== undefined));
    },
    applyStructure(presetId) {
      const preset = STRUCTURES.find((s) => s.id === presetId);
      if (preset) get().applyStructureTypes(preset.types);
    },
    applyStructureTypes(types, bars) {
      const p = get().project;
      const preset = { types };
      if (!p) return;
      // keep existing takes by position
      const sections: Section[] = [];
      preset.types.forEach((type, i) => {
        const old = p.sections[i];
        const s = makeSection(type, i, old?.bars ?? bars?.[i] ?? defaultBars(type, p.bpm), sections);
        if (old) { s.takes = old.takes; s.activeTakeId = old.activeTakeId; s.id = old.id; }
        sections.push(s);
      });
      commit({ ...p, sections: relabel(sections) });
      set({ sectionId: sections[0]?.id ?? null });
    },

    adoptNotes(sectionId, takeId, notes) {
      const p = get().project;
      if (!p) return;
      commit({ ...p, sections: p.sections.map((s) => s.id !== sectionId ? s : { ...s, takes: s.takes.map((tk) => (tk.id !== takeId ? tk : { ...tk, notesOriginal: notes, notesCorrected: recompute(p, { ...tk, notesOriginal: notes }) })) }) }, false);
    },
    addTake(sectionId, take) {
      const p = get().project;
      if (!p) return;
      const take2 = { ...take, label: take.label ?? `${t.takes.take} ${(p.sections.find((s) => s.id === sectionId)?.takes.length ?? 0) + 1}` };
      commit({
        ...p,
        sections: p.sections.map((s) => s.id !== sectionId ? s : { ...s, takes: [...s.takes, take2], activeTakeId: take2.id }),
      });
    },
    deleteTake(sectionId, takeId) {
      const p = get().project;
      if (!p) return;
      const tk = p.sections.flatMap((s) => s.takes).find((x) => x.id === takeId);
      if (tk) { dropAudio(tk.rawAudioId); void db.deleteAudio(tk.rawAudioId); if (tk.cleanAudioId) void db.deleteAudio(tk.cleanAudioId); }
      commit({
        ...p,
        sections: p.sections.map((s) => {
          if (s.id !== sectionId) return s;
          const takes = s.takes.filter((x) => x.id !== takeId);
          return { ...s, takes, activeTakeId: s.activeTakeId === takeId ? takes[takes.length - 1]?.id ?? null : s.activeTakeId };
        }),
      });
    },
    setActiveTake(sectionId, takeId) {
      const p = get().project;
      if (!p) return;
      commit({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, activeTakeId: takeId } : s)) }, false);
    },
    setRoomTone(profile) {
      const p = get().project;
      if (p) commit({ ...p, roomTone: profile }, false);
    },

    setKey(key) {
      const p = get().project;
      if (!p) return;
      let next: Project = { ...p, key };
      next = {
        ...next,
        sections: next.sections.map((s) => ({
          ...s,
          takes: s.takes.map((tk) => tk.manuallyEdited || !tk.notesOriginal.length ? tk : { ...tk, notesCorrected: recompute(next, tk) }),
        })),
      };
      commit(next);
    },
    setKeyLocked(locked) {
      const p = get().project;
      if (p) commit({ ...p, keyLocked: locked });
    },

    setCorrection(sectionId, takeId, patch) {
      const p = get().project;
      if (!p) return;
      commit(mapTake(p, sectionId, takeId, (tk) => {
        const correction = { ...tk.correction, ...patch };
        const next = { ...tk, correction };
        return tk.manuallyEdited ? next : { ...next, notesCorrected: recompute(p, next) };
      }));
    },
    reapplyCorrection(sectionId, takeId, reset = false) {
      const p = get().project;
      if (!p) return;
      commit(mapTake(p, sectionId, takeId, (tk) => {
        const correction = reset ? { ...DEFAULT_CORRECTION } : tk.correction;
        const next = { ...tk, correction, manuallyEdited: false };
        return { ...next, notesCorrected: recompute(p, next) };
      }));
    },
    editNotes(sectionId, takeId, notes) {
      const p = get().project;
      if (!p) return;
      commit(mapTake(p, sectionId, takeId, (tk) => ({ ...tk, notesCorrected: notes, manuallyEdited: true })));
    },
    undo() {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT) });
      scheduleSave();
    },
    redo() {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project].slice(-HISTORY_LIMIT) });
      scheduleSave();
    },

    async runClean(sectionId, takeId) {
      const p = get().project;
      const tk = p?.sections.flatMap((s) => s.takes).find((x) => x.id === takeId);
      if (!p || !tk) return;
      setBusy(takeId, { label: t.steps.cleaning, progress: 0.15 });
      try {
        const raw = await loadAudio(tk.rawAudioId);
        if (!raw) throw new Error(t.errors.audioMissing);
        const res = await dsp.clean(raw.data, raw.sr, tk.noiseProfile ?? p.roomTone ?? null);
        const cleanId = tk.cleanIds?.classic ?? (tk.cleanKind ? uid() : tk.cleanAudioId ?? uid()); // AI / restored results stay as A/B alternatives
        await storeAudio(cleanId, res.audio, raw.sr);
        const cur = get().project!;
        commit(mapTake(cur, sectionId, takeId, (x) => ({ ...x, cleanAudioId: cleanId, cleanIds: { ...x.cleanIds, classic: cleanId }, cleanKind: 'classic', noiseProfile: res.profile })), false);
        get().notify('ok', t.steps.cleanDone);
      } catch (e) {
        get().notify('error', `${t.errors.clean} ${e instanceof Error ? e.message : ''}`);
      } finally { setBusy(takeId, null); }
    },

    async runAnalyze(sectionId, takeId) {
      const p = get().project;
      const tk = p?.sections.flatMap((s) => s.takes).find((x) => x.id === takeId);
      if (!p || !tk) return;
      setBusy(takeId, { label: t.steps.analyzing, progress: 0.3 });
      try {
        const src = await loadAudio(tk.cleanAudioId ?? tk.rawAudioId);
        if (!src) throw new Error(t.errors.audioMissing);
        const aiPitch = await (await import('./ai')).tryAiPitch(src.data, src.sr); // "Detecție note: AI" (CREPE) when selected and the service is up
        const analysis = aiPitch
          ? analyzeWith(src.data, src.sr, feltBpm(p.bpm, p.timeSig), aiPitch)
          : await dsp.analyze(src.data, src.sr, feltBpm(p.bpm, p.timeSig));
        let cur = get().project!;
        const firstKey = !cur.key && !cur.keyLocked && analysis.keyEstimate;
        if (firstKey && analysis.keyEstimate) {
          cur = { ...cur, key: { tonic: analysis.keyEstimate.tonic, mode: analysis.keyEstimate.mode }, keyLocked: true };
        }
        cur = mapTake(cur, sectionId, takeId, (x) => {
          const base = { ...x, analysis, notesOriginal: analysis.notes, manuallyEdited: false };
          return { ...base, notesCorrected: recompute(cur, base) };
        });
        commit(cur, false);
        if (!analysis.notes.length) get().notify('error', t.errors.noNotes);
        else get().notify('ok', t.steps.analyzeDone(analysis.notes.length));
      } catch (e) {
        get().notify('error', `${t.errors.analyze} ${e instanceof Error ? e.message : ''}`);
      } finally { setBusy(takeId, null); }
    },

    async runAll(sectionId, takeId) {
      await get().runClean(sectionId, takeId);
      await get().runAnalyze(sectionId, takeId);
    },

    notify(kind, text) {
      const id = ++toastSeq;
      set({ toasts: [...get().toasts, { id, kind, text }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast(id) { set({ toasts: get().toasts.filter((x) => x.id !== id) }); },
  };
});

function relabel2(p: Project, doRelabel: boolean): Project {
  return doRelabel ? { ...p, sections: relabel(p.sections) } : p;
}

/** The selected section exactly as stored. */
export const selectedSection = (s: AppState): Section | null =>
  s.project?.sections.find((x) => x.id === s.sectionId) ?? null;
/** The selected section, or the linked source when it is a generated copy without its own takes. */
export const currentSection = (s: AppState): Section | null => {
  const sec = selectedSection(s);
  if (sec && s.overrides[sec.id]) return sec;
  return sec && s.project ? effectiveSection(s.project, sec) : null;
};
export const activeTake = (sec: Section | null): Take | null =>
  sec?.takes.find((x) => x.id === sec.activeTakeId) ?? null;

if (import.meta.env.DEV) (globalThis as unknown as { __app: typeof useApp }).__app = useApp;
