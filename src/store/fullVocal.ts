/** "Construiește din vocea completă": one full-song vocal -> project with the form found on the original timeline.
 *  The bar grid comes from the user's taps when given (it overrides the estimate from the vocal). */
import type { Emotion, Genre, KeySig, Note, TimeSig } from '../model/types';
import { analyze } from '../dsp/analyze';
import { detectMeter, phrasePeriod, type OnsetIn } from '../dsp/meter';
import { denseNotes, fitBarGrid, formFromVocal, mainBlockNotes, type FormResult } from '../dsp/formFromVocal';
import type { TapGrid } from '../dsp/tapGrid';
import { engine } from '../audio/engine';
import { useApp } from './store';
import { makeTake } from './rec';

export const FULL_SIGS: Record<string, TimeSig> = {
  '4/4': { num: 4, den: 4, grouping: [4] }, '3/4': { num: 3, den: 4, grouping: [3] }, '2/4': { num: 2, den: 4, grouping: [2] }, '6/8': { num: 6, den: 8, grouping: [3, 3] }, '12/8': { num: 12, den: 8, grouping: [3, 3, 3, 3] },
};

export interface FullAnalysis { mono: Float32Array; sr: number; sec: number; notes: OnsetIn[]; raw: Note[]; key: KeySig | null; name: string }
export interface FullPlan { bpm: number; sig: TimeSig; bar: number; t0: number; form: FormResult; fromTaps: boolean }

export async function analyzeFullVocal(file: File): Promise<FullAnalysis> {
  await engine.ensureContext();
  const buf = await engine.rawContext.decodeAudioData(await file.arrayBuffer());
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels; }
  const an = analyze(mono, buf.sampleRate, 90);
  return {
    mono, sr: buf.sampleRate, sec: buf.length / buf.sampleRate, name: file.name.replace(/\.[^.]+$/, ''),
    key: an.keyEstimate ? { tonic: an.keyEstimate.tonic, mode: an.keyEstimate.mode } : null,
    raw: an.notes,
    notes: an.notes.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity })),
  };
}

/** Short or unstructured singing: one strofă, then a refren from the second half (at least 2 bars each), on the bar grid. */
export function simpleForm(notes: OnsetIn[], bar: number, t0: number): FormResult | null {
  if (notes.length < 4) return null;
  const first = Math.min(...notes.map((n) => n.startSec)), last = Math.max(...notes.map((n) => n.startSec + n.durSec));
  const startBar = Math.max(0, Math.floor((first - t0) / bar + 0.15));
  const endBar = Math.max(startBar + 2, Math.ceil((last - t0) / bar - 0.15));
  const total = endBar - startBar;
  const mk = (type: FormResult['sections'][number]['type'], sb: number, bars: number): FormResult['sections'][number] => ({ type, startBar: sb, bars, startSec: t0 + sb * bar, endSec: t0 + (sb + bars) * bar, vocal: true });
  const sections = total >= 4 ? [mk('strofa', startBar, Math.ceil(total / 2)), mk('refren', startBar + Math.ceil(total / 2), total - Math.ceil(total / 2))] : [mk('strofa', startBar, total)];
  return { t0, barSec: bar, sections, blocks: [{ startSec: t0 + startBar * bar, endSec: t0 + endBar * bar }] };
}

/** Tempo, bar grid and form. `grid` (the user's taps) replaces the grid estimated from the vocal. */
export function planFullVocal(notes: OnsetIn[], totalSec: number, opt: { sigId?: string; bpm?: number; grid?: TapGrid | null } = {}): FullPlan | null {
  const r = detectMeter({ notes: mainBlockNotes(notes) });
  if (!r) return null;
  const wantSig = opt.sigId ?? '4/4';
  const top = r.options.find((o) => `${o.sig.num}/${o.sig.den}` === wantSig) ?? { ...r.options[0], sig: FULL_SIGS[wantSig] ?? r.options[0].sig };
  const sig = top.sig;
  let bpm = opt.bpm ?? (sig.den === 8 && top.sig.den === 4 ? top.bpm * 3 : top.bpm);
  let bar = (60 / bpm) * sig.num;
  if (!opt.bpm) {
    const ph = phrasePeriod(denseNotes(notes));
    if (ph && Math.abs(ph.sec / 4 - bar) / bar < 0.08) { bar = ph.sec / 4; bpm = Math.round((60 * sig.num) / bar * 10) / 10; }
  }
  const g = fitBarGrid(notes, bar, sig.num === 12 ? 4 : sig.num);
  let t0 = top.firstDownbeatSec % bar;
  if (g) { bar = g.barSec; bpm = Math.round((60 * sig.num) / bar * 10) / 10; t0 = g.t0; }
  if (opt.grid) { bar = opt.grid.barSec; t0 = opt.grid.t0; bpm = Math.round((60 * sig.num) / bar * 10) / 10; }
  const form = formFromVocal(notes, bar, t0, totalSec) ?? simpleForm(notes, bar, t0);
  return form ? { bpm, sig, bar, t0, form, fromTaps: !!opt.grid } : null;
}

export type BuildStage = { done: number; total: number };

/** Creates the project, cuts every vocal section from the original (on the bar grid), analyses it and writes the chords. Resolves with the project id. */
export async function buildFromFullVocal(a: FullAnalysis, plan: FullPlan, o: { genre: Genre; emotion: Emotion; name?: string; onProgress?(s: BuildStage): void }): Promise<string> {
  const app = useApp.getState();
  const p = await app.createProject({ name: o.name || a.name, genre: o.genre, emotion: o.emotion, timeSig: plan.sig, bpm: plan.bpm, structure: plan.form.sections.map((s) => ({ type: s.type, bars: s.bars })) });
  await app.openProject(p.id);
  const st = () => useApp.getState();
  if (plan.fromTaps) st().patchProject({ gridExact: true });
  if (a.key) { st().setKey(a.key); st().setKeyLocked(true); }
  const ids = st().project!.sections.map((s) => s.id);
  const vocal = plan.form.sections.map((s, i) => ({ s, id: ids[i] })).filter((x) => x.s.vocal);
  let done = 0;
  for (const { s, id } of vocal) {
    o.onProgress?.({ done, total: vocal.length });
    const from = Math.max(0, Math.round(s.startSec * a.sr)), to = Math.min(a.mono.length, Math.round(s.endSec * a.sr));
    const take = await makeTake(id, a.mono.slice(from, to), a.sr, 'import', 0, a.name);
    await st().runAll(id, take.id);
    st().harmonize(id);
    done++;
  }
  o.onProgress?.({ done, total: vocal.length });
  return p.id;
}
