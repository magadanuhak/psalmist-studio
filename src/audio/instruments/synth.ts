/**
 * Synthesized instruments (Tone.js, zero assets): worship pad, swell, ambient texture, vowel choir (formant
 * synthesis), synth bass, arp pluck, bell, riser. Every factory returns a SynthVoice whose `output` connects
 * to the mixer. Emotion presets come from synthParams.ts.
 */
import * as Tone from 'tone';
import { cutoffHz, emotionParams, VOWEL_FORMANTS, type Vowel } from './synthParams';

export interface SynthOptions { emotion?: string; vowel?: Vowel }

export interface SynthVoice {
  readonly id: string;
  readonly output: Tone.ToneAudioNode;
  /** Play a note. `time` is in Tone/AudioContext seconds. Risers use `dur` as the sweep length. */
  note(midi: number, dur: number, time?: number, vel?: number): void;
  setEmotion(emotion: string): void;
  setVowel?(v: Vowel): void;
  dispose(): void;
}

const hz = (m: number) => Tone.Frequency(m, 'midi').toFrequency();

/** Wrap a polyphonic synth + filter chain. */
function poly(id: string, o: SynthOptions, cfg: {
  osc: string; detuneMul: number; filterQ: number; atkMul: number; relMul: number; level: number; chorus: boolean; sustain: number; lfoToFilter: boolean;
}): SynthVoice {
  let p = emotionParams(o.emotion);
  const out = new Tone.Gain(p.level * cfg.level);
  const filter = new Tone.Filter({ type: 'lowpass', frequency: cutoffHz(p.bright), Q: cfg.filterQ, rolloff: -24 });
  const chorus = cfg.chorus ? new Tone.Chorus({ frequency: 0.35, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start() : null;
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: cfg.osc } as never,
    envelope: { attack: p.attack * cfg.atkMul, decay: 0.6, sustain: cfg.sustain, release: p.release * cfg.relMul },
    detune: 0,
  } as never);
  synth.maxPolyphony = 16;
  const lfo = cfg.lfoToFilter ? new Tone.LFO({ frequency: 0.12, min: cutoffHz(p.bright) * 0.7, max: cutoffHz(p.bright) * 1.3 }).start() : null;
  if (lfo) lfo.connect(filter.frequency);
  synth.connect(filter);
  if (chorus) { filter.connect(chorus); chorus.connect(out); } else filter.connect(out);
  const apply = () => {
    out.gain.rampTo(p.level * cfg.level, 0.1);
    if (!lfo) filter.frequency.rampTo(cutoffHz(p.bright), 0.2);
    else { lfo.min = cutoffHz(p.bright) * (1 - 0.3 * p.movement - 0.1); lfo.max = cutoffHz(p.bright) * (1 + 0.3 * p.movement + 0.1); }
    synth.set({ envelope: { attack: p.attack * cfg.atkMul, release: p.release * cfg.relMul }, detune: 0 } as never);
  };
  return {
    id, output: out,
    note: (midi, dur, time, vel = 0.7) => synth.triggerAttackRelease(hz(midi), Math.max(0.05, dur), time, vel),
    setEmotion: (e) => { p = emotionParams(e); apply(); },
    dispose: () => { synth.dispose(); filter.dispose(); chorus?.dispose(); lfo?.dispose(); out.dispose(); },
  };
}

function vowelChoir(o: SynthOptions): SynthVoice {
  let p = emotionParams(o.emotion); let vowel: Vowel = o.vowel ?? 'aah';
  const out = new Tone.Gain(p.level * 0.9);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' } as never,
    envelope: { attack: Math.max(0.25, p.attack), decay: 0.5, sustain: 0.9, release: p.release },
  } as never);
  synth.maxPolyphony = 12;
  const vib = new Tone.Vibrato({ frequency: 5.1, depth: 0.12 });
  const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 4, depth: 0.7, wet: 0.6 }).start();
  const bands = [0, 1, 2].map((i) => ({ f: new Tone.Filter({ type: 'bandpass', frequency: VOWEL_FORMANTS[vowel].f[i], Q: VOWEL_FORMANTS[vowel].q[i] }), g: new Tone.Gain(VOWEL_FORMANTS[vowel].g[i]) }));
  synth.connect(vib); vib.connect(chorus);
  for (const b of bands) { chorus.connect(b.f); b.f.connect(b.g); b.g.connect(out); }
  const setV = (v: Vowel) => { vowel = v; bands.forEach((b, i) => { b.f.frequency.rampTo(VOWEL_FORMANTS[v].f[i], 0.25); b.f.Q.value = VOWEL_FORMANTS[v].q[i]; b.g.gain.rampTo(VOWEL_FORMANTS[v].g[i], 0.25); }); };
  return {
    id: 'vowel_choir', output: out,
    note: (midi, dur, time, vel = 0.7) => synth.triggerAttackRelease(hz(midi), Math.max(0.1, dur), time, vel * 0.8),
    setEmotion: (e) => { p = emotionParams(e); out.gain.rampTo(p.level * 0.9, 0.1); synth.set({ envelope: { attack: Math.max(0.25, p.attack), release: p.release } } as never); },
    setVowel: setV,
    dispose: () => { synth.dispose(); vib.dispose(); chorus.dispose(); bands.forEach((b) => { b.f.dispose(); b.g.dispose(); }); out.dispose(); },
  };
}

