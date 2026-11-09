import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

describe('zip writer', () => {
  it('crc32 of "123456789" is cbf43926', () => { expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926'); });
  it('produces a readable archive structure', () => {
    const z = zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b.wav', data: new Uint8Array(10) }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(z.length - 22 + 10, true)).toBe(2);
  });
});
