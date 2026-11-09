import { describe, expect, it } from 'vitest';
import type { Genre } from '../../model/types';
import { SONGS } from '../../../scripts/benchmarks/singer.mjs';
import { scoreSong } from './benchScore';

describe('ground-truth harmony benchmark (exact melody, exact bar grid)', () => {
  const report: string[] = [];
  for (const id of Object.keys(SONGS)) {
    for (const [name, secBars] of [['one strofa section', 0]] as const) {
      it(`${id}, ${name}`, () => {
        const r = scoreSong(id, SONGS[id].genre as Genre, secBars);
        report.push(`${id}: acceptable ${(100 * r.agree).toFixed(0)}% primary ${(100 * r.primary).toFixed(0)}% of ${r.n}  ${r.rows.filter((x) => x.includes('>')).join(' ')}`);
        expect(r.agree).toBeGreaterThanOrEqual(Number(process.env.BENCH_MIN ?? 0));
      });
    }
  }
  it('prints the table', () => { if (process.env.BENCH_REPORT) console.log('\n' + report.join('\n')); });
});
