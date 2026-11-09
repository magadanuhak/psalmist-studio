import { create } from 'zustand';
import { isExternal } from '../audio/external';
import { DEFAULT_SPACE } from '../audio/instruments/reverb';
import { entryOf, getUserInstrument } from './userInstruments';
import { engine, type EngineTrack, type EvNote, type PlayRequest, type VoiceClip } from '../audio/engine';
import { activeTake, currentSection, selectedSection, useApp } from './store';
import { loadAudio } from './audioCache';
import { barSec } from '../music/timesig';
import { effectiveSection } from '../model/sections';
import type { Note, Project } from '../model/types';
import { t } from '../i18n/ro';
import { arrangementFor, arrangementSettings, songLayout } from './arrangeInput';
import { duckCurve, duckDepth, finalClips, fxOn, processClip } from './finalMix';

export type Scope = 'section' | 'song';
export interface TrackCtl { vol: number; mute: boolean; solo: boolean }

/** Default balance: the voice leads (0.9); the melody-on-piano is only a quiet guide; instruments carry their own preset level (under the voice). */
export const DEFAULT_VOL: Record<string, number> = { voce: 0.9, melodie: 0, metro: 0.35 };

const loadVols = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem('psalmist.mixer') ?? '{}') as Record<string, number>; } catch { return {}; }
};
const saveVols = (ctl: Record<string, TrackCtl>) => {
  try {
    const o: Record<string, number> = {};
    for (const [k, v] of Object.entries(ctl)) o[k] = v.vol;
    localStorage.setItem('psalmist.mixer', JSON.stringify(o));
  } catch { /* storage unavailable */ }
};

interface PlayerState {
  scope: Scope;
  loop: boolean;
  metronome: boolean;
  /** per-track state; a track without an entry sits at its default level, unmuted */
  ctl: Record<string, TrackCtl>;
  vols: Record<string, number>;
  setScope(s: Scope): void;
  setLoop(v: boolean): void;
  setMetronome(v: boolean): void;
  setVol(id: string, v: number): void;
  toggleMute(id: string): void;
  toggleSolo(id: string): void;
  preset(p: 'voice' | 'acc' | 'all', ids: string[]): void;
  /** "Mix automat": every fader back to its designed level, nothing muted or soloed */
  resetLevels(): void;
  toggle(): Promise<void>;
  stop(): void;
  /** seek on the played timeline (section time in section scope, song time in song scope) */
  seek(sec: number): void;
  /** seek using time inside the selected section (piano roll) */
  seekLocal(sec: number): void;
}

export function visibleNotes(take: { notesOriginal: Note[]; notesCorrected: Note[] } | null, view: 'corrected' | 'original'): Note[] {
  if (!take) return [];
  return view === 'original' ? take.notesOriginal : take.notesCorrected;
}

export function sectionLength(): number {
  const st = useApp.getState();
  const sec = currentSection(st);
  const take = activeTake(sec);
  if (!st.project || !sec) return 0;
  const lastNote = take ? Math.max(0, ...take.notesCorrected.map((n) => n.startSec + n.durSec), ...take.notesOriginal.map((n) => n.startSec + n.durSec)) : 0;
  return Math.max(sec.bars * barSec(st.project.bpm, st.project.timeSig), take?.durationSec ?? 0, lastNote);
}

/** Start of the selected section on the song timeline. */
export function selectedStart(): number {
  const st = useApp.getState();
  const id = st.sectionId;
  return songLayout(st.project).sections.find((s) => s.id === id)?.startSec ?? 0;
}

/** Length of the timeline in the current scope (0 when there is nothing to play). */
export function timelineLength(scope: Scope): number {
  const st = useApp.getState();
  const p = st.project;
  if (!p) return 0;
  const lay = songLayout(p);
  if (scope === 'song') return lay.total;
  const sec = selectedSection(st);
  const plan = arrangementFor(p)?.plan.find((x) => x.id === sec?.id);
  return Math.max(sectionLength(), plan?.durSec ?? 0, sec ? sec.bars * barSec(p.bpm, p.timeSig) : 0);
}

