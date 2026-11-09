import { useEffect, useMemo, useRef, useState } from 'react';
import { currentSection, useApp } from '../store/store';
import { harmonyInputFor, isStale, renderFor } from '../store/harmonyInput';
import { t } from '../i18n/ro';
import { VARIANTS, chordName, rankSlot, type Chord, type HarmonicRate, type VariantId } from '../theory/harmony';
import type { Section } from '../model/types';
import { Icon } from './icons';
import { Empty } from './common';

const RATES: HarmonicRate[] = ['auto', 0.5, 1, 2];
export const FUNC_VAR = { T: 'var(--gold)', S: 'var(--glass-sapphire)', D: 'var(--glass-ruby)' } as const;

/** Section whose chords are shown (own harmony, or the linked source's). */
export function useChordSection(): Section | null {
  return useApp(currentSection);
}

export function ChordPopover({ section, idx, anchor, onClose }: {
  section: Section; idx: number; anchor: { x: number; y: number } | null; onClose(): void;
}) {
  const project = useApp((s) => s.project)!;
  const naming = useApp((s) => s.chordNaming);
  const setChord = useApp((s) => s.setChord);
  const toggleLock = useApp((s) => s.toggleLock);
  const harmonize = useApp((s) => s.harmonize);
  const ref = useRef<HTMLDivElement>(null);
  const h = section.harmony!;
  const v = h.active;
  const chord = h.variants[v][idx];
  const locked = !!h.locks[v][idx];
  const alts = useMemo(() => {
    const inp = harmonyInputFor(project, section);
    if (typeof inp === 'string') return [];
    return rankSlot(inp, v, h.variants[v], idx);
  }, [project, section, h, v, idx]);
  const key = project.key;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); clearTimeout(id); };
  }, [onClose]);

  const slot = h.slots[idx];
  const style = anchor
    ? { left: Math.max(8, Math.min(anchor.x - 150, window.innerWidth - 320)), top: Math.max(8, Math.min(anchor.y + 14, window.innerHeight - 440)) }
    : undefined;
  const same = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;
  const top = alts.filter((a) => a.inTop);
  const rest = alts.filter((a) => !a.inTop);
  const row = (a: (typeof alts)[number], i: number) => (
    <li key={`${a.chord.root}-${a.chord.quality}-${i}`}>
      <button className={`alt ${same(a.chord, chord) ? 'on' : ''}`} onClick={() => { setChord(section.id, idx, a.chord); }} aria-pressed={same(a.chord, chord)}>
        <span className="alt-name">{chordName(a.chord, naming, key)}</span>
        <span className="alt-roman">{a.chord.roman}</span>
        <span className="alt-func" style={{ ['--f' as string]: FUNC_VAR[a.chord.func] }}>{t.chords.funcShort[a.chord.func]}</span>
        <span className="alt-kind">{t.chords.kinds[a.kind]}</span>
      </button>
    </li>
  );

  return (
    <div className="chord-pop" ref={ref} tabIndex={-1} role="dialog" aria-label={t.chords.popoverTitle(slot.bar + 1)} style={style}>
      <div className="pop-head">
        <div>
          <h3>{chordName(chord, naming, key)}</h3>
          <p className="hint">{t.chords.popoverTitle(slot.bar + 1)} · {chord.roman} · {t.chords.func[chord.func]}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t.common.close}><Icon name="close" size={15} /></button>
      </div>
      <div className="pop-actions">
        <button className={`chip-btn ${locked ? 'on' : ''}`} onClick={() => toggleLock(section.id, idx)} aria-pressed={locked}>
          <Icon name={locked ? 'check' : 'plus'} size={14} />{locked ? t.chords.unlock : t.chords.lock}
        </button>
        <button className="chip-btn" onClick={() => harmonize(section.id)} title={t.chords.regenerateHint}><Icon name="wand" size={14} />{t.chords.regenerate}</button>
      </div>
      <p className="pop-sub">{t.chords.best}</p>
      <ul className="alts-list">{top.map(row)}</ul>
      <details className="more">
        <summary>{t.chords.all}</summary>
        <ul className="alts-list">{rest.map(row)}</ul>
      </details>
    </div>
  );
}

