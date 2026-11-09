/** Metronome clicks for the recording assistant: sounds, accents, subdivisions. Pure scheduling (no audio) plus an offline renderer for tests and the bleed check. */
import type { TimeSig } from '../model/types';
import { barClicks, beatSec } from '../music/timesig';

export type ClickSound = 'lemn' | 'bip' | 'rim' | 'moale';
export type ClickKind = 'accent' | 'sub' | 'beat' | 'subdiv';
export interface ClickOpts { sub: 1 | 2 | 3 | 4; accents: boolean; sound: ClickSound }
export interface ClickEvent { t: number; kind: ClickKind; /** beat index from the start (0-based, counts beats not slots) */ beat: number; /** 0..sub-1 */ slot: number }

export const DEFAULT_CLICK: ClickOpts = { sub: 1, accents: true, sound: 'lemn' };
export const CLICK_SOUND_LABEL: Record<ClickSound, string> = { lemn: 'Lemn', bip: 'Bip', rim: 'Cadru', moale: 'Moale' };
/** pitch (Hz) per sound and kind; decay in seconds */
export const CLICK_SPEC: Record<ClickSound, { accent: number; beat: number; sub: number; subdiv: number; decay: number; gain: number }> = {
  lemn: { accent: 1800, beat: 1250, sub: 1450, subdiv: 950, decay: 0.03, gain: 0.8 },
  bip: { accent: 1760, beat: 1320, sub: 1480, subdiv: 990, decay: 0.05, gain: 0.55 },
  rim: { accent: 2600, beat: 2000, sub: 2200, subdiv: 1500, decay: 0.02, gain: 0.8 },
  moale: { accent: 880, beat: 660, sub: 740, subdiv: 520, decay: 0.08, gain: 0.7 },
};

/** `bars` bars of clicks starting at t0 (sec). Beat = one pulse of the meter's denominator; `sub` splits each beat. */
export function clickSchedule(bpm: number, sig: TimeSig, bars: number, o: ClickOpts = DEFAULT_CLICK, t0 = 0): ClickEvent[] {
  const beat = beatSec(bpm);
  const pattern = barClicks(sig);
  const out: ClickEvent[] = [];
  for (let b = 0; b < bars * sig.num; b++) {
    for (let s = 0; s < o.sub; s++) {
      const kind: ClickKind = s > 0 ? 'subdiv' : o.accents ? pattern[b % sig.num] : 'beat';
      out.push({ t: t0 + beat * (b + s / o.sub), kind, beat: b, slot: s });
    }
  }
  return out;
}

/** Mono click track for a schedule (decaying sine burst; `vol` 0..1). */
export function renderClicks(events: ClickEvent[], sr: number, totalSec: number, sound: ClickSound = 'lemn', vol = 0.5): Float32Array {
  const out = new Float32Array(Math.ceil(totalSec * sr));
  const sp = CLICK_SPEC[sound];
  for (const e of events) {
    const hz = sp[e.kind];
    const amp = vol * sp.gain * (e.kind === 'subdiv' ? 0.55 : e.kind === 'accent' ? 1 : 0.8);
    const i0 = Math.round(e.t * sr), n = Math.round(sp.decay * 4 * sr);
    for (let i = 0; i < n && i0 + i < out.length; i++) out[i0 + i] += amp * Math.sin((2 * Math.PI * hz * i) / sr) * Math.exp(-i / (sp.decay * sr));
  }
  return out;
}