/** Playhead inside the selected section (what the piano roll draws). */
export function localPosition(): number {
  const pos = engine.position();
  return usePlayer.getState().scope === 'song' ? pos - selectedStart() : pos;
}

export function levelOf(ctl: Record<string, TrackCtl>, vols: Record<string, number>, id: string, fallback: number): number {
  const c = ctl[id];
  const vol = c?.vol ?? vols[id] ?? DEFAULT_VOL[id] ?? fallback;
  const anySolo = Object.entries(ctl).some(([k, v]) => v.solo && k !== 'metro');
  const audible = !(c?.mute) && (id === 'metro' || !anySolo || !!c?.solo);
  return audible ? vol : 0;
}

function allLevels(ctl: Record<string, TrackCtl>, vols: Record<string, number>, ids: string[], defaults: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set(['voce', 'melodie', 'metro', ...ids])) out[id] = levelOf(ctl, vols, id, defaults[id] ?? 0.6);
  return out;
}

interface Built { req: PlayRequest; total: number; ids: string[] }

export interface MinusOpts { guide: boolean; metronome: boolean }

export async function buildRequest(scope: Scope, from: number, minus?: MinusOpts): Promise<Built | null> {
  const st = useApp.getState();
  const p: Project | null = st.project;
  if (!p) return null;
  const arr = arrangementFor(p);
  const lay = songLayout(p);
  const pl = usePlayer.getState();
  const semis = arrangementSettings(p).transpose ?? 0;
  const transposed = semis !== 0;
  const clips: VoiceClip[] = [];
  const raw: { data: Float32Array; sr: number; startSec: number }[] = [];
  const melody: EvNote[] = [];
  let tuningTake: ReturnType<typeof activeTake> = null;
  const fin = await finalClips(p);
  const useSource = async (sectionId: string, offset: number, maxDur: number) => {
    const real = p.sections.find((s) => s.id === sectionId)!;
    const fc = fin.find((c) => c.sectionId === sectionId);
    if (fc) {
      // the comped final voice (sung over the minus) replaces the reference take, with the vocal chain
      const [l, r] = fxOn(p) ? processClip(fc, p) : [fc.data, undefined];
      const from = scope === 'section' ? 0 : offset;
      clips.push({ data: l, right: r, sr: fc.sr, startSec: from, durSec: Math.min(fc.durSec, maxDur) });
      raw.push({ data: fc.data, sr: fc.sr, startSec: from });
    }
    const eff = scope === 'section' ? currentSection(st) ?? effectiveSection(p, real) : effectiveSection(p, real);
    const take = activeTake(eff);
    if (!take) return;
    if (!tuningTake && take.analysis) tuningTake = take;
    const id = st.voiceSource === 'clean' && take.cleanAudioId ? take.cleanAudioId : take.rawAudioId;
    const audio = await loadAudio(id);
    // the recorded voice cannot follow a transposed backing track
    if (audio && !transposed && !fc) clips.push({ data: audio.data, sr: audio.sr, startSec: offset, durSec: Math.min(audio.data.length / audio.sr, maxDur) });
    for (const n of visibleNotes(take, st.viewNotes)) {
      if (n.startSec < maxDur) melody.push({ midi: n.midi + semis, startSec: offset + n.startSec, durSec: n.durSec, vel: n.velocity });
    }
  };
  let total: number;
  let shift = 0; // arrangement time -> timeline time
  let win: [number, number] = [0, Infinity];
  if (scope === 'song') {
    total = lay.total;
    for (const s of lay.sections) await useSource(s.id, s.startSec, s.durSec);
  } else {
    const sec = selectedSection(st);
    if (!sec) return null;
    total = timelineLength('section');
    const ls = lay.sections.find((x) => x.id === sec.id);
    await useSource(sec.id, 0, total);
    shift = -(ls?.startSec ?? 0);
    win = [ls?.startSec ?? 0, (ls?.startSec ?? 0) + total];
  }
  // melody on piano: an octave higher for low voices so it does not mask the voice
  if (melody.length && Math.min(...melody.map((n) => n.midi)) < 55) for (const n of melody) n.midi += 12;
  melody.sort((a, b) => a.startSec - b.startSec);
  const tracks: EngineTrack[] = [{ id: 'melodie', kind: 'piano', notes: melody }];
  const defaults: Record<string, number> = {};
  if (arr) {
    for (const tr of arr.tracks) {
      defaults[tr.id] = tr.level;
      const notes: EvNote[] = [];
      for (const n of tr.notes) {
        const end = n.startSec + n.durSec;
        if (end <= win[0] || n.startSec >= win[1]) continue;
        const s0 = Math.max(n.startSec, win[0]);
        notes.push({ midi: n.midi, startSec: s0 + shift, durSec: Math.min(end, win[1]) - s0, vel: n.vel, art: n.art, attack: n.atk });
      }
      if (!notes.length) continue;
      const pan = arrangementSettings(p).pans?.[tr.id] ?? tr.pan;
      const entry = tr.inst ? entryOf(tr.inst) : undefined;
      tracks.push(tr.sampler
        ? { id: tr.id, kind: 'piano', notes }
        : !tr.drums && isExternal(entry)
          ? { id: tr.id, kind: 'ext', entry, channel: tr.channel, program: tr.gm, pan, reverb: tr.reverb, notes }
          : { id: tr.id, kind: 'sf', channel: tr.channel, program: tr.gm, drums: tr.drums, pan, reverb: tr.reverb, notes });
    }
  }
  if (minus) clips.length = 0;
  const hasContent = clips.length > 0 || tracks.some((x) => x.notes.length > 0);
  if (!hasContent || total <= 0) return null;
  const tk = tuningTake as ReturnType<typeof activeTake>;
  engine.setTuningCents(tk?.analysis?.tuningCents ?? 0, tk?.tuningMode ?? 'follow');
  const ids = tracks.map((x) => x.id);
  const levels = allLevels(pl.ctl, pl.vols, ids, defaults);
  if (minus) { levels.voce = 0; levels.melodie = minus.guide ? 0.3 : 0; levels.metro = 0.4; }
  const duck = !minus && raw.length && levels.voce > 0 ? duckCurve(raw, total, duckDepth(p)) : undefined;
  void from;
  return {
    total, ids,
    req: { from: 0, to: total, loop: minus ? false : pl.loop, clips, tracks, bpm: p.bpm, sig: p.timeSig, metronome: minus ? minus.metronome : pl.metronome, levels, duck, space: arrangementSettings(p).space ?? DEFAULT_SPACE[p.genre], spaceTrim: arrangementSettings(p).spaceLevel ?? 1, emotion: p.emotion },
  };
}