export function ChordStrip({ section, readOnly = false }: { section: Section; readOnly?: boolean }) {
  const project = useApp((s) => s.project)!;
  const naming = useApp((s) => s.chordNaming);
  const [sel, setSel] = useState<{ idx: number; x: number; y: number } | null>(null);
  const h = section.harmony;
  const render = useMemo(() => renderFor(project, section), [project, section]);
  if (!h || !render) return null;
  const v = h.active;
  return (
    <div className="chord-strip-wrap">
      <ol className="chord-strip" aria-label={t.chords.strip}>
        {render.slots.map(({ slot, chord, voiced }) => {
          const locked = !!h.locks[v][slot.idx];
          return (
            <li key={slot.idx} className={slot.bar % 2 === 0 && slot.startBeat % project.timeSig.num === 0 ? 'bar-start' : ''}>
              <button
                className={`chord-cell ${sel?.idx === slot.idx ? 'on' : ''}`} style={{ ['--f' as string]: FUNC_VAR[chord.func], flexGrow: slot.beats }}
                disabled={readOnly}
                onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSel({ idx: slot.idx, x: r.left + r.width / 2, y: r.bottom }); }}
                aria-label={`${t.chords.slot(slot.bar + 1)}: ${chordName(chord, naming, project.key, voiced.bassPc)}`}
              >
                <span className="cc-name">{chordName(chord, naming, project.key, voiced.bassPc)}</span>
                <span className="cc-meta"><span className="cc-bar num">{slot.bar + 1}</span><span className="cc-func">{t.chords.funcShort[chord.func]}</span>{locked && <Icon name="lock" size={11} />}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {sel && <ChordPopover section={section} idx={sel.idx} anchor={{ x: sel.x, y: sel.y }} onClose={() => setSel(null)} />}
    </div>
  );
}

export function ChordPanel({ section, hasMelody, showStrip = true }: { section: Section; hasMelody: boolean; showStrip?: boolean }) {
  const project = useApp((s) => s.project)!;
  const naming = useApp((s) => s.chordNaming);
  const setNaming = useApp((s) => s.setChordNaming);
  const harmonize = useApp((s) => s.harmonize);
  const setVariant = useApp((s) => s.setHarmonyVariant);
  const setRate = useApp((s) => s.setHarmonyRate);
  const setSimplicity = useApp((s) => s.setSimplicity);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const h = section.harmony;
  const stale = isStale(section);
  const locks = h ? Object.keys(h.locks[h.active]).length : 0;

  return (
    <section className="panel" aria-labelledby="p-chords">
      <div className="panel-head">
        <h2 id="p-chords">{t.chords.title}</h2>
        <div className="head-tools">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label={t.common.undo} title="Ctrl+Z"><Icon name="undo" size={16} /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label={t.common.redo} title="Ctrl+Y"><Icon name="redo" size={16} /></button>
        </div>
      </div>
      {!hasMelody ? (
        <Empty title={t.chords.needMelodyTitle} body={t.chords.needMelody} />
      ) : !project.key ? (
        <p className="empty-line">{t.chords.errKey}</p>
      ) : (
        <>
          <div className="chord-actions">
            <button className="btn btn-primary" onClick={() => harmonize(section.id)} data-testid="gen-chords">
              <Icon name="wand" size={16} />{h ? t.chords.regenerate : t.chords.generate}
            </button>
            {h && <span className="hint">{locks ? t.chords.locksCount(locks) : t.chords.regenerateHint}</span>}
          </div>
          <div className="field">
            <span className="label">{t.chords.simplicity}</span>
            <div className="seg" role="group" aria-label={t.chords.simplicity}>
              {(['simplu', 'normal', 'bogat'] as const).map((k) => (
                <button key={k} className={(project.simplicity ?? 'simplu') === k ? 'on' : ''} aria-pressed={(project.simplicity ?? 'simplu') === k} onClick={() => setSimplicity(k)} title={t.chords.simplicityHints[k]}>{t.chords.simplicityNames[k]}</button>
              ))}
            </div>
            <p className="hint">{t.chords.simplicityHints[project.simplicity ?? 'simplu']}</p>
          </div>
          {stale && <p className="notice" role="status">{t.chords.stale}</p>}
          {h && (
            <>
              <div className="field">
                <span className="label">{t.chords.variantLabel}</span>
                <div className="seg variant-seg" role="group" aria-label={t.chords.variantLabel}>
                  {VARIANTS.map((v: VariantId) => (
                    <button key={v} className={h.active === v ? 'on' : ''} aria-pressed={h.active === v} onClick={() => setVariant(section.id, v)} title={t.chords.variantHints[v]}>
                      <b>{v}</b> {t.chords.variants[v]}
                    </button>
                  ))}
                </div>
                <p className="hint">{t.chords.variantHints[h.active]}</p>
              </div>
              <div className="chord-opts">
                <div className="field">
                  <label htmlFor="ch-rate">{t.chords.rhythm}</label>
                  <select id="ch-rate" value={String(h.rate)} onChange={(e) => setRate(section.id, (e.target.value === 'auto' ? 'auto' : Number(e.target.value)) as HarmonicRate)}>
                    {RATES.map((r) => <option key={String(r)} value={String(r)}>{t.chords.rates[String(r) as keyof typeof t.chords.rates]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="label">{t.chords.naming}</span>
                  <div className="seg" role="group" aria-label={t.chords.naming}>
                    <button className={naming === 'letter' ? 'on' : ''} aria-pressed={naming === 'letter'} onClick={() => setNaming('letter')}>{t.chords.letters}</button>
                    <button className={naming === 'ro' ? 'on' : ''} aria-pressed={naming === 'ro'} onClick={() => setNaming('ro')}>{t.chords.romanian}</button>
                  </div>
                </div>
              </div>
              {showStrip && <ChordStrip section={section} />}
              <p className="hint">{t.chords.editHint}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
