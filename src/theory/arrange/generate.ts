/** Arrangement generator (A2-A4): song timeline + chords + register policy -> instrument tracks with notes in song time.
 *  Pure TypeScript, deterministic, no audio and no React. */
import { chordName } from '../harmony/chords';
import { voiceSection } from '../harmony/voicing';
import type { Chord } from '../harmony/types';
import {
  accentAt, arpPositions, bassPositions, drumBar, fillBar, groupStarts, isCompound, COMPOUND_ARP, COMPOUND_ARP_SLOW, isEighthMeter, oompahPositions, pulsePositions,
  strumPositions,
} from './patterns';
import { veselPreset, ACC_VEL_MAX, DR, DRUM_HI, DRUM_LO, EMOTION_ARR, GENRE_PRESETS, ACOUSTIC_PRESETS } from './presets';
import { clampE, defaultEnergies, planSectionChords, toPlanned } from './form';
import type {
  ArrangeInput, ArrNote, Arrangement, ArrTrack, ArrVocalNote, BassStyle, Energy, Marker, PlanSection, Style, TrackDef, Transition,
} from './types';
import { BASS_LO, bassRoots, chooseRegister, voiceSlots, type Register } from './voicing';

const pcOf = (m: number) => ((m % 12) + 12) % 12;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 11];
const ELECTRIC_GM = [27, 29, 30];

interface Slot {
  startBeat: number; beats: number; chord: Chord;
  /** highest pitch allowed for comping in this slot (below mode) */
  top: number;
  v3: number[]; v4: number[];
  bass: number;
}

const velOf = (base: number, e: number, emo: number, accent = 1) =>
  Math.max(0.12, Math.min(ACC_VEL_MAX, base * (0.62 + 0.08 * e) * emo * (0.82 + 0.18 * accent)));

function fitRange(m: number, lo: number, hi: number, zlo: number, zhi: number): number | null {
  for (const d of [0, 12, -12, 24, -24]) {
    const x = m + d;
    if (x >= lo && x <= hi && x >= zlo && x <= zhi) return x;
  }
  return null;
}

