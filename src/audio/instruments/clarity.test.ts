import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// every shipped pitched sample carries a measured pitch clarity (scripts/instruments/clarity.mjs); sustained ones must be clean tones
describe('sample pitch clarity', () => {
  const root = resolve('public/instruments');
  const SHORT = /^(stac|pizz|spic|pluck|pick)/, PERC = /^(hit|trem|mute|soft|hard|bow|full)/;
  for (const id of readdirSync(root)) {
    const p = resolve(root, id, 'manifest.json');
    if (!existsSync(p)) continue;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    if (m.kind !== 'pitched') continue;
    it(id + ': no noisy samples', () => {
      for (const [art, set] of Object.entries<any>(m.articulations)) for (const s of set.samples) {
        expect(typeof s.clarity, id + '/' + s.file).toBe('number');
        const min = SHORT.test(art) ? 0.25 : PERC.test(art) ? 0.05 : 0.5;
        expect(s.clarity, id + '/' + s.file).toBeGreaterThanOrEqual(min);
      }
    });
  }
});
