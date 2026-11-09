import type { Genre, KeySig, Note, TimeSig } from '../../model/types';
import { GENRE_BIAS } from './bias';
import { scalePcs } from '../../music/theory';
import { BASS_HI, BASS_LO, voiceSection, type VoicedSlot } from './voicing';
import type { Chord, HarmonySlot, SectionHarmony, VariantId } from './types';

export interface NoteEv { midi: number; startSec: number; durSec: number; vel: number }

export interface HarmonyRender {
  slots: { slot: HarmonySlot; chord: Chord; voiced: VoicedSlot }[];
  chordEvents: NoteEv[];
  bassEvents: NoteEv[];
}

const pcOf = (m: number) => ((m % 12) + 12) % 12;

function strikeBeats(sig: TimeSig): number[] {
  const out: number[] = [];
  let p = 0;
  for (const g of sig.grouping) { out.push(p); p += g; }
  if (sig.num === 4 && sig.den === 4) out.push(2);
  if (sig.num === 3 && sig.den === 4) return [0, 1, 2];
  return out.sort((a, b) => a - b);
}

/** beat offsets (within the section) -> strike pattern restricted to a slot */
function slotBeatOffsets(slot: HarmonySlot, sig: TimeSig, pattern: number[]): number[] {
  const out: number[] = [];
  for (let b = 0; b < slot.beats - 1e-6; b++) {
    const abs = slot.startBeat + b;
    const inBar = abs - Math.floor(abs / sig.num + 1e-6) * sig.num;
    if (pattern.includes(inBar)) out.push(b);
  }
  if (!out.includes(0)) out.unshift(0);
  return out;
}

export type CompStyle = 'simple' | 'full';

/** Notes never ring across a chord change and never overlap their own repeats. */
function clampToSlot(ev: NoteEv[], slot: HarmonySlot): NoteEv[] {
  const end = slot.startSec + slot.durSec - 0.03;
  return ev.map((e) => ({ ...e, durSec: Math.max(0.05, Math.min(e.durSec, end - e.startSec)) })).filter((e) => e.startSec < end);
}

