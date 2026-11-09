import type { KeyEstimate, KeyCandidate, Note } from '../model/types';

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Krumhansl-Schmuckler on a duration-weighted pitch-class histogram.
 * Phrase-final and opening notes get extra weight (melodies resolve to the tonic),
 * which separates relative major/minor pairs.
 */
export function estimateKey(notes: Pick<Note, 'midi' | 'durSec'>[] & Partial<Pick<Note, 'startSec'>>[], bpm = 90): KeyEstimate | null {
  if (notes.length < 3) return null;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += Math.min(n.durSec, 3);
  const total = hist.reduce((a, b) => a + b, 0);
  const last = notes[notes.length - 1], first = notes[0];
  hist[((last.midi % 12) + 12) % 12] += total * 0.12;
  hist[((first.midi % 12) + 12) % 12] += total * 0.04;
  const cands: KeyCandidate[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => hist.map((_, i) => p[(i - t + 12) % 12]);
    cands.push({ tonic: t, mode: 'major', score: pearson(hist, rot(KS_MAJOR)) });
    cands.push({ tonic: t, mode: 'minor', score: pearson(hist, rot(KS_MINOR)) });
  }
  cands.sort((a, b) => b.score - a.score);
  let top3 = cands.slice(0, 3);
  const confidence = Math.max(0, Math.min(1, 0.5 + (top3[0].score - top3[1].score) * 4 + (top3[0].score - 0.5) * 0.5));
  // relative major/minor pairs (or low confidence) are settled by where phrases end
  const relative = (a: KeyCandidate, b: KeyCandidate) => a.mode !== b.mode && (((a.mode === 'major' ? a.tonic - b.tonic : b.tonic - a.tonic) % 12) + 12) % 12 === 3;
  const rel = top3.find((c, i) => i > 0 && relative(top3[0], c));
  const ambiguous = confidence < 0.5 || (!!rel && top3[0].score - rel.score < 0.12);
  if (ambiguous) {
    const sorted = [...notes].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
    const finals: number[] = [];
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      const end = (n.startSec ?? 0) + n.durSec;
      if (!next || (next.startSec ?? 0) - end >= Math.max(0.3, (60 / bpm) * 0.5)) finals.push(((n.midi % 12) + 12) % 12);
    });
    const other = rel ?? top3[1];
    const vote = (c: KeyCandidate) => finals.filter((p) => p === c.tonic).length + 0.4 * finals.filter((p) => p === (c.tonic + 7) % 12).length;
    if (vote(other) > vote(top3[0]) + 0.5) top3 = [other, ...top3.filter((c) => c !== other)];
  }
  return { tonic: top3[0].tonic, mode: top3[0].mode, confidence, top3, ambiguous };
}
