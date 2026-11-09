import type { PitchTrack, Analysis } from '../model/types';
import { frameRms, trackPitch } from './pitch';
import { segmentNotes } from './segment';
import { estimateKey } from './key';

/** pitch frames from an external tracker (CREPE via the local AI service, 10 ms hop) in the shape the segmenter expects */
export function pitchTrackFromFrames(audio: Float32Array, sr: number, f0Hz: ArrayLike<number>, voicing: ArrayLike<number>, hopSec = 0.01): PitchTrack {
  const n = f0Hz.length;
  const hz = new Float32Array(n), vp = new Float32Array(n);
  for (let i = 0; i < n; i++) { hz[i] = f0Hz[i] > 0 ? f0Hz[i] : 0; vp[i] = hz[i] > 0 ? Math.max(0, Math.min(1, voicing[i] ?? 1)) : 0; }
  const rms = frameRms(audio, sr, hopSec);
  return { hopSec, hz, voicedProb: vp, rms: rms.length >= n ? rms.subarray(0, n) : Float32Array.from({ length: n }, (_, i) => rms[i] ?? 0) };
}

export function analyze(audio: Float32Array, sr: number, bpm: number, external?: PitchTrack): Analysis {
  const pitchTrack = external ?? trackPitch(audio, sr);
  const { notes, pauses, tuningCents, tuningConcentration } = segmentNotes(pitchTrack, { bpm, audio, sampleRate: sr });
  let rangeMidi: Analysis['rangeMidi'] = null;
  if (notes.length) {
    rangeMidi = {
      lo: Math.min(...notes.map((n) => n.midi)),
      hi: Math.max(...notes.map((n) => n.midi)),
    };
  }
  return { pitchTrack, notes, pauses, rangeMidi, keyEstimate: estimateKey(notes, bpm), tuningCents, tuningConcentration };
}
