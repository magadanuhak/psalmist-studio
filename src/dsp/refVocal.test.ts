import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { detectMeter, phrasePeriod } from './meter';

/** Real commercial-style vocal kept OUTSIDE the repo (never copied here); the test runs only where the file exists. */
const REF = 'C:/Users/Admin/AppData/Local/Temp/claude/f3b76ce9ee93cb58/da4ff184-45b2-487f-913c-851f8ed0bc68/scratchpad/ref2/vocals.wav';

function readFloatWav(path: string, from: number, to: number) {
  const b = readFileSync(path);
  let pos = 12, sr = 44100, ch = 1, bits = 16, fmt = 1, off = 0, len = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(pos + 8); ch = b.readUInt16LE(pos + 10); sr = b.readUInt32LE(pos + 12); bits = b.readUInt16LE(pos + 22); }
    if (id === 'data') { off = pos + 8; len = Math.min(size, b.length - off); break; }
    pos += 8 + size + (size % 2);
  }
  const bytes = bits / 8, frames = Math.floor(len / (bytes * ch));
  const a = Math.floor(from * sr), z = Math.min(frames, Math.floor(to * sr));
  const out = new Float32Array(z - a);
  for (let i = a; i < z; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const p = off + (i * ch + c) * bytes;
      s += fmt === 3 ? (bits === 32 ? b.readFloatLE(p) : b.readDoubleLE(p)) : bits === 16 ? b.readInt16LE(p) / 32768 : b.readInt32LE(p) / 2147483648;
    }
    out[i - a] = s / ch;
  }
  return { data: out, sr };
}

describe.skipIf(!existsSync(REF))('reference vocal (85 BPM, 4/4, G minor)', () => {
  const { data, sr } = readFloatWav(REF, 24.8, 47.0);
  const an = analyze(data, sr, 90);
  const notes = an.notes.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity }));
  it('finds the repeated 4-bar phrase and reads 85 BPM, 4/4', () => {
    const ph = phrasePeriod(notes);
    const r = detectMeter({ notes })!;
    console.log('notes', notes.length, 'phrase', ph, JSON.stringify(r.options.map((o) => [o.id, o.bpm, o.bars, o.confidence.toFixed(2)])));
    expect(Math.abs(r.options[0].bpm - 85)).toBeLessThanOrEqual(2);
    expect(r.options[0].id).toBe('4/4');
  });
  it('the whole refren too', () => {
    const rf = readFloatWav(REF, 47.0, 80.0);
    const a2 = analyze(rf.data, rf.sr, 90);
    const r = detectMeter({ notes: a2.notes.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity })) })!;
    console.log('refren', JSON.stringify(r.options.map((o) => [o.id, o.bpm, o.bars, o.confidence.toFixed(2)])));
    expect(Math.abs(r.options[0].bpm - 85)).toBeLessThanOrEqual(2);
  });
});
