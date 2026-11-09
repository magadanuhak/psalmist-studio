/** Piano sustain-pedal logic: re-pedal on chord changes (legato pedalling), release at rests/ends. Pure functions. */
import type { NoteEv } from './humanize';

export interface PedalEvent { time: number; down: boolean }
export interface ChordChange { time: number; /** optional chord name; identical consecutive chords do not re-pedal */ chord?: string }

export interface PedalOptions {
  /** lift happens this long AFTER the new chord is struck (so the old chord is cleared, the new one is held) */
  liftDelay?: number;
  /** press again this long after the lift */
  repress?: number;
  /** re-pedal in the middle of a chord that lasts longer than this many seconds (0 = never) */
  maxHoldSec?: number;
  /** no pedal at all for chords shorter than this (very fast harmonic rhythm keeps one pedal) */
  minChordSec?: number;
}

/**
 * Build pedal events for a progression. First chord: press just before the downbeat.
 * Each chord change: lift at (change + liftDelay), press again at (+ repress).
 * The pedal is released at endTime. Events are sorted and strictly alternate down/up.
 */
export function pedalEvents(changes: readonly ChordChange[], endTime: number, o: PedalOptions = {}): PedalEvent[] {
  const liftDelay = o.liftDelay ?? 0.025, repress = o.repress ?? 0.06, maxHold = o.maxHoldSec ?? 4.5, minChord = o.minChordSec ?? 0;
  const cs = [...changes].sort((a, b) => a.time - b.time);
  if (!cs.length) return [];
  const ev: PedalEvent[] = [{ time: Math.max(0, cs[0].time - 0.01), down: true }];
  const push = (t: number) => { // lift + press
    const last = ev[ev.length - 1];
    if (t - last.time < liftDelay + repress) return; // too close to the previous press, keep holding
    ev.push({ time: t + liftDelay, down: false }, { time: t + liftDelay + repress, down: true });
  };
  let lastPress = ev[0].time;
  for (let i = 1; i < cs.length; i++) {
    const prev = cs[i - 1], c = cs[i];
    if (c.chord && prev.chord && c.chord === prev.chord) {
      // same chord: only re-pedal when the hold would get muddy
      if (maxHold > 0 && c.time - lastPress > maxHold) { push(c.time); lastPress = c.time; }
      continue;
    }
    const next = cs[i + 1]?.time ?? endTime;
    if (next - c.time < minChord) continue;
    push(c.time); lastPress = c.time;
  }
  // mid-chord re-pedal for very long chords
  if (maxHold > 0) {
    const out: PedalEvent[] = [];
    for (let i = 0; i < ev.length; i++) {
      out.push(ev[i]);
      if (ev[i].down) {
        const until = ev[i + 1]?.time ?? endTime;
        for (let t = ev[i].time + maxHold; t < until - 0.5; t += maxHold) out.push({ time: t, down: false }, { time: t + repress, down: true });
      }
    }
    ev.length = 0; ev.push(...out);
  }
  const last = ev[ev.length - 1];
  if (last.down) ev.push({ time: Math.max(endTime, last.time + 0.05), down: false });
  return ev;
}

/** Is the pedal down at time t? */
export function pedalDownAt(events: readonly PedalEvent[], t: number): boolean {
  let down = false;
  for (const e of events) { if (e.time <= t) down = e.down; else break; }
  return down;
}

/**
 * Extend note durations as a sustain pedal would: a note whose release falls while the pedal is down rings
 * until the next lift (capped by maxRing seconds). Returns new notes.
 */
export function applyPedal(notes: readonly NoteEv[], events: readonly PedalEvent[], maxRing = 6): NoteEv[] {
  const lifts = events.filter((e) => !e.down).map((e) => e.time);
  return notes.map((n) => {
    const off = n.time + n.dur;
    if (!pedalDownAt(events, off)) return { ...n };
    const lift = lifts.find((t) => t > off);
    if (lift == null) return { ...n };
    return { ...n, dur: Math.min(lift - n.time, n.dur + maxRing) };
  });
}

/** Convert pedal events to MIDI CC64 values (127 down / 0 up) for the SoundFont engine. */
export function pedalToCC64(events: readonly PedalEvent[]): { time: number; value: number }[] {
  return events.map((e) => ({ time: e.time, value: e.down ? 127 : 0 }));
}
