/** Deep voice analysis (X0): range, tessitura, voice type, intonation, timing, stability, breath map, dynamics,
 *  plus the recommended key (transposition of the backing track). Pure TypeScript, no audio, no React. */
import type { Analysis, KeySig, Note, Pause, PitchTrack } from '../model/types';
import { pcName } from '../music/theory';

export type VoiceType = 'bas' | 'bariton' | 'tenor' | 'alto' | 'mezzo' | 'sopran';
export const VOICE_LABEL: Record<VoiceType, string> = { bas: 'bas', bariton: 'bariton', tenor: 'tenor', alto: 'alto', mezzo: 'mezzosoprană', sopran: 'soprană' };

/** comfortable tessitura centre, practical floor / ceiling (MIDI) of every voice type */
export const VOICE_ZONE: Record<VoiceType, { centre: number; floor: number; ceiling: number }> = {
  bas: { centre: 47, floor: 38, ceiling: 62 },
  bariton: { centre: 51.5, floor: 43, ceiling: 66 },
  tenor: { centre: 57, floor: 48, ceiling: 71 },
  alto: { centre: 62, floor: 53, ceiling: 76 },
  mezzo: { centre: 65, floor: 55, ceiling: 79 },
  sopran: { centre: 70, floor: 60, ceiling: 84 },
};

export type Intonation = 'ok' | 'flat' | 'sharp';
export const IN_TUNE_CENTS = 25;
export const noteIntonation = (n: Pick<Note, 'centsDev'>): Intonation => (n.centsDev < -IN_TUNE_CENTS ? 'flat' : n.centsDev > IN_TUNE_CENTS ? 'sharp' : 'ok');

export interface PitchClassTendency { pc: number; meanCents: number; count: number }

export interface VoiceReport {
  noteCount: number;
  voicedSec: number;
  range: { lo: number; hi: number } | null;
  /** where 80% of the sung time lies (10%..90% of duration-weighted pitch distribution) */
  tessitura: { lo: number; hi: number; centre: number } | null;
  voiceType: VoiceType | null;
  intonation: {
    /** mean |cents| of the notes after removing the singer's global offset */
    meanAbsCents: number;
    withinTolerancePct: number;
    /** global offset vs A440 in cents (+ sharp) */
    globalCents: number;
    flat: PitchClassTendency[];
    sharp: PitchClassTendency[];
  };
  timing: { meanAbsMs: number; maxAbsMs: number; biasMs: number; notes: number };
  stability: { vibratoHz: number | null; vibratoCents: number | null; driftCentsPerSec: number; vibratoNotes: number };
  breath: { pauses: number; longestSec: number; map: { startSec: number; durSec: number }[] };
  dynamics: { rangeDb: number };
  tips: string[];
}

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pcOf = (m: number) => ((m % 12) + 12) % 12;
const note = (pc: number) => pcName(pc, 'solfege');

function weightedQuantile(notes: Note[], q: number): number {
  const s = [...notes].sort((a, b) => a.midi - b.midi);
  const total = s.reduce((t, n) => t + n.durSec, 0);
  let acc = 0;
  for (const n of s) { acc += n.durSec; if (acc >= q * total) return n.midi; }
  return s[s.length - 1].midi;
}

export function voiceTypeOf(centre: number, lo: number, hi: number): VoiceType {
  void lo; void hi;
  if (centre < 49) return 'bas';
  if (centre < 54.5) return 'bariton';
  if (centre < 59.5) return 'tenor';
  if (centre < 63.5) return 'alto';
  if (centre < 67.5) return 'mezzo';
  return 'sopran';
}

/** cents contour of every stable note from the pitch track, relative to the note median */
function noteContours(track: PitchTrack | undefined, notes: Note[]) {
  const out: { n: Note; cents: Float32Array; hop: number }[] = [];
  if (!track) return out;
  const hop = track.hopSec;
  for (const n of notes) {
    if (n.durSec < 0.5) continue;
    const a = Math.floor((n.startSec + 0.12) / hop), b = Math.floor((n.startSec + n.durSec - 0.05) / hop);
    const c: number[] = [];
    for (let k = a; k < b && k < track.hz.length; k++) if (track.hz[k] > 0) c.push(1200 * Math.log2(track.hz[k] / 440));
    if (c.length < 25) continue;
    const m = median(c);
    out.push({ n, cents: Float32Array.from(c.map((x) => x - m)), hop });
  }
  return out;
}

