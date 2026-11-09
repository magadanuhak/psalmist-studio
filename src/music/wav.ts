export function floatToInt16(x: Float32Array): Int16Array {
  const o = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    o[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return o;
}
export function int16ToFloat(x: Int16Array): Float32Array {
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] / (x[i] < 0 ? 0x8000 : 0x7fff);
  return o;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = floatToInt16(samples);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}

export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