export function generateArrangement(inp: ArrangeInput): Arrangement {
  const { sig, bpm, key, genre } = inp;
  const beat = 60 / bpm;
  const num = sig.num;
  const barSec = beat * num;
  const preset = (inp.palette === 'vesel' && veselPreset(genre)) || (inp.palette === 'acustic' && ACOUSTIC_PRESETS[genre]) || GENRE_PRESETS[genre];
  const emo = EMOTION_ARR[inp.emotion];

  // ---------------------------------------------------------------- timeline & energy
  const defaults = defaultEnergies(inp.sections.map((s) => s.type));
  const form = planSectionChords(inp.sections, key, genre, sig);
  const allNotes: ArrVocalNote[] = inp.sections.flatMap((s) => s.notes);
  const reg: Register = chooseRegister(allNotes);

  let t0 = 0, bar0 = 0;
  const plan: PlanSection[] = inp.sections.map((s, i) => {
    const user = inp.energy?.[s.id];
    const d = defaults[i];
    const sec: PlanSection = {
      id: s.id, type: s.type, label: s.label, bars: s.bars, startSec: t0, durSec: s.bars * barSec, startBar: bar0,
      energy: user ? clampE(user) : d.energy, rampTo: user ? undefined : d.rampTo,
      chordSource: form[i].chordSource, chords: toPlanned(form[i].slots, bpm), active: [],
    };
    t0 += sec.durSec; bar0 += s.bars;
    return sec;
  });

  // ---------------------------------------------------------------- tracks
  const defs: TrackDef[] = preset.tracks.filter((d) => {
    if (emo.only && !emo.only.includes(d.tone)) return false;
    if (emo.noDrums && d.role === 'drums') return false;
    if (emo.noElectric && ELECTRIC_GM.includes(d.gm) && d.role !== 'drums') return false;
    return true;
  });
  let ch = 0;
  const tracks: ArrTrack[] = defs.map((d) => {
    const drums = d.role === 'drums';
    let channel = 9;
    if (!drums) { if (ch === 9) ch++; channel = ch++; }
    return { id: d.id, name: d.name, gm: d.gm, channel, drums, sampler: d.sampler, inst: d.inst, level: d.level, pan: d.pan, reverb: drums ? 28 : emo.reverb, notes: [] };
  });
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const push = (id: string, n: ArrNote) => byId.get(id)!.notes.push(n);

  const effEnergy = (sec: PlanSection, bar: number): Energy => {
    let e = sec.energy as number;
    if (sec.rampTo && sec.bars > 1) e = sec.energy + (sec.rampTo - sec.energy) * (bar / (sec.bars - 1));
    else if (sec.rampTo) e = sec.energy;
    return clampE(e + emo.shift);
  };

  /** nominal (unshifted) energy: decides WHICH instruments play; the emotion-shifted one decides HOW they play */
  const nomEnergy = (sec: PlanSection, bar: number): Energy => {
    let e = sec.energy as number;
    if (sec.rampTo && sec.bars > 1) e = sec.energy + (sec.rampTo - sec.energy) * (bar / (sec.bars - 1));
    return clampE(e);
  };
  const firstOn = (arr: readonly string[] | undefined) => { const i = (arr ?? []).findIndex((x) => x !== 'off'); return i < 0 ? 99 : i + 1; };

  const transitions: Transition[] = [];
  const keyScale = key.mode === 'major' ? MAJOR : MINOR;
  const inScale = (m: number) => keyScale.includes(pcOf(m - key.tonic));

  // ---------------------------------------------------------------- per section
  plan.forEach((sec, si) => {
    const input = inp.sections[si];
    const planned = sec.chords;
    const bars = sec.bars;
    const slots: Slot[] = [];
    if (planned.length) {
      const chords = planned.map((c) => c.chord);
      const tops = planned.map((c) => {
        const a = c.startSec - 1e-4, b = c.startSec + c.durSec + 1e-4;
        const under = input.notes.filter((n) => n.startSec < b && n.startSec + n.durSec > a).map((n) => n.midi);
        return under.length ? Math.min(...under) - 1 : reg.hi;
      });
      let v3 = voiceSlots(chords, tops, chords.map(() => 3), reg);
      let v4 = voiceSlots(chords, tops, chords.map(() => 4), reg);
      let bass = bassRoots(chords, reg);
      if (genre === 'imn' && reg.mode === 'below') {
        // hymns: M3 four-part (SATB) writing, soprano doubles the vocal melody
        try {
          const slotsH = planned.map((c, i) => ({ idx: i, bar: Math.floor(c.startBeat / num), startBeat: c.startBeat, beats: c.beats, startSec: c.startSec, durSec: c.durSec, phraseEnd: c.phraseEnd }));
          const notesH = input.notes.map((n, i) => ({ id: `v${i}`, midi: n.midi, startSec: n.startSec, durSec: n.durSec, velocity: 0.7, centsDev: 0, confidence: 1 }));
          const sat = voiceSection({ chords, slots: slotsH, notes: notesH, key, genre });
          if (sat.length === chords.length && sat.every((x) => x.voicing.length)) { v3 = sat.map((x) => x.voicing); v4 = v3; bass = sat.map((x) => x.bass); }
        } catch { /* keep the arrange voicing */ }
      }
      planned.forEach((c, i) => slots.push({ startBeat: c.startBeat, beats: c.beats, chord: c.chord, top: tops[i], v3: v3[i], v4: v4[i], bass: bass[i] }));
    }
    const barOf = (s: Slot) => Math.min(bars - 1, Math.floor(s.startBeat / num + 1e-6));
    const slotEnergy = (s: Slot) => effEnergy(sec, barOf(s));
    const abs = (beatPos: number) => sec.startSec + beatPos * beat;

    // ----- harmonic tracks
    for (const d of defs.filter((x) => x.role === 'harm')) {
      slots.forEach((s) => {
        const minE = firstOn(d.styles);
        if (nomEnergy(sec, barOf(s)) < minE) return;
        const e = slotEnergy(s);
        const style = d.styles[Math.max(e, minE) - 1];
        if (style === 'off') return;
        const nVoices = genre === 'imn' || e >= 4 ? 4 : 3;
        let voicing = nVoices === 4 ? s.v4 : s.v3;
        if (d.voices && d.voices > 0) voicing = voicing.slice(-d.voices);
        const zlo = reg.mode === 'above' ? reg.lo : 36;
        const zhi = reg.mode === 'above' ? 127 : Math.min(reg.hi, s.top);
        const place = (list: number[]): number[] => {
          const out: number[] = [];
          for (const m of list) {
            let x: number | null = null;
            if (d.shift) x = fitRange(m + d.shift, d.lo, d.hi, zlo, zhi);
            if (x === null) x = fitRange(m, d.lo, d.hi, zlo, zhi);
            if (x !== null) out.push(x);
          }
          return [...new Set(out)].sort((a, b) => a - b);
        };
        // full energy: octave doubling of the lowest voice
        const wide = e >= 5 ? [...voicing, voicing[0] - 12, voicing[0] + 12] : voicing;
        emitHarm(d, style, s, place(wide), e);
      });
    }

    function emitHarm(d: TrackDef, style: Style, s: Slot, notes: number[], e: number) {
      if (!notes.length) return;
      const slotEnd = s.startBeat + s.beats;
      const hits = (pos: number[]): number[] => {
        const out: number[] = [];
        const b0 = Math.floor(s.startBeat / num + 1e-6);
        for (let b = b0; b * num < slotEnd - 1e-6; b++) for (const p of pos) {
          const a = b * num + p;
          if (a >= s.startBeat - 1e-6 && a < slotEnd - 1e-6) out.push(a);
        }
        if (!out.length || out[0] > s.startBeat + 1e-6) out.unshift(s.startBeat);
        return out;
      };
      const barPos = (a: number) => a - Math.floor(a / num + 1e-6) * num;
      const vel = (base: number, a: number) => velOf(base, e, emo.vel, accentAt(sig, barPos(a)));
      const add = (m: number, a: number, durBeats: number, v: number, stagger = 0) => {
        const st = abs(a) + stagger;
        const end = Math.min(abs(slotEnd), st + Math.max(0.05, durBeats * beat));
        if (end - st < 0.03) return;
        push(d.id, { midi: m, startSec: st, durSec: end - st, vel: v });
      };
      switch (style) {
        case 'sustain':
          for (const m of notes) add(m, s.startBeat, s.beats * 0.985, velOf(0.52, e, emo.vel));
          break;
        case 'swell':
          for (const m of notes.slice(-2)) add(m, s.startBeat, s.beats * 0.985, velOf(0.46, e, emo.vel));
          break;
        case 'holdTop':
          add(notes[notes.length - 1], s.startBeat, s.beats * 0.985, velOf(0.5, e, emo.vel));
          break;
        case 'beats': {
          const pos = isEighthMeter(sig) ? groupStarts(sig) : num === 4 ? [0, 2] : num === 3 ? [0, 1, 2] : [0, 1];
          const hs = hits(pos);
          hs.forEach((a, i) => { const nx = i + 1 < hs.length ? hs[i + 1] : slotEnd; for (const m of notes) add(m, a, (nx - a) * 0.96, vel(0.5, a)); });
          break;
        }
        case 'strum': {
          const hs = hits(strumPositions(sig));
          hs.forEach((a, i) => { const nx = i + 1 < hs.length ? hs[i + 1] : slotEnd; notes.forEach((m, k) => add(m, a, (nx - a) * 0.97, vel(0.5, a), k * 0.013)); });
          break;
        }
        case 'arp4':
        case 'arp8': {
          if (isCompound(sig)) {
            // compound ballad arpeggio: 1-5-8-10-8-5 over every six eighths (one note per beat group at low energy)
            const fine = style === 'arp8';
            const pat = fine ? COMPOUND_ARP : COMPOUND_ARP_SLOW;
            const pos = fine ? Array.from({ length: num }, (_, k) => k) : groupStarts(sig);
            const hs = hits(pos);
            hs.forEach((a, i) => {
              const k = fine ? Math.round(barPos(a)) % 6 : Math.round(barPos(a) / 3) % 4;
              const idx = pat[k % pat.length];
              add(notes[Math.min(idx, notes.length - 1)], a, fine ? 4.5 : 5, vel(Math.round(barPos(a)) % 3 === 0 ? 0.55 : 0.4, a));
              if (a === s.startBeat && notes.length > 1 && e >= 3) add(notes[0], a, s.beats * 0.9, vel(0.36, a));
              void i;
            });
            break;
          }
          const hs = hits(arpPositions(sig, style === 'arp8'));
          const seq = notes.length > 2 ? [...notes, ...notes.slice(1, -1).reverse()] : notes;
          hs.forEach((a, i) => {
            const nx = i + 1 < hs.length ? hs[i + 1] : slotEnd;
            add(seq[i % seq.length], a, Math.max(nx - a, 1) * 1.5, vel(a === s.startBeat ? 0.55 : 0.42, a));
            if (a === s.startBeat && notes.length > 1 && e >= 3) add(notes[0], a, s.beats * 0.9, vel(0.38, a));
          });
          break;
        }
        case 'oompah': {
          const op = oompahPositions(sig);
          const hs = hits(op.map((x) => x.pos));
          hs.forEach((a, i) => {
            const nx = i + 1 < hs.length ? hs[i + 1] : slotEnd;
            const low = op.find((x) => Math.abs(x.pos - barPos(a)) < 1e-6)?.low ?? a === s.startBeat;
            if (low) add(notes[0], a, (nx - a) * 0.9, vel(0.55, a));
            else for (const m of notes.slice(1).length ? notes.slice(1) : notes) add(m, a, (nx - a) * 0.8, vel(0.42, a));
          });
          break;
        }
        case 'pulse8': {
          const rootPc = s.chord.root;
          let r = -1;
          for (let m = Math.max(d.lo, zloOf(s)); m <= Math.min(d.hi, zhiOf(s)); m++) if (pcOf(m) === rootPc) { r = m; break; }
          if (r < 0) { for (const m of notes) add(m, s.startBeat, s.beats * 0.97, velOf(0.45, e, emo.vel)); break; }
          const power = [r, r + 7, r + 12].filter((m, k) => k < 2 || (e >= 3 && m <= Math.min(d.hi, zhiOf(s))));
          const ps = pulsePositions(sig);
          const hs = hits(ps);
          const step = isEighthMeter(sig) ? 1 : 0.5;
          hs.forEach((a) => { for (const m of power) if (m <= zhiOf(s)) add(m, a, step * 0.5, vel(0.5, a)); });
          break;
        }
        default: break;
      }
    }
    function zloOf(_s: Slot) { return reg.mode === 'above' ? reg.lo : 36; }
    function zhiOf(s: Slot) { return reg.mode === 'above' ? 127 : Math.min(reg.hi, s.top); }

    // ----- bass
    for (const d of defs.filter((x) => x.role === 'bass')) {
      slots.forEach((s, i) => {
        const minE = firstOn(d.bassStyles);
        if (nomEnergy(sec, barOf(s)) < minE) return;
        const e = slotEnergy(s);
        const style: BassStyle = d.bassStyles?.[Math.max(e, minE) - 1] ?? 'off';
        if (style === 'off') return;
        const next = slots[i + 1];
        const slotEnd = s.startBeat + s.beats;
        const root = Math.max(BASS_LO, Math.min(reg.bassHi, s.bass));
        const fifth = root + 7 <= reg.bassHi ? root + 7 : root - 5 >= BASS_LO ? root - 5 : root;
        const hits: { a: number; fifth: boolean; step: number }[] = [];
        const b0 = Math.floor(s.startBeat / num + 1e-6);
        const collect = (pos: { pos: number; fifth: boolean }[]) => {
          for (let b = b0; b * num < slotEnd - 1e-6; b++) for (const p of pos) {
            const a = b * num + p.pos;
            if (a >= s.startBeat - 1e-6 && a < slotEnd - 1e-6) hits.push({ a, fifth: p.fifth, step: 0 });
          }
          if (!hits.length || hits[0].a > s.startBeat + 1e-6) hits.unshift({ a: s.startBeat, fifth: false, step: 0 });
        };
        if (style === 'whole') hits.push({ a: s.startBeat, fifth: false, step: 0 });
        else if (style === 'half') {
          if (num === 4 && s.beats >= 4) for (let a = s.startBeat; a < slotEnd - 1e-6; a += 2) hits.push({ a, fifth: false, step: 0 });
          else if (num === 3 && s.beats >= 3) { hits.push({ a: s.startBeat, fifth: false, step: 0 }); hits.push({ a: s.startBeat + 2, fifth: false, step: 0 }); }
          else hits.push({ a: s.startBeat, fifth: false, step: 0 });
        } else if (style === 'pulse8') collect(pulsePositions(sig).map((p) => ({ pos: p, fifth: false })));
        else collect(bassPositions(sig, style));
        hits.sort((x, y) => x.a - y.a);
        hits.forEach((h, k) => {
          const nx = k + 1 < hits.length ? hits[k + 1].a : slotEnd;
          let midi = h.fifth ? fifth : root;
          const last = k === hits.length - 1;
          if (preset.bassApproach && last && next && next.bass !== s.bass && s.beats >= 2 && style !== 'whole' && style !== 'half' && nx - h.a <= 1.01) {
            const tgt = Math.max(BASS_LO, Math.min(reg.bassHi, next.bass));
            const opts = [tgt - 1, tgt - 2, tgt + 1, tgt + 2].filter((m) => m >= BASS_LO && m <= reg.bassHi && m !== midi);
            const dia = opts.filter(inScale);
            midi = (dia[0] ?? opts[0] ?? midi);
          }
          const accent = accentAt(sig, h.a - Math.floor(h.a / num + 1e-6) * num);
          const dur = style === 'whole' || style === 'half' ? (nx - h.a) * 0.97 : (nx - h.a) * 0.9;
          const st = abs(h.a);
          const end = Math.min(abs(slotEnd), st + Math.max(0.06, dur * beat));
          if (end - st < 0.03) return;
          push(d.id, { midi, startSec: st, durSec: end - st, vel: velOf(0.7, e, emo.vel, accent) });
          if (e >= 5 && midi + 12 <= reg.bassHi && (style === 'whole' || style === 'half')) push(d.id, { midi: midi + 12, startSec: st, durSec: end - st, vel: velOf(0.5, e, emo.vel, accent) });
        });
      });
    }

    // ----- drums
    for (const d of defs.filter((x) => x.role === 'drums')) {
      for (let b = 0; b < bars; b++) {
        const minE = firstOn(d.drumStyles);
        if (nomEnergy(sec, b) < minE) continue;
        const e = effEnergy(sec, b);
        const style = d.drumStyles?.[Math.max(e, minE) - 1] ?? 'off';
        if (style === 'off') continue;
        const bs = sec.startSec + b * barSec;
        for (const h of drumBar(sig, style, e)) {
          const note = Math.max(DRUM_LO, Math.min(DRUM_HI, h.note));
          push(d.id, { midi: note, startSec: bs + h.pos * beat, durSec: Math.min(0.2, beat * 0.5), vel: Math.min(0.95, Math.max(0.12, h.vel * emo.vel * (0.74 + 0.07 * e))) });
        }
      }
    }
  });

  // ---------------------------------------------------------------- transitions
  const drumTracks = defs.filter((x) => x.role === 'drums');
  const finalRefren = (() => { for (let i = plan.length - 1; i >= 0; i--) if (plan[i].type === 'refren') return i; return -1; })();
  const removeBar = (ids: string[], from: number, to: number, cut = true) => {
    for (const id of ids) {
      const tr = byId.get(id)!;
      tr.notes = tr.notes.filter((n) => !(n.startSec >= from - 1e-6 && n.startSec < to - 1e-6));
      if (cut) for (const n of tr.notes) if (n.startSec < from && n.startSec + n.durSec > from) n.durSec = from - n.startSec;
    }
  };
  plan.forEach((sec, si) => {
    const next = plan[si + 1];
    const lastBarStart = sec.startSec + (sec.bars - 1) * barSec;
    // pad swell into a bridge
    if (next && next.type === 'bridge' && sec.chords.length && sec.bars >= 1) {
      const padDef = defs.find((x) => x.tone === 'pad') ?? defs.find((x) => x.id === 'corzi');
      if (padDef) {
        const slot = [...sec.chords].reverse().find((c) => c.startSec <= lastBarStart + 1e-3) ?? sec.chords[sec.chords.length - 1];
        const nextChord = next.chords[0]?.chord ?? slot.chord;
        const vs = voiceSlots([nextChord], [reg.hi], [3], reg)[0];
        const e = effEnergy(sec, sec.bars - 1);
        removeBar([padDef.id], lastBarStart, lastBarStart + barSec, true);
        const zlo = reg.mode === 'above' ? reg.lo : 36;
        for (const m of vs) {
          const x = fitRange(m, padDef.lo, padDef.hi, zlo, reg.mode === 'above' ? 127 : reg.hi);
          if (x !== null) push(padDef.id, { midi: x, startSec: lastBarStart, durSec: barSec * 0.99, vel: Math.min(ACC_VEL_MAX, velOf(0.7, Math.max(e, 3), emo.vel)) });
        }
        transitions.push({ kind: 'swell', sectionId: sec.id, timeSec: lastBarStart });
      }
    }
    // drum fill before a refren
    if (next && next.type === 'refren') {
      for (const d of drumTracks) {
        const tr = byId.get(d.id)!;
        if (nomEnergy(sec, sec.bars - 1) < firstOn(d.drumStyles)) continue;
        removeBar([d.id], lastBarStart, lastBarStart + barSec, false);
        for (const h of fillBar(sig)) tr.notes.push({ midi: h.note, startSec: lastBarStart + h.pos * beat, durSec: Math.min(0.2, beat * 0.5), vel: Math.min(0.95, h.vel * emo.vel) });
        transitions.push({ kind: 'fill', sectionId: sec.id, timeSec: lastBarStart });
      }
    }
    // crash on a refren downbeat
    if (sec.type === 'refren' && (si === 0 || plan[si - 1].type !== 'refren')) {
      for (const d of drumTracks) {
        const tr = byId.get(d.id)!;
        if (nomEnergy(sec, 0) < firstOn(d.drumStyles) || d.id === 'perc') continue;
        tr.notes.push({ midi: DR.crash, startSec: sec.startSec, durSec: 1.2, vel: Math.min(0.95, 0.9 * emo.vel) });
        transitions.push({ kind: 'crash', sectionId: sec.id, timeSec: sec.startSec });
      }
    }
    // drop: one bar of silence before the final refren
    if (inp.drop && si === finalRefren - 1 && finalRefren > 0 && sec.bars >= 2) {
      removeBar(tracks.map((x) => x.id), lastBarStart, lastBarStart + barSec, true);
      transitions.push({ kind: 'drop', sectionId: sec.id, timeSec: lastBarStart });
    }
  });

  // ---------------------------------------------------------------- ritardando + held last chord (outro)
  let ritard: Arrangement['ritard'];
  let songSec = plan.length ? plan[plan.length - 1].startSec + plan[plan.length - 1].durSec : 0;
  const lastSec = plan[plan.length - 1];
  if (lastSec && lastSec.type === 'outro' && inp.ritardando !== false && lastSec.chords.length) {
    const ritBars = Math.min(2, lastSec.bars);
    const rs = lastSec.startSec + (lastSec.bars - ritBars) * barSec;
    const N = ritBars * num;
    const k = 0.6;
    const C = (u: number) => u + (k * u * u) / (2 * N);
    const warp = (t: number) => (t <= rs ? t : rs + C((t - rs) / beat) * beat);
    const warpEnd = rs + C(N) * beat;
    const hold = beat * 2.5;
    const finalStart = lastSec.startSec + lastSec.chords[lastSec.chords.length - 1].startSec;
    for (const tr of tracks) {
      for (const n of tr.notes) {
        if (n.startSec + n.durSec <= rs + 1e-6) continue;
        const st = warp(n.startSec), en = warp(n.startSec + n.durSec);
        n.startSec = st; n.durSec = Math.max(0.05, en - st);
        if (!tr.drums && n.startSec >= warp(finalStart) - 1e-6 && n.startSec + n.durSec >= warpEnd - 0.02) n.durSec = warpEnd + hold - n.startSec;
      }
    }
    songSec = warpEnd + hold;
    lastSec.durSec = songSec - lastSec.startSec;
    ritard = { fromSec: rs, beat, n: N, k };
    transitions.push({ kind: 'ritardando', sectionId: lastSec.id, timeSec: rs });
    transitions.push({ kind: 'holdChord', sectionId: lastSec.id, timeSec: warpEnd });
  }

  // ---------------------------------------------------------------- finish
  for (const tr of tracks) {
    tr.notes = tr.notes
      .filter((n) => n.startSec < songSec - 1e-6)
      .map((n) => ({ ...n, durSec: Math.min(n.durSec, songSec - n.startSec) }))
      .sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  }
  plan.forEach((sec, i) => {
    const end = i === plan.length - 1 ? songSec : sec.startSec + sec.durSec;
    sec.active = tracks.filter((tr) => tr.notes.some((n) => n.startSec >= sec.startSec - 1e-6 && n.startSec < end - 1e-6)).map((tr) => tr.id);
  });
  const markers: Marker[] = [];
  plan.forEach((sec) => {
    markers.push({ time: sec.startSec, text: sec.label });
    for (const c of sec.chords) markers.push({ time: sec.startSec + c.startSec, text: chordName(c.chord, 'letter', key) });
  });
  return { ritard, tracks: tracks.filter((x) => x.notes.length > 0), plan, songSec, markers, transitions, register: { mode: reg.mode, lo: reg.lo, hi: reg.hi, vocalLo: reg.vocalLo, vocalHi: reg.vocalHi } };
}