/** vibrato rate (Hz) and half-extent (cents) from a detrended cents contour; null when there is none */
function vibrato(c: Float32Array, hop: number): { hz: number; cents: number } | null {
  // remove slow drift with a 0.25 s moving average
  const w = Math.max(3, Math.round(0.25 / hop));
  const d = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(c.length - 1, i + w); j++) { s += c[j]; k++; }
    d[i] = c[i] - s / k;
  }
  const sorted = [...d].sort((a, b) => a - b);
  const ext = (sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.05)]) / 2;
  if (ext < 8) return null;
  let crossings = 0, first = -1, last = -1;
  for (let i = 1; i < d.length; i++) if (d[i - 1] < 0 && d[i] >= 0) { crossings++; if (first < 0) first = i; last = i; }
  if (crossings < 3) return null;
  const hz = ((crossings - 1) / ((last - first) * hop));
  if (hz < 3 || hz > 9) return null;
  return { hz, cents: ext };
}

export interface ReportInput {
  notes: Note[];
  analysis?: Pick<Analysis, 'pitchTrack' | 'pauses' | 'tuningCents' | 'tuningConcentration'> | null;
  pauses?: Pause[];
  bpm: number;
  /** beat time offsets are measured against this grid unit in beats (default 1/2 beat) */
  gridBeats?: number;
}

export function analyzeVoice(inp: ReportInput): VoiceReport {
  const notes = inp.notes.filter((n) => n.durSec >= 0.1);
  const a = inp.analysis ?? null;
  const beat = 60 / inp.bpm;
  const grid = beat * (inp.gridBeats ?? 0.5);
  const tuning = a?.tuningCents ?? 0;

  // range & tessitura (stable notes only)
  const stable = notes.filter((n) => n.durSec >= 0.25 && n.confidence >= 0.4);
  const base = stable.length ? stable : notes;
  const range = base.length ? { lo: Math.min(...base.map((n) => n.midi)), hi: Math.max(...base.map((n) => n.midi)) } : null;
  let tessitura: VoiceReport['tessitura'] = null;
  if (base.length) {
    const lo = weightedQuantile(base, 0.1), hi = weightedQuantile(base, 0.9);
    tessitura = { lo, hi, centre: (lo + hi) / 2 };
  }
  const voiceType = tessitura && range ? voiceTypeOf(tessitura.centre, range.lo, range.hi) : null;

  // intonation: centsDev is the deviation from the nearest semitone after the global offset was removed
  const devs = base.map((n) => n.centsDev);
  const meanAbs = devs.length ? devs.reduce((s, x) => s + Math.abs(x), 0) / devs.length : 0;
  const within = devs.length ? (devs.filter((x) => Math.abs(x) <= IN_TUNE_CENTS).length / devs.length) * 100 : 0;
  const byPc = new Map<number, number[]>();
  for (const n of base) { const k = pcOf(n.midi); byPc.set(k, [...(byPc.get(k) ?? []), n.centsDev]); }
  const tend: PitchClassTendency[] = [...byPc].map(([pc, v]) => ({ pc, meanCents: v.reduce((s, x) => s + x, 0) / v.length, count: v.length }));
  const flat = tend.filter((t) => t.count >= 2 && t.meanCents <= -15).sort((x, y) => x.meanCents - y.meanCents);
  const sharp = tend.filter((t) => t.count >= 2 && t.meanCents >= 15).sort((x, y) => y.meanCents - x.meanCents);

  // timing: onset deviation from the nearest grid point after removing the constant offset
  const onsets = notes.filter((n) => n.confidence >= 0.4).map((n) => {
    const k = Math.round(n.startSec / grid);
    return (n.startSec - k * grid) * 1000;
  });
  const bias = median(onsets);
  const devMs = onsets.map((x) => Math.abs(x - bias));
  const timing = {
    meanAbsMs: devMs.length ? devMs.reduce((s, x) => s + x, 0) / devMs.length : 0,
    maxAbsMs: devMs.length ? Math.max(...devMs) : 0,
    biasMs: bias,
    notes: onsets.length,
  };

  // stability
  const contours = noteContours(a?.pitchTrack, notes);
  const vib = contours.map((c) => vibrato(c.cents, c.hop)).filter((x): x is { hz: number; cents: number } => !!x);
  let drift = 0;
  const longs = contours.filter((c) => c.n.durSec >= 0.8);
  for (const c of longs) {
    const n = c.cents.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const x = i * c.hop; sx += x; sy += c.cents[i]; sxx += x * x; sxy += x * c.cents[i]; }
    drift += (n * sxy - sx * sy) / (n * sxx - sx * sx + 1e-9);
  }
  drift = longs.length ? drift / longs.length : 0;
  const stability = {
    vibratoHz: vib.length ? median(vib.map((v) => v.hz)) : null,
    vibratoCents: vib.length ? median(vib.map((v) => v.cents)) : null,
    driftCentsPerSec: drift,
    vibratoNotes: vib.length,
  };

  // breath / pauses
  const pauses = (a?.pauses ?? inp.pauses ?? []).filter((p) => p.durSec >= 0.3);
  const breath = { pauses: pauses.length, longestSec: pauses.length ? Math.max(...pauses.map((p) => p.durSec)) : 0, map: pauses.map((p) => ({ startSec: p.startSec, durSec: p.durSec })) };

  // dynamics from the loudness track
  let rangeDb = 0;
  const tr = a?.pitchTrack;
  if (tr) {
    const lv: number[] = [];
    for (let i = 0; i < tr.rms.length; i++) if (tr.hz[i] > 0 && tr.rms[i] > 1e-5) lv.push(20 * Math.log10(tr.rms[i]));
    if (lv.length > 20) { lv.sort((x, y) => x - y); rangeDb = lv[Math.floor(lv.length * 0.95)] - lv[Math.floor(lv.length * 0.05)]; }
  } else if (base.length) {
    const v = base.map((n) => n.velocity).sort((x, y) => x - y);
    rangeDb = (v[v.length - 1] - v[0]) * 30;
  }

  const rep: VoiceReport = {
    noteCount: notes.length,
    voicedSec: notes.reduce((s, n) => s + n.durSec, 0),
    range, tessitura, voiceType,
    intonation: { meanAbsCents: meanAbs, withinTolerancePct: within, globalCents: tuning, flat, sharp },
    timing, stability, breath, dynamics: { rangeDb },
    tips: [],
  };
  rep.tips = voiceTips(rep);
  return rep;
}

