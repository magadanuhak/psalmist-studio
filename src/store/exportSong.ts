import type { Project } from '../model/types';
import { engine } from '../audio/engine';
import { encodeWav24, masterMix, renderSong, type RenderInstrument, type VoiceClipIn } from '../audio/offline';
import { barClicks, barSec, beatSec } from '../music/timesig';
import { effectiveSection } from '../model/sections';
import { arrangementFor, arrangementSettings, songLayout } from './arrangeInput';
import { duckDepth, finalClips, fxOn, fxPreset } from './finalMix';
import { levelOf, usePlayer, visibleNotes } from './player';
import { activeTake, useApp } from './store';
import { loadAudio } from './audioCache';
import { presetFor } from '../dsp/fx';
import { zipStore } from '../music/zip';
import { isExternal, renderExternalBus, type ExtSpec } from '../audio/external';
import { DEFAULT_SPACE } from '../audio/instruments/reverb';
import { entryOf, getUserInstrument } from './userInstruments';
import { auditExport, TARGET_CURVE, type ExportAudit } from '../audio/audit';

export interface ExportOpts {
  kind: 'mix' | 'minus';
  rate: 44100 | 48000;
  stems: boolean;
  guide: boolean;
  countIn: boolean;
  metronome: boolean;
  onProgress?(p: number): void;
  signal?: { aborted: boolean };
}
export interface ExportOut { wav: ArrayBuffer; stems?: Uint8Array; lufs: number; truePeakDb: number; seconds: number; audit?: ExportAudit; fallbacks?: string[] }

export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'psalmist';
export const fileBase = (p: Project) => slug(p.name);

