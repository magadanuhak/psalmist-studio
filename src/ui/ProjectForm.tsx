import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { t } from '../i18n/ro';
import { CHRISTIAN_EMOTIONS, defaultBarsFor, quickDefaultsFor, quickBars, EMOTIONS, GENRES, SECTION_COLOR, SECTION_TYPES, STRUCTURES, buildQuickForm, type QuickForm as QuickFormState } from '../model/presets';
import type { Emotion, Genre, SectionType, TimeSig } from '../model/types';
import { TIME_SIGS, tapTempo, timeSigId } from '../music/timesig';
import { Icon } from './icons';

export interface StructItem { id: string; type: SectionType; bars: number; label?: string }

export function StructureEditor({ items, onAdd, onRemove, onMove, onBars, onType }: {
  items: StructItem[];
  onAdd(type: SectionType): void; onRemove(id: string): void; onMove(id: string, dir: -1 | 1): void;
  onBars(id: string, bars: number): void; onType(id: string, type: SectionType): void;
}) {
  return (
    <div className="structure">
      {items.length === 0 ? (
        <p className="hint">{t.setup.structureEmpty}</p>
      ) : (
        <ol className="struct-list">
          {items.map((it, i) => (
            <li key={it.id} className="struct-row" style={{ ['--glass' as string]: SECTION_COLOR[it.type] }}>
              <span className="struct-dot" aria-hidden="true" />
              <select value={it.type} onChange={(e) => onType(it.id, e.target.value as SectionType)} aria-label={t.setup.sectionType}>
                {SECTION_TYPES.map((s) => <option key={s} value={s}>{t.sectionTypes[s]}</option>)}
              </select>
              <label className="bars-field">
                <input type="number" min={1} max={64} value={it.bars} aria-label={t.setup.bars}
                  onChange={(e) => onBars(it.id, Math.max(1, Math.min(64, Number(e.target.value) || 1)))} />
                <span>{t.setup.barsUnit}</span>
              </label>
              <div className="row-actions">
                <button type="button" className="icon-btn" onClick={() => onMove(it.id, -1)} disabled={i === 0} aria-label={t.setup.moveUp}><Icon name="up" size={16} /></button>
                <button type="button" className="icon-btn" onClick={() => onMove(it.id, 1)} disabled={i === items.length - 1} aria-label={t.setup.moveDown}><Icon name="down" size={16} /></button>
                <button type="button" className="icon-btn danger" onClick={() => onRemove(it.id)} aria-label={t.setup.removeSection}><Icon name="trash" size={16} /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="add-sections" role="group" aria-label={t.setup.addSection}>
        {SECTION_TYPES.map((s) => (
          <button type="button" key={s} className="chip-btn" style={{ ['--glass' as string]: SECTION_COLOR[s] }} onClick={() => onAdd(s)}>
            <span className="struct-dot" aria-hidden="true" /> <Icon name="plus" size={13} />{t.sectionTypes[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MeterFields({ sig, bpm, onSig, onBpm }: { sig: TimeSig; bpm: number; onSig(s: TimeSig): void; onBpm(b: number): void }) {
  const taps = useRef<number[]>([]);
  const [tapHint, setTapHint] = useState(false);
  const [text, setText] = useState(String(bpm));
  useEffect(() => { setText(String(bpm)); }, [bpm]);
  const tap = () => {
    const now = performance.now();
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2500) taps.current = [];
    taps.current.push(now);
    setTapHint(true);
    const b = tapTempo(taps.current);
    if (b) onBpm(b);
  };
  return (
    <div className="meter-fields">
      <div className="field">
        <label htmlFor="f-sig">{t.setup.timeSig}</label>
        <select id="f-sig" value={timeSigId(sig)} onChange={(e) => onSig(TIME_SIGS.find((x) => x.id === e.target.value)!.sig)}>
          {TIME_SIGS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <p className="hint">{t.setup.timeSigHint}</p>
      </div>
      <div className="field">
        <label htmlFor="f-bpm">{t.setup.bpm}</label>
        <div className="bpm-row">
          <input id="f-bpm" type="number" min={40} max={220} value={text} className="num" inputMode="numeric"
            onChange={(e) => { setText(e.target.value); const v = Number(e.target.value); if (v >= 40 && v <= 220) onBpm(Math.round(v)); }}
            onBlur={() => { const v = Math.max(40, Math.min(220, Math.round(Number(text)) || bpm)); setText(String(v)); onBpm(v); }} />
          <button type="button" className="btn btn-ghost" onClick={tap}><Icon name="tap" size={16} />{t.setup.tap}</button>
        </div>
        <p className="hint">{tapHint ? t.setup.tapActive : t.setup.bpmHint}</p>
      </div>
    </div>
  );
}

export function ChipGroup<T extends string>({ label, value, options, onChange, labels }: {
  label: string; value: T; options: T[]; onChange(v: T): void; labels: Record<T, string>;
}) {
  return (
    <div className="chip-group" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o} role="radio" aria-checked={value === o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{labels[o]}</button>
      ))}
    </div>
  );
}

/** "Formă rapidă": regenerates the structure from a few switches. */
export function QuickForm({ onApply, bpm, genre, active }: { onApply(types: SectionType[], bars: number[]): void; bpm: number; genre: Genre; /** the quick preset is the current structure: a genre change rebuilds it with that genre's defaults */ active?: boolean }) {
  const [q, setQ] = useState<QuickFormState>({ ...quickDefaultsFor(genre), introBars: bpm < 100 ? 8 : 4, bridgeBars: bpm < 100 ? 8 : 4, outroBars: 4 });
  const set = (patch: Partial<QuickFormState>) => { const n = { ...q, ...patch }; setQ(n); const types = buildQuickForm(n); onApply(types, quickBars(types, n, bpm)); };
  useEffect(() => {
    // new genre: its defaults (cantare: interlude on) come back, and the quick structure follows
    const n = { ...q, interlude: quickDefaultsFor(genre).interlude };
    if (n.interlude === q.interlude) return;
    setQ(n);
    if (active) { const types = buildQuickForm(n); onApply(types, quickBars(types, n, bpm)); }
  }, [genre]); // eslint-disable-line react-hooks/exhaustive-deps
  const sw = (key: 'refrenAfterEach' | 'repeatFinalRefren' | 'intro' | 'outro' | 'bridge' | 'interlude', label: string) => (
    <label className="check-row"><input type="checkbox" checked={!!q[key]} onChange={(e) => set({ [key]: e.target.checked })} /><span>{label}</span></label>
  );
  return (
    <fieldset className="quick-form">
      <legend>{t.setup.quickTitle}</legend>
      <p className="hint">{t.setup.quickHint}</p>
      <div className="quick-grid">
        <label className="field quick-num"><span className="label">{t.setup.quickStrofe}</span>
          <select value={q.strofe} onChange={(e) => set({ strofe: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        {sw('refrenAfterEach', t.setup.quickRefren)}
        {sw('repeatFinalRefren', t.setup.quickRepeat)}
        {sw('intro', t.setup.quickIntro)}
        {q.intro && <label className="field quick-num"><span className="label">{t.setup.quickIntroBars}</span><select value={q.introBars} onChange={(e) => set({ introBars: Number(e.target.value) as 4 | 8 })}><option value={4}>4</option><option value={8}>8</option></select></label>}
        {sw('outro', t.setup.quickOutro)}
        {q.outro && <label className="field quick-num"><span className="label">{t.setup.quickOutroBars}</span><select value={q.outroBars} onChange={(e) => set({ outroBars: Number(e.target.value) as 2 | 4 })}><option value={2}>2</option><option value={4}>4</option></select></label>}
        {sw('interlude', t.setup.quickInterlude)}
        {sw('bridge', t.setup.quickBridge)}
        {q.bridge && <label className="field quick-num"><span className="label">{t.setup.quickBridgeBars}</span><select value={q.bridgeBars} onChange={(e) => set({ bridgeBars: Number(e.target.value) as 4 | 8 })}><option value={4}>4</option><option value={8}>8</option></select></label>}
      </div>
      <p className="hint">{t.setup.quickApply}</p>
    </fieldset>
  );
}

let draftSeq = 0;
export function ProjectForm() {
  const createProject = useApp((s) => s.createProject);
  const [name, setName] = useState('');
  const [genre, setGenre] = useState<Genre>('worship');
  const [emotion, setEmotion] = useState<Emotion>('inchinare');
  const [sig, setSig] = useState<TimeSig>(TIME_SIGS[0].sig);
  const [bpm, setBpm] = useState(76);
  const [items, setItems] = useState<StructItem[]>(() =>
    STRUCTURES[0].types.map((type) => ({ id: `d${++draftSeq}`, type, bars: defaultBarsFor(type, 76) })));
  const [preset, setPreset] = useState(STRUCTURES[0].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!items.length) { setErr(t.setup.errNoSections); return; }
    setBusy(true);
    try {
      const p = await createProject({ name, genre, emotion, timeSig: sig, bpm, structure: items.map((i) => ({ type: i.type, bars: i.bars })) });
      location.hash = `#/p/${p.id}`;
    } catch {
      setErr(t.errors.storage);
      setBusy(false);
    }
  };

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = STRUCTURES.find((s) => s.id === id)!;
    setItems(p.types.map((type) => ({ id: `d${++draftSeq}`, type, bars: defaultBarsFor(type, bpm) })));
  };

  return (
    <form className="page form-page" onSubmit={submit} noValidate>
      <div className="page-head">
        <a className="back" href="#/"><Icon name="back" size={16} />{t.nav.projects}</a>
        <h1>{t.setup.title}</h1>
        <p className="lede">{t.setup.lede}</p>
      </div>

      <section className="form-block">
        <div className="field">
          <label htmlFor="f-name">{t.setup.name}</label>
          <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.setup.namePh} maxLength={80} autoFocus autoComplete="off" />
        </div>
      </section>

      <section className="form-block">
        <h2>{t.setup.styleTitle}</h2>
        <div className="field">
          <span className="label" id="l-genre">{t.setup.genre}</span>
          <ChipGroup<Genre> label={t.setup.genre} value={genre} options={GENRES} onChange={setGenre} labels={t.genres} />
        </div>
        <div className="field">
          <span className="label" id="l-emo">{t.setup.emotion}</span>
          <ChipGroup<Emotion> label={t.setup.emotionChristian} value={emotion} options={CHRISTIAN_EMOTIONS} onChange={setEmotion} labels={t.emotions} />
          <ChipGroup<Emotion> label={t.setup.emotion} value={emotion} options={EMOTIONS.filter((x) => !CHRISTIAN_EMOTIONS.includes(x))} onChange={setEmotion} labels={t.emotions} />
        </div>
      </section>

      <section className="form-block">
        <h2>{t.setup.meterTitle}</h2>
        <MeterFields sig={sig} bpm={bpm} onSig={setSig} onBpm={setBpm} />
      </section>

      <section className="form-block">
        <h2>{t.setup.structureTitle}</h2>
        <div className="field">
          <label htmlFor="f-preset">{t.setup.preset}</label>
          <select id="f-preset" value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {STRUCTURES.map((s) => <option key={s.id} value={s.id}>{t.structures[s.id as keyof typeof t.structures]}</option>)}
          </select>
        </div>
        <QuickForm bpm={bpm} genre={genre} active={preset === 'quick'} onApply={(types, bars) => { setPreset('quick'); setItems(types.map((type, k) => ({ id: `d${++draftSeq}`, type, bars: bars[k] }))); }} />
        <StructureEditor
          items={items}
          onAdd={(type) => setItems([...items, { id: `d${++draftSeq}`, type, bars: defaultBarsFor(type, bpm) }])}
          onRemove={(id) => setItems(items.filter((i) => i.id !== id))}
          onMove={(id, dir) => {
            const i = items.findIndex((x) => x.id === id), j = i + dir;
            if (j < 0 || j >= items.length) return;
            const a = [...items]; [a[i], a[j]] = [a[j], a[i]]; setItems(a);
          }}
          onBars={(id, bars) => setItems(items.map((i) => (i.id === id ? { ...i, bars } : i)))}
          onType={(id, type) => setItems(items.map((i) => (i.id === id ? { ...i, type } : i)))}
        />
      </section>

      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="form-actions">
        <a className="btn btn-quiet" href="#/">{t.common.cancel}</a>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? t.common.saving : t.setup.create}</button>
      </div>
    </form>
  );
}