/** Plain-Romanian advice built from the numbers. */
export function voiceTips(r: VoiceReport): string[] {
  const tips: string[] = [];
  if (!r.noteCount) return ['Nu am găsit note clare. Înregistrează aproape de microfon, într-o cameră liniștită.'];
  const i = r.intonation;
  if (i.withinTolerancePct >= 85) tips.push(`Intonația e foarte bună: ${Math.round(i.withinTolerancePct)}% din note sunt în ±${IN_TUNE_CENTS} cenți.`);
  else if (i.withinTolerancePct >= 60) tips.push(`Intonația e bună (${Math.round(i.withinTolerancePct)}% din note în ±${IN_TUNE_CENTS} cenți); mai poți lucra la câteva note.`);
  else tips.push(`Doar ${Math.round(i.withinTolerancePct)}% din note sunt în ±${IN_TUNE_CENTS} cenți. Cântă încet, cu vocea lângă un pian, apoi reia.`);
  for (const t of i.flat.slice(0, 2)) tips.push(`Ții nota ${note(t.pc)} puțin jos, ~${Math.round(t.meanCents)} cenți. Gândește-o mai sus și mai „luminoasă”.`);
  for (const t of i.sharp.slice(0, 2)) tips.push(`Nota ${note(t.pc)} iese puțin sus, ~+${Math.round(t.meanCents)} cenți. Relaxează gâtul și coboar-o ușor.`);
  if (Math.abs(i.globalCents) >= 20) tips.push(`Vocea ta stă în medie cu ${Math.abs(Math.round(i.globalCents))} cenți ${i.globalCents > 0 ? 'peste' : 'sub'} acordajul standard (La = 440 Hz). Instrumentele se acordează automat după tine.`);
  const t = r.timing;
  if (t.notes >= 5) {
    if (t.meanAbsMs <= 30) tips.push(`Ritmul e precis: intri pe timp cu ~${Math.round(t.meanAbsMs)} ms abatere medie.`);
    else tips.push(`Abaterea medie de ritm e ~${Math.round(t.meanAbsMs)} ms. Cântă cu metronomul în căști și bate ușor tactul.`);
    if (Math.abs(t.biasMs) >= 25) tips.push(`În general intri ${t.biasMs > 0 ? 'ușor în urma' : 'ușor înaintea'} timpului (~${Math.abs(Math.round(t.biasMs))} ms).`);
  }
  const s = r.stability;
  if (s.vibratoHz) tips.push(`Ai vibrato de ~${s.vibratoHz.toFixed(1)} Hz${s.vibratoCents && s.vibratoCents > 60 ? ', cam larg (±' + Math.round(s.vibratoCents) + ' cenți); încearcă să-l strângi la notele lungi' : ', plăcut și controlat'}.`);
  if (Math.abs(s.driftCentsPerSec) >= 8) tips.push(`Notele lungi ${s.driftCentsPerSec < 0 ? 'alunecă în jos' : 'urcă'} (~${Math.abs(Math.round(s.driftCentsPerSec))} cenți pe secundă). Sprijină aerul până la capătul notei.`);
  if (r.breath.longestSec >= 3) tips.push(`Cea mai lungă pauză are ${r.breath.longestSec.toFixed(1)} s; acolo vor cânta răspunsurile instrumentelor.`);
  if (r.dynamics.rangeDb >= 18) tips.push('Dinamica ta e largă; la final poți lăsa compresorul să o echilibreze.');
  else if (r.dynamics.rangeDb > 0 && r.dynamics.rangeDb < 8) tips.push('Dinamica e foarte uniformă; poți cânta mai încet în strofe și mai plin în refren.');
  return tips;
}

