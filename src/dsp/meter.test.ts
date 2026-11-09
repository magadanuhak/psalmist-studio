import { describe, expect, it } from 'vitest';
import { detectMeter, type OnsetIn, type TapIn } from './meter';
import { mulberry32 } from './synth';

interface Spec { id: string; L: number; pats: number[][]; denPulses: number }
const SPECS: Record<string, Spec> = {
  '4/4': { id: '4/4', L: 8, denPulses: 2, pats: [[0, 2, 4, 6], [0, 3, 4, 6], [0, 2, 3, 4, 6], [0, 2, 4, 5, 6], [0, 4, 6]] },
  '3/4': { id: '3/4', L: 6, denPulses: 2, pats: [[0, 2, 4], [0, 3, 4], [0, 2, 3, 4], [0, 2, 5], [0, 4]] },
  '6/8': { id: '6/8', L: 6, denPulses: 1, pats: [[0, 3], [0, 1, 2, 3], [0, 2, 3, 5], [0, 3, 4], [0, 1, 3, 4, 5]] },
  '2/4': { id: '2/4', L: 4, denPulses: 2, pats: [[0, 2], [0, 1, 2], [0, 2, 3], [0, 2]] },
};

/** pulse = eighth note, `pulseSec` seconds. Returns sung-like notes (stress on beat 1: longer, louder, higher) */
function song(id: string, pulseSec: number, bars: number, seed: number, lead = 0.4): { notes: OnsetIn[]; firstDown: number } {
  const sp = SPECS[id];
  const rng = mulberry32(seed);
  const notes: OnsetIn[] = [];
  let pitch = 52;
  for (let b = 0; b < bars; b++) {
    const pat = sp.pats[Math.floor(rng() * sp.pats.length)];
    pat.forEach((p, i) => {
      const next = i + 1 < pat.length ? pat[i + 1] : sp.L;
      if (b % 4 === 3 && i === pat.length - 1 && i > 0) return; // breath at phrase end
      const down = p === 0;
      const dur = (next - p) * pulseSec * 0.92;
      pitch = Math.max(45, Math.min(62, pitch + (down ? 2 : Math.floor(rng() * 5) - 2)));
      notes.push({ startSec: lead + (b * sp.L + p) * pulseSec + (rng() - 0.5) * 0.02, durSec: dur * (down ? 1.25 : 0.85), midi: pitch + (down ? 2 : 0), velocity: down ? 0.9 : 0.6 });
    });
  }
  return { notes, firstDown: lead };
}

describe('X0b tempo & meter assistant', () => {
  const run = (id: string, n: number) => {
    let ok = 0, bpmOk = 0, barsOk = 0;
    const rows: string[] = [];
    for (let k = 0; k < n; k++) {
      const rng = mulberry32(500 + k * 17 + id.length);
      const bpm = id.endsWith('/8') ? 150 + Math.floor(rng() * 60) : 70 + Math.floor(rng() * 50);
      const pulse = id.endsWith('/8') ? 60 / bpm : 30 / bpm;
      const bars = 8 + 4 * Math.floor(rng() * 2);
      const { notes } = song(id, pulse, bars, 11 + k);
      const r = detectMeter({ notes })!;
      const top = r.options[0];
      if (top.id === id) ok++;
      else if (r.options[1]?.id === id) rows.push(`${id} run ${k}: top ${top.id} second ok`);
      const hit = r.options.find((o) => o.id === id);
      if (hit && Math.abs(hit.bpm - bpm) <= 2) bpmOk++;
      if (hit && hit.bars === bars) barsOk++;
      rows.push(`${id} #${k}: top ${top.id} (${top.confidence.toFixed(2)}) bpm ${top.bpm} want ${bpm}, bars ${top.bars} want ${bars}`);
    }
    console.log(rows.join('\n'));
    return { ok: ok / n, bpm: bpmOk / n, bars: barsOk / n };
  };
  for (const id of ['4/4', '3/4', '6/8']) {
    it(`${id}: >= 90% correct meter, BPM within +-2, exact bar count`, () => {
      const r = run(id, 10);
      console.log(`RESULT ${id}`, JSON.stringify(r));
      expect(r.ok).toBeGreaterThanOrEqual(0.9);
      expect(r.bpm).toBeGreaterThanOrEqual(0.9);
      expect(r.bars).toBeGreaterThanOrEqual(0.9);
    });
  }
  it('returns two options with confidences and Romanian explanations', () => {
    const { notes } = song('3/4', 30 / 90, 12, 3);
    const r = detectMeter({ notes })!;
    expect(r.options.length).toBe(2);
    expect(r.options[0].confidence).toBeGreaterThanOrEqual(r.options[1].confidence);
    expect(r.options[0].explanation.length).toBeGreaterThan(30);
  });
  it('first downbeat is the first stressed note', () => {
    const { notes } = song('4/4', 30 / 100, 8, 5, 0.55);
    const r = detectMeter({ notes })!;
    expect(Math.abs(r.options[0].firstDownbeatSec - 0.55)).toBeLessThan(0.08);
  });
  it('works from taps alone: BPM, bar count and meter from tapped downbeats', () => {
    for (const [per, id] of [[4, '4/4'], [3, '3/4']] as const) {
      const bpm = 92, beat = 60 / bpm;
      const rng = mulberry32(9);
      const taps: TapIn[] = [];
      for (let i = 0; i < per * 8; i++) taps.push({ t: 0.5 + i * beat + (rng() - 0.5) * 0.03, down: i % per === 0 });
      const r = detectMeter({ taps })!;
      expect(r.source).toBe('taps');
      expect(r.options[0].id).toBe(id);
      expect(Math.abs(r.options[0].bpm - bpm)).toBeLessThanOrEqual(2);
      expect(r.options[0].bars).toBe(8);
    }
  });
  it('taps without accents still give the right BPM with low-confidence meter options', () => {
    const taps: TapIn[] = Array.from({ length: 24 }, (_, i) => ({ t: 1 + i * 0.5 }));
    const r = detectMeter({ taps })!;
    expect(Math.abs(r.options[0].bpm - 120)).toBeLessThanOrEqual(2);
    expect(r.options[0].confidence).toBeLessThan(0.6);
  });
  it('returns null when there is nothing to analyse', () => {
    expect(detectMeter({ notes: [], taps: [] })).toBeNull();
  });
});