engine.getUser = getUserInstrument;

let chain: Promise<void> = Promise.resolve();

export const usePlayer = create<PlayerState>((set, get) => {
  /** current ids + default levels of the arrangement tracks (for live level changes) */
  const liveIds = () => {
    const arr = arrangementFor(useApp.getState().project);
    const ids = arr?.tracks.map((x) => x.id) ?? [];
    const defs: Record<string, number> = {};
    arr?.tracks.forEach((x) => { defs[x.id] = x.level; });
    return { ids, defs };
  };
  const push = () => {
    const { ctl, vols } = get();
    const { ids, defs } = liveIds();
    engine.setLevels(allLevels(ctl, vols, ids, defs));
  };
  const playFrom = async (scope: Scope, from: number) => {
    const st = useApp.getState();
    const built = await buildRequest(scope, from);
    if (!built) { st.notify('info', t.player.nothing); return; }
    const start = from >= built.total - 0.05 ? 0 : Math.max(0, from);
    try {
      await engine.play({ ...built.req, from: start });
      if (engine.fallbackNames.length) st.notify('info', t.audit.fallback(engine.fallbackNames.join(', ')));
    } catch (e) {
      console.error('[psalmist] playback failed', e);
      st.notify('error', engine.failure ?? (engine.sampleState === 'error' ? t.player.samplesError : t.player.playFailed(e instanceof Error ? e.message : String(e))));
    }
  };
  const enqueue = (fn: () => Promise<void>) => { chain = chain.then(fn, fn); return chain; };
  return {
    scope: 'section',
    loop: false,
    metronome: false,
    ctl: {},
    vols: loadVols(),
    setScope(s) {
      if (get().scope === s) return;
      const was = engine.playing;
      const pos = engine.position();
      const start = selectedStart();
      engine.stop();
      set({ scope: s });
      const next = s === 'song' ? start + (was ? pos : 0) : Math.max(0, was ? pos - start : 0);
      engine.seek(s === 'song' ? start : 0);
      if (was) void enqueue(() => playFrom(s, next));
    },
    setLoop(v) { set({ loop: v }); },
    setMetronome(v) { set({ metronome: v }); },
    setVol(id, v) {
      const ctl = { ...get().ctl, [id]: { ...(get().ctl[id] ?? { mute: false, solo: false }), vol: v } };
      const vols = { ...get().vols, [id]: v };
      set({ ctl, vols });
      saveVols(ctl);
      push();
    },
    toggleMute(id) {
      const c = get().ctl[id];
      const base = c ?? { vol: get().vols[id] ?? DEFAULT_VOL[id] ?? liveIds().defs[id] ?? 0.6, mute: false, solo: false };
      set({ ctl: { ...get().ctl, [id]: { ...base, mute: !base.mute } } });
      push();
    },
    toggleSolo(id) {
      const c = get().ctl[id];
      const base = c ?? { vol: get().vols[id] ?? DEFAULT_VOL[id] ?? liveIds().defs[id] ?? 0.6, mute: false, solo: false };
      set({ ctl: { ...get().ctl, [id]: { ...base, solo: !base.solo } } });
      push();
    },
    resetLevels() {
      set({ ctl: {}, vols: {} });
      saveVols({});
      push();
    },
    preset(p, ids) {
      const ctl: Record<string, TrackCtl> = {};
      const vols = get().vols;
      for (const id of ids) {
        const vol = vols[id] ?? DEFAULT_VOL[id] ?? liveIds().defs[id] ?? 0.6;
        const vocal = id === 'voce' || id === 'melodie';
        const mute = p === 'all' ? false : p === 'voice' ? id !== 'voce' : vocal;
        ctl[id] = { vol, mute, solo: false };
      }
      set({ ctl });
      push();
    },
    async toggle() {
      if (engine.playing) { engine.pause(); return; }
      const scope = get().scope;
      await enqueue(() => playFrom(scope, engine.position()));
    },
    stop() { engine.stop(); },
    seek(sec) {
      const scope = get().scope;
      const total = timelineLength(scope);
      const to = Math.max(0, Math.min(sec, Math.max(0, total - 0.02)));
      if (engine.playing) void enqueue(() => playFrom(scope, to));
      else engine.seek(to);
    },
    seekLocal(sec) {
      get().seek(get().scope === 'song' ? selectedStart() + sec : sec);
    },
  };
});

/** Choosing a section in the rail: whole-song playback keeps running; section playback stops. */
export function pickSection(id: string) {
  const st = useApp.getState();
  const pl = usePlayer.getState();
  if (pl.scope === 'song') {
    st.selectSection(id);
    if (!engine.playing) engine.seek(songLayout(st.project).sections.find((s) => s.id === id)?.startSec ?? 0);
  } else {
    engine.stop();
    st.selectSection(id);
  }
}

if (import.meta.env.DEV) (globalThis as unknown as { __build: typeof buildRequest }).__build = buildRequest;
if (import.meta.env.DEV) (globalThis as unknown as { __player: typeof usePlayer }).__player = usePlayer;