function chordLayer(genre: Genre, slot: HarmonySlot, voicing: number[], sig: TimeSig, style: CompStyle): NoteEv[] {
  const g = GENRE_BIAS[genre];
  const beat = slot.durSec / slot.beats;
  const ev: NoteEv[] = [];
  const at = (b: number) => slot.startSec + b * beat;
  if (style === 'simple') {
    // sustained, legato, soft: one voicing per chord, released just before the next change
    for (const m of voicing) ev.push({ midi: m, startSec: slot.startSec, durSec: slot.durSec * 0.94, vel: 0.45 });
    return clampToSlot(ev, slot);
  }
  switch (g.comp) {
    case 'block':
      for (const m of voicing) ev.push({ midi: m, startSec: slot.startSec, durSec: slot.durSec * 0.97, vel: 0.5 });
      break;
    case 'arp8': {
      const up = [...voicing];
      const seq = up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
      let k = 0;
      for (let b = 0; b < slot.beats - 1e-6; b += 0.5) {
        const m = seq[k % seq.length];
        ev.push({ midi: m, startSec: at(b), durSec: beat * 0.5 * 1.1, vel: b === 0 ? 0.45 : 0.32 });
        k++;
      }
      break;
    }
    case 'pulse8':
      for (let b = 0; b < slot.beats - 1e-6; b += 0.5) {
        for (const m of voicing.slice(-3)) ev.push({ midi: m, startSec: at(b), durSec: beat * 0.42, vel: b % 1 === 0 ? 0.42 : 0.3 });
      }
      break;
    case 'oompah': {
      const offs = slotBeatOffsets(slot, sig, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
      offs.forEach((b, i) => {
        if (i % 2 === 0) ev.push({ midi: voicing[0], startSec: at(b), durSec: beat * 0.9, vel: 0.5 });
        else for (const m of voicing.slice(1)) ev.push({ midi: m, startSec: at(b), durSec: beat * 0.8, vel: 0.38 });
      });
      break;
    }
    default: { // 'beats'
      const offs = slotBeatOffsets(slot, sig, strikeBeats(sig));
      offs.forEach((b, i) => {
        const next = i + 1 < offs.length ? offs[i + 1] : slot.beats;
        for (const m of voicing) ev.push({ midi: m, startSec: at(b), durSec: (next - b) * beat * 0.96, vel: b === 0 ? 0.5 : 0.4 });
      });
    }
  }
  return clampToSlot(ev, slot);
}

function fifthOf(bass: number): number {
  let f = bass + 7;
  if (f > BASS_HI) f -= 12;
  return Math.max(BASS_LO, f);
}

function approachNote(target: number, from: number, key: KeySig): number {
  const pcs = scalePcs(key);
  const tries = [target - 2, target - 1, target + 1, target + 2];
  const ok = tries.filter((m) => m !== from && m >= BASS_LO && m <= BASS_HI);
  const diatonic = ok.filter((m) => pcs.has(pcOf(m)));
  const below = diatonic.filter((m) => m < target);
  return (below[below.length - 1] ?? diatonic[0] ?? ok.find((m) => m === target - 1) ?? ok[0] ?? from);
}

function bassLine(genre: Genre, slots: HarmonySlot[], voiced: VoicedSlot[], sig: TimeSig, key: KeySig): NoteEv[] {
  const g = GENRE_BIAS[genre];
  const ev: NoteEv[] = [];
  slots.forEach((slot, i) => {
    const beat = slot.durSec / slot.beats;
    const root = voiced[i].bass;
    const fifth = fifthOf(root);
    const local: { off: number; dur: number; midi: number }[] = [];
    if (g.bass === 'whole') {
      if (slot.beats >= 4) for (let b = 0; b < slot.beats; b += 2) local.push({ off: b, dur: Math.min(2, slot.beats - b), midi: root });
      else local.push({ off: 0, dur: slot.beats, midi: root });
    } else if (g.bass === 'pulse8') {
      for (let b = 0; b < slot.beats - 1e-6; b += 0.5) local.push({ off: b, dur: 0.5, midi: b === 0 ? root : root });
    } else {
      const pattern = g.bass === 'folk' ? slotBeatOffsets(slot, sig, [0, 1, 2, 3, 4, 5, 6, 7, 8]) : slotBeatOffsets(slot, sig, strikeBeats(sig));
      const gs: number[] = [];
      { let q = 0; for (const gl of sig.grouping) { gs.push(q); q += gl; } }
      const inBarOf = (b: number) => { const abs = slot.startBeat + b; return abs - Math.floor(abs / sig.num + 1e-6) * sig.num; };
      pattern.forEach((b, k) => {
        const next = k + 1 < pattern.length ? pattern[k + 1] : slot.beats;
        const isRoot = g.bass === 'folk' ? gs.includes(inBarOf(b)) || b === 0 : k % 2 === 0;
        local.push({ off: b, dur: next - b, midi: isRoot ? root : fifth });
      });
    }
    // approach note on the last beat before a change (not in hymns)
    const next = voiced[i + 1];
    if (genre !== 'imn' && next && next.bass !== root && slot.beats >= 2) {
      const lastBeat = slot.beats - 1;
      const ap = approachNote(next.bass, root, key);
      for (let k = local.length - 1; k >= 0; k--) {
        const l = local[k];
        if (l.off >= lastBeat - 1e-6) local.splice(k, 1);
        else if (l.off + l.dur > lastBeat + 1e-6) l.dur = lastBeat - l.off;
      }
      local.push({ off: lastBeat, dur: 1, midi: ap });
    }
    for (const l of local) {
      ev.push({ midi: Math.max(BASS_LO, Math.min(BASS_HI, l.midi)), startSec: slot.startSec + l.off * beat, durSec: Math.max(0.06, l.dur * beat * 0.92), vel: l.off === 0 ? 0.8 : 0.62 });
    }
  });
  return ev;
}

export function renderHarmony(a: {
  harmony: SectionHarmony; variant: VariantId; notes: Note[]; key: KeySig; genre: Genre; sig: TimeSig; style?: CompStyle;
}): HarmonyRender {
  const chords = a.harmony.variants[a.variant];
  const slots = a.harmony.slots;
  if (!chords?.length) return { slots: [], chordEvents: [], bassEvents: [] };
  const voiced = voiceSection({ chords, slots, notes: a.notes, key: a.key, genre: a.genre });
  const chordEvents = slots.flatMap((s, i) => chordLayer(a.genre, s, voiced[i].voicing, a.sig, a.style ?? 'simple'));
  const bassEvents = bassLine(a.genre, slots, voiced, a.sig, a.key);
  return { slots: slots.map((slot, i) => ({ slot, chord: chords[i], voiced: voiced[i] })), chordEvents, bassEvents };
}