function synthBass(o: SynthOptions): SynthVoice {
  let p = emotionParams(o.emotion);
  const out = new Tone.Gain(0.9);
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' }, filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.008, decay: 0.25, sustain: 0.6, release: 0.18 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3, baseFrequency: 90, octaves: 2.6 },
  });
  const sub = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.15 } });
  const subGain = new Tone.Gain(0.7);
  synth.connect(out); sub.connect(subGain); subGain.connect(out);
  return {
    id: 'synth_bass', output: out,
    note: (midi, dur, time, vel = 0.8) => {
      const t = time ?? Tone.now(); const f = hz(midi);
      synth.filterEnvelope.baseFrequency = 70 + 160 * p.bright;
      synth.triggerAttackRelease(f, Math.max(0.05, dur), t, vel);
      sub.triggerAttackRelease(f, Math.max(0.05, dur), t, vel);
    },
    setEmotion: (e) => { p = emotionParams(e); },
    dispose: () => { synth.dispose(); sub.dispose(); subGain.dispose(); out.dispose(); },
  };
}

function arpPluck(o: SynthOptions): SynthVoice {
  let p = emotionParams(o.emotion);
  const out = new Tone.Gain(0.6);
  const filter = new Tone.Filter({ type: 'lowpass', frequency: cutoffHz(p.bright), Q: 1.5 });
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.28, wet: 0.22 });
  const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' } as never, envelope: { attack: 0.003, decay: 0.35, sustain: 0, release: 0.25 } } as never);
  synth.maxPolyphony = 12; synth.connect(filter); filter.connect(delay); delay.connect(out);
  return {
    id: 'arp_pluck', output: out,
    note: (midi, dur, time, vel = 0.7) => synth.triggerAttackRelease(hz(midi), Math.min(0.5, Math.max(0.05, dur)), time, vel),
    setEmotion: (e) => { p = emotionParams(e); filter.frequency.rampTo(cutoffHz(p.bright), 0.1); },
    dispose: () => { synth.dispose(); filter.dispose(); delay.dispose(); out.dispose(); },
  };
}

function bellSynth(o: SynthOptions): SynthVoice {
  let p = emotionParams(o.emotion);
  const out = new Tone.Gain(0.55);
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01, modulationIndex: 12, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
    envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 2.4 }, modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 1.2 },
  } as never);
  synth.maxPolyphony = 10; synth.connect(out);
  return {
    id: 'bell_synth', output: out,
    note: (midi, dur, time, vel = 0.7) => synth.triggerAttackRelease(hz(midi), Math.max(0.1, dur), time, vel * (0.5 + 0.5 * p.bright)),
    setEmotion: (e) => { p = emotionParams(e); },
    dispose: () => { synth.dispose(); out.dispose(); },
  };
}

/** Riser (noise + tone sweep up) or downlifter. `dur` = sweep length; `midi >= 60` = up, otherwise down. */
function riser(o: SynthOptions): SynthVoice {
  let p = emotionParams(o.emotion);
  const out = new Tone.Gain(0.5);
  const noise = new Tone.Noise('pink'); const nf = new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 1.2 }); const ng = new Tone.Gain(0);
  const tone = new Tone.Oscillator({ type: 'sawtooth', frequency: 110 }); const tg = new Tone.Gain(0);
  noise.connect(nf); nf.connect(ng); ng.connect(out); tone.connect(tg); tg.connect(out);
  noise.start(); tone.start();
  return {
    id: 'riser', output: out,
    note: (midi, dur, time, vel = 0.7) => {
      const t = time ?? Tone.now(); const up = midi >= 60; const d = Math.max(0.5, dur);
      const f0 = up ? 250 : 5000, f1 = up ? 5000 : 250;
      nf.frequency.cancelScheduledValues(t); nf.frequency.setValueAtTime(f0, t); nf.frequency.exponentialRampToValueAtTime(f1, t + d);
      tone.frequency.cancelScheduledValues(t); tone.frequency.setValueAtTime(up ? 110 : 880, t); tone.frequency.exponentialRampToValueAtTime(up ? 880 : 110, t + d);
      const peak = vel * p.level;
      for (const g of [ng, tg]) {
        g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(up ? 0.001 : peak, t);
        if (up) { g.gain.exponentialRampToValueAtTime(Math.max(0.01, peak * (g === tg ? 0.3 : 1)), t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.05); }
        else g.gain.exponentialRampToValueAtTime(0.001, t + d);
      }
    },
    setEmotion: (e) => { p = emotionParams(e); },
    dispose: () => { noise.dispose(); nf.dispose(); ng.dispose(); tone.dispose(); tg.dispose(); out.dispose(); },
  };
}

export const SYNTH_FACTORIES: Record<string, (o: SynthOptions) => SynthVoice> = {
  warm_pad: (o) => poly('warm_pad', o, { osc: 'fatsawtooth', detuneMul: 1, filterQ: 0.7, atkMul: 1, relMul: 1, level: 0.5, chorus: true, sustain: 0.85, lfoToFilter: true }),
  worship_swell: (o) => poly('worship_swell', o, { osc: 'fatsawtooth', detuneMul: 1.3, filterQ: 0.9, atkMul: 2.2, relMul: 1.4, level: 0.5, chorus: true, sustain: 1, lfoToFilter: true }),
  ambient_texture: (o) => poly('ambient_texture', o, { osc: 'sine', detuneMul: 1.6, filterQ: 0.5, atkMul: 3, relMul: 2, level: 0.55, chorus: true, sustain: 1, lfoToFilter: true }),
  vowel_choir: vowelChoir, synth_bass: synthBass, arp_pluck: arpPluck, bell_synth: bellSynth, riser,
};
export const SYNTH_PRESET_IDS = Object.keys(SYNTH_FACTORIES);

/** Create a synthesized instrument by preset id (matches catalog `source.preset`). */
export function createSynth(preset: string, o: SynthOptions = {}): SynthVoice {
  const f = SYNTH_FACTORIES[preset];
  if (!f) throw new Error(`unknown synth preset: ${preset}`);
  return f(o);
}