export interface KeyAdvice {
  /** semitones to transpose the backing track (-6..+6) */
  semitones: number;
  newKey: KeySig | null;
  /** tessitura after transposition */
  tessitura: { lo: number; hi: number } | null;
  reason: string;
  /** true when the current key already suits the voice */
  fine: boolean;
}

/** Transposition (±6) that puts the tessitura in the comfortable zone of the voice type and keeps every note inside its practical range. */
export function recommendKey(r: VoiceReport, key: KeySig | null): KeyAdvice {
  if (!r.tessitura || !r.range || !r.voiceType) return { semitones: 0, newKey: key, tessitura: null, reason: 'Nu am destule note ca să recomand o tonalitate.', fine: true };
  const zone = VOICE_ZONE[r.voiceType];
  let best = 0, bestCost = Infinity;
  for (let t = -6; t <= 6; t++) {
    const centre = r.tessitura.centre + t;
    const hi = r.range.hi + t, lo = r.range.lo + t;
    let cost = Math.abs(centre - zone.centre) + Math.abs(t) * 0.05;
    if (hi > zone.ceiling - 1) cost += 6 + (hi - zone.ceiling);
    if (lo < zone.floor) cost += 6 + (zone.floor - lo);
    if (cost < bestCost) { bestCost = cost; best = t; }
  }
  const newKey = key ? { tonic: pcOf(key.tonic + best), mode: key.mode } : null;
  const tess = { lo: r.tessitura.lo + best, hi: r.tessitura.hi + best };
  const keyTxt = newKey ? ` (${note(newKey.tonic)} ${newKey.mode === 'major' ? 'major' : 'minor'})` : '';
  const reason = best === 0
    ? `Tonalitatea de acum se potrivește vocii tale de ${VOICE_LABEL[r.voiceType]}: zona în care cânți cel mai mult stă confortabil.`
    : `Pentru o voce de ${VOICE_LABEL[r.voiceType]}, minusul stă mai comod ${best > 0 ? 'cu ' + best + ' semitonuri mai sus' : 'cu ' + Math.abs(best) + ' semitonuri mai jos'}${keyTxt}: zona în care cânți cel mai mult cade în mijlocul vocii tale, iar nota cea mai înaltă rămâne cu cel puțin un semiton sub limita confortabilă.`;
  return { semitones: best, newKey, tessitura: tess, reason, fine: best === 0 };
}

/** Merge several takes' notes into one report input (whole-song report). */
export function mergeReports(inputs: ReportInput[]): ReportInput {
  const notes: Note[] = [];
  let off = 0;
  for (const i of inputs) { for (const n of i.notes) notes.push({ ...n, startSec: n.startSec + off }); const grid = 30 / (inputs[0]?.bpm ?? 90); off = Math.ceil((off + i.notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 0) + 1) / grid) * grid; }
  return { notes, analysis: inputs[0]?.analysis ?? null, bpm: inputs[0]?.bpm ?? 90 };
}
