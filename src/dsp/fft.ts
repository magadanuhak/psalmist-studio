import FFT from 'fft.js';

const cache = new Map<number, FFT>();
export function getFFT(n: number): FFT {
  let f = cache.get(n);
  if (!f) { f = new FFT(n); cache.set(n, f); }
  return f;
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Real FFT of a frame. Returns interleaved complex output (length 2n). */
export function rfft(frame: ArrayLike<number>, n: number): Float64Array {
  const f = getFFT(n);
  const out = f.createComplexArray() as unknown as Float64Array;
  f.realTransform(out, Array.from(frame) as number[]);
  f.completeSpectrum(out);
  return out;
}
export function irfft(spec: Float64Array, n: number): Float64Array {
  const f = getFFT(n);
  const out = f.createComplexArray() as unknown as Float64Array;
  f.inverseTransform(out, spec);
  const real = new Float64Array(n);
  for (let i = 0; i < n; i++) real[i] = out[2 * i];
  return real;
}
