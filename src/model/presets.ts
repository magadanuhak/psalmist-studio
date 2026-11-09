import type { Emotion, Genre, SectionType } from './types';

export const GENRES: Genre[] = ['worship', 'imn', 'cantare', 'pop', 'rock', 'popular'];
export const EMOTIONS: Emotion[] = [
  'inchinare', 'lauda', 'rugaciune', 'biruinta',
  'trist', 'romantic', 'vesel', 'energic', 'epic', 'nostalgic', 'linistit', 'dramatic',
];
export const CHRISTIAN_EMOTIONS: Emotion[] = ['inchinare', 'lauda', 'rugaciune', 'biruinta'];
export const SECTION_TYPES: SectionType[] = ['intro', 'strofa', 'prerefren', 'refren', 'bridge', 'interlude', 'outro'];

export interface StructurePreset { id: string; types: SectionType[] }
export interface QuickForm {
  strofe: number;            // 1..6
  refrenAfterEach: boolean;
  repeatFinalRefren: boolean; // refren x2 at the end
  intro: boolean;
  outro: boolean;
  bridge: boolean;
  /** a 1-bar instrumental interlude (turnaround VI-VII -> i) between a refren and the next strofă; default on for cantare */
  interlude?: boolean;
  /** instrumental intro / bridge length in bars (4 or 8) and outro length (2 or 4) */
  introBars?: 4 | 8;
  bridgeBars?: 4 | 8;
  outroBars?: 2 | 4;
}
export const DEFAULT_QUICK: QuickForm = { strofe: 2, refrenAfterEach: true, repeatFinalRefren: false, intro: true, outro: true, bridge: false };
/** Formă rapidă defaults by genre: cantare creștină gets the 1-bar turnaround interlude. */
export const quickDefaultsFor = (genre: Genre): QuickForm => ({ ...DEFAULT_QUICK, interlude: genre === 'cantare' });

/** Default length of a section: slow songs (BPM < 100) get 8-bar intros and bridges, faster ones 4. */
export function defaultBarsFor(type: SectionType, bpm: number): number {
  if (type === 'intro' || type === 'bridge') return bpm < 100 ? 8 : 4;
  if (type === 'interlude') return 1;
  if (type === 'outro') return 4;
  return 8;
}

/** Bars per section of a quick form (same order as buildQuickForm). */
export function quickBars(types: SectionType[], q: QuickForm, bpm: number): number[] {
  return types.map((t) => (t === 'intro' ? q.introBars : t === 'bridge' ? q.bridgeBars : t === 'outro' ? q.outroBars : undefined) ?? defaultBarsFor(t, bpm));
}

/** "Formă rapidă": only the first strofă and the first refren are recorded, the rest is built from them. */
export function buildQuickForm(q: QuickForm): SectionType[] {
  const out: SectionType[] = [];
  if (q.intro) out.push('intro');
  const n = Math.max(1, Math.min(6, Math.round(q.strofe)));
  for (let i = 0; i < n; i++) {
    out.push('strofa');
    if (q.refrenAfterEach) {
      if (q.bridge && i === n - 1) out.push('bridge');
      out.push('refren');
      if (q.interlude && i < n - 1) out.push('interlude');
    }
  }
  if (!q.refrenAfterEach) { if (q.bridge) out.push('bridge'); out.push('refren'); }
  if (q.repeatFinalRefren) out.push('refren');
  if (q.outro) out.push('outro');
  return out;
}

export const STRUCTURES: StructurePreset[] = [
  { id: 'quick', types: buildQuickForm(DEFAULT_QUICK) },
  { id: 'default', types: ['intro', 'strofa', 'refren', 'strofa', 'refren', 'bridge', 'refren', 'outro'] },
  { id: 'srsrbr', types: ['strofa', 'refren', 'strofa', 'refren', 'bridge', 'refren'] },
  { id: 'srsr', types: ['strofa', 'refren', 'strofa', 'refren'] },
  { id: 'worship', types: ['intro', 'strofa', 'prerefren', 'refren', 'strofa', 'prerefren', 'refren', 'bridge', 'refren', 'outro'] },
  { id: 'imn', types: ['strofa', 'strofa', 'strofa', 'strofa'] },
  { id: 'simple', types: ['strofa', 'refren'] },
  { id: 'empty', types: [] },
];

/** Stained-glass hue per section type (CSS variable names live in styles.css). */
export const SECTION_COLOR: Record<SectionType, string> = {
  intro: 'var(--glass-sapphire)',
  strofa: 'var(--glass-emerald)',
  prerefren: 'var(--glass-amethyst)',
  refren: 'var(--glass-ruby)',
  bridge: 'var(--glass-amber)',
  interlude: 'var(--glass-amber)',
  outro: 'var(--glass-teal)',
};