export async function exportSong(p: Project, o: ExportOpts): Promise<ExportOut> {
  const arr = arrangementFor(p);
  if (!arr) throw new Error('arrangement');
  const st = useApp.getState();
  const pl = usePlayer.getState();
  const lay = songLayout(p);
  const sets = arrangementSettings(p);
  const semis = sets.transpose ?? 0;
  const bar = barSec(p.bpm, p.timeSig);
  const used = new Set(arr.tracks.map((t) => t.channel));
  let free = 0;
  const nextFree = () => { while (used.has(free) || free === 9) free++; used.add(free); return free; };
  const levels: Record<string, number> = {};
  for (const t of arr.tracks) levels[t.id] = levelOf(pl.ctl, pl.vols, t.id, t.level);
  // tier A / C / user instruments render through the Web Audio / Tone offline bus; General MIDI and drums stay in the SoundFont
  const space = sets.space ?? DEFAULT_SPACE[p.genre];
  const ext: ExtSpec[] = [];
  const sfTracks = arr.tracks.filter((t) => {
    const e = t.inst ? entryOf(t.inst) : undefined;
    if (t.drums || !isExternal(e) || !t.notes.length) return true;
    ext.push({ id: t.id, entry: e, pan: sets.pans?.[t.id] ?? t.pan, level: levels[t.id] * 1.414, notes: t.notes.map((n) => ({ midi: n.midi, time: n.startSec, dur: n.durSec, vel: n.vel, art: n.art, attack: n.atk })) });
    return false;
  });
  const toInst = (t: (typeof arr.tracks)[number]): RenderInstrument => ({ id: t.id, name: t.name, channel: t.channel, program: t.drums ? 0 : t.gm, drums: t.drums, pan: sets.pans?.[t.id] ?? t.pan, notes: t.notes, bus: 'acc' as const });
  const inst: RenderInstrument[] = sfTracks.map(toInst);

  // guide melody (piano, quiet), an octave higher for low voices
  const melody: { midi: number; startSec: number; durSec: number; vel: number }[] = [];
  let tuningTake: ReturnType<typeof activeTake> = null;
  p.sections.forEach((s, i) => {
    const take = activeTake(effectiveSection(p, s));
    if (!take) return;
    if (!tuningTake && take.analysis) tuningTake = take;
    for (const n of visibleNotes(take, st.viewNotes)) if (n.startSec < lay.sections[i].durSec) melody.push({ midi: n.midi + semis, startSec: lay.sections[i].startSec + n.startSec, durSec: n.durSec, vel: n.velocity });
  });
  if (melody.length && Math.min(...melody.map((n) => n.midi)) < 55) for (const n of melody) n.midi += 12;
  const wantGuide = o.kind === 'minus' ? o.guide : levelOf(pl.ctl, pl.vols, 'melodie', 0) > 0;
  if (wantGuide && melody.length) {
    inst.push({ id: 'melodie', name: 'Melodie', channel: nextFree(), program: 0, drums: false, pan: 0, notes: melody, bus: 'direct' });
    levels.melodie = o.kind === 'minus' ? 0.3 : levelOf(pl.ctl, pl.vols, 'melodie', 0);
  }

  // voice (mix only): the comped final takes, else the reference takes of every section
  let voice: { clips: VoiceClipIn[]; preset: ReturnType<typeof presetFor>; bpm: number; level: number } | undefined;
  if (o.kind === 'mix' && levelOf(pl.ctl, pl.vols, 'voce', 0.9) > 0) {
    const clips: VoiceClipIn[] = (await finalClips(p)).map((c) => ({ data: c.data, sr: c.sr, startSec: c.startSec, durSec: c.durSec }));
    if (!clips.length && !semis) {
      for (let i = 0; i < p.sections.length; i++) {
        const take = activeTake(effectiveSection(p, p.sections[i]));
        if (!take) continue;
        const a = await loadAudio(st.voiceSource === 'clean' && take.cleanAudioId ? take.cleanAudioId : take.rawAudioId);
        if (a) clips.push({ data: a.data, sr: a.sr, startSec: lay.sections[i].startSec, durSec: Math.min(a.data.length / a.sr, lay.sections[i].durSec) });
      }
    }
    if (clips.length) {
      const dry = { ...presetFor('lauda'), reverb: { send: 0, room: 0, damp: 0, preDelayMs: 0 }, delay: { send: 0, beats: 0.5, feedback: 0 } };
      voice = { clips, preset: fxOn(p) ? fxPreset(p) : dry, bpm: p.bpm, level: levelOf(pl.ctl, pl.vols, 'voce', 0.9) };
    }
  }

  // metronome clicks and count-in
  const clicks: { t: number; accent: boolean }[] = [];
  const lead = o.kind === 'minus' && o.countIn ? bar : 0;
  if (o.kind === 'minus' && (o.metronome || o.countIn)) {
    const pat = barClicks(p.timeSig), beat = beatSec(p.bpm);
    if (o.countIn) for (let i = 0; i < p.timeSig.num; i++) clicks.push({ t: -lead + i * beat, accent: pat[i] === 'accent' });
    if (o.metronome) for (let i = 0; i * beat < arr.songSec; i++) clicks.push({ t: i * beat, accent: pat[i % p.timeSig.num] === 'accent' });
  }

  const sf = await engine.soundFontBytes();
  const tk = tuningTake as ReturnType<typeof activeTake>;
  const tuning = tk?.tuningMode === 'a440' ? 0 : tk?.analysis?.tuningCents ?? 0;
  const t0 = performance.now();
  const songSec = Math.max(arr.songSec, lay.total);
  const busOpt = { sampleRate: o.rate, totalSec: songSec + lead + 1.5, tuningCents: tuning, space, spaceTrim: sets.spaceLevel ?? 1, emotion: p.emotion, getUser: getUserInstrument, signal: o.signal };
  const shifted = (e: ExtSpec): ExtSpec => ({ ...e, notes: e.notes.map((n) => ({ ...n, time: n.time + lead })) });
  let extra: { ch: [Float32Array, Float32Array]; stems?: { id: string; name: string; ch: [Float32Array, Float32Array] }[] } | undefined;
  const fallbacks: string[] = [];
  if (ext.length) {
    const bus = await renderExternalBus(ext.map(shifted), { ...busOpt, onProgress: (x) => o.onProgress?.(0.02 + x * 0.1) });
    let failed = bus.failed;
    let good = ext.filter((e) => !failed.includes(e.id));
    if (failed.length) {
      // GM fallback: the tracks whose samples could not be loaded play through the SoundFont instead
      for (const id of failed) {
        const t = arr.tracks.find((x) => x.id === id)!;
        fallbacks.push(t.name);
        if (t.gm !== null) inst.push(toInst(t));
      }
      const again = await renderExternalBus(good.map(shifted), busOpt);
      extra = { ch: again.ch };
      good = good.filter((e) => !again.failed.includes(e.id));
    } else extra = { ch: bus.ch };
    if (o.stems && extra) {
      const stems: { id: string; name: string; ch: [Float32Array, Float32Array] }[] = [];
      for (const e of good) {
        const one = await renderExternalBus([shifted(e)], busOpt);
        stems.push({ id: e.id, name: arr.tracks.find((t) => t.id === e.id)?.name ?? e.id, ch: one.ch });
      }
      extra.stems = stems;
    }
  }
  const r = await renderSong(sf, inst, {
    sampleRate: o.rate, songSec, levels, leadSec: lead, voice, clicks, clickLevel: 0.4, extra,
    duckDepthDb: duckDepth(p), balanceTarget: TARGET_CURVE[p.genre], tuningCents: tuning, wantStems: o.stems, onProgress: (x) => o.onProgress?.(0.12 + x * 0.78), signal: o.signal,
  });
  const m = masterMix(r).mastered!;
  o.onProgress?.(0.95);
  const wav = encodeWav24(m.ch, o.rate);
  let stems: Uint8Array | undefined;
  if (o.stems) stems = zipStore(r.stems.map((s) => ({ name: `${fileBase(p)}-${slug(s.name)}.wav`, data: new Uint8Array(encodeWav24(s.ch, o.rate)) })));
  o.onProgress?.(1);
  const audit = auditExport({ ch: m.ch, sr: o.rate, lufs: m.lufs, truePeakDb: m.truePeakDb, arr, bpm: p.bpm, beats: p.timeSig.num, genre: p.genre, vocal: o.kind === 'mix' && !!voice });
  return { wav, stems, lufs: m.lufs, truePeakDb: m.truePeakDb, seconds: (performance.now() - t0) / 1000, audit, fallbacks };
}
