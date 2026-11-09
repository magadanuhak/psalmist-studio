/** Alignment of a microphone capture to the song timeline (final recording over the minus). Pure, unit-tested. */
export interface Capture { data: Float32Array; /** audio-clock time of the first captured sample */ t0: number; sr: number }

/**
 * Audio for song time [songStart, songEnd] (index 0 = songStart).
 * The minus sounded at `engineT0 + (s - from)` on the audio clock; the singer hears it and the mic delivers it `latencyMs` later,
 * so the sample at song time s sits at (engineT0 + (s - from) - cap.t0 + latency) * sr.
 */
export function alignCapture(cap: Capture, o: { engineT0: number; from: number; latencyMs: number; songStart: number; songEnd: number }): Float32Array {
  const n = Math.max(0, Math.round((o.songEnd - o.songStart) * cap.sr));
  const out = new Float32Array(n);
  const base = (o.engineT0 + (o.songStart - o.from) - cap.t0 + o.latencyMs / 1000) * cap.sr;
  const b0 = Math.round(base);
  for (let i = 0; i < n; i++) { const v = cap.data[b0 + i]; if (v !== undefined && b0 + i >= 0) out[i] = v; }
  return out;
}

/** Write `seg` (aligned audio starting at song time `start`) into a full-song take buffer. */
export function placeSegment(take: Float32Array, sr: number, start: number, seg: Float32Array) {
  const o = Math.round(start * sr);
  for (let i = 0; i < seg.length && o + i < take.length; i++) if (o + i >= 0) take[o + i] = seg[i];
}
