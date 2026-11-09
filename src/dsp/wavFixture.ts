import { readFileSync } from 'node:fs';

/** Minimal 16-bit PCM WAV reader for test fixtures (mono mix). */
export function readWav(path: string): { data: Float32Array; sr: number } {
  const b = readFileSync(path);
  let pos = 12, sr = 44100, ch = 1, bits = 16, off = 0, len = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(pos + 10); sr = b.readUInt32LE(pos + 12); bits = b.readUInt16LE(pos + 22); }
    if (id === 'data') { off = pos + 8; len = Math.min(size, b.length - off); break; }
    pos += 8 + size + (size % 2);
  }
  if (bits !== 16) throw new Error('only 16-bit PCM supported');
  const frames = Math.floor(len / (2 * ch));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(off + (i * ch + c) * 2) / 32768;
    out[i] = s / ch;
  }
  return { data: out, sr };
}
