import { defaultLayersOff, defaultPalette } from '../theory/arrange/presets';
import { useEffect, useMemo, useState } from 'react';
import { engine } from '../audio/engine';
import { DEFAULT_SPACE, SPACE_IDS } from '../audio/instruments/reverb';
import { SPACE_RO } from '../audio/instruments/strings.ro';
import { getInstrument } from '../audio/instruments/catalog';
import { entryOf } from '../store/userInstruments';
import { InstrumentPicker } from './InstrumentPicker';
import { useApp } from '../store/store';
import { arrangementFor, arrangementSettings } from '../store/arrangeInput';
import { t } from '../i18n/ro';
import { SECTION_COLOR } from '../model/presets';
import { midiName } from '../music/theory';
import { defaultEnergies } from '../theory/arrange';
import { Empty } from './common';
import { Icon } from './icons';
import { AiVariantButton, useAiStatus } from './AiUI';

/** Arrangement overview (A4): instruments of the genre, register policy, energy per section, drop before the last refren. */
export function ArrangePanel() {
  const project = useApp((s) => s.project)!;
  const setEnergy = useApp((s) => s.setSectionEnergy);
  const setDrop = useApp((s) => s.setDrop);
  const regen = useApp((s) => s.regenerateMelody);
  const toggleLayer = useApp((s) => s.toggleLayer);
  const setSpace = useApp((s) => s.setSpace);
  const setPalette = useApp((s) => s.setPalette);
  const [picking, setPicking] = useState<string | null>(null);
  const [loading, setLoading] = useState<{ name: string; progress: number } | null>(null);
  useEffect(() => engine.subscribe(() => setLoading(engine.instrumentLoad ? { ...engine.instrumentLoad } : null)), []);
  const arr = useMemo(() => arrangementFor(project), [project]);
  const set = arrangementSettings(project);
  const aiOn = !!useAiStatus()?.available.accompany;
  const defaults = useMemo(() => defaultEnergies(project.sections.map((s) => s.type)), [project.sections]);
  if (!arr) {
    return (
      <section className="panel" aria-labelledby="p-arr">
        <div className="panel-head"><h2 id="p-arr">{t.arrange.title}</h2></div>
        <Empty title={t.arrange.emptyTitle} body={project.key ? t.arrange.emptyBody : t.chords.errKey} />
      </section>
    );
  }
  const reg = arr.register;
  return (
    <section className="panel arrange" aria-labelledby="p-arr">
      <div className="panel-head"><h2 id="p-arr">{t.arrange.title}</h2></div>
      <p className="lede">{t.arrange.lede(t.genres[project.genre])}</p>
      <p className="hint reg-note">
        {reg.mode === 'above'
          ? t.arrange.registerAbove(midiName(reg.vocalLo, 'solfege'), midiName(reg.vocalHi, 'solfege'))
          : t.arrange.registerBelow(midiName(reg.vocalLo, 'solfege'))}
      </p>
      <ul className="inst-list inst-pick" aria-label={t.arrange.instruments}>
        {arr.tracks.map((x) => {
          const e = x.inst ? entryOf(x.inst) ?? getInstrument(x.inst) : undefined;
          return (
            <li key={x.id} data-track={x.id}>
              <span className="inst-track">{x.name}</span>
              {!x.drums && aiOn && <AiVariantButton trackId={x.id} applied={!!set.aiVariants?.[x.id]} />}
              {x.drums || !e ? <span className="inst-cur muted">{x.drums ? 'Set GM' : ''}</span> : (
                <button className="inst-btn" data-testid={`change-${x.id}`} onClick={() => setPicking(x.id)} aria-label={`${t.instr.change}: ${x.name}`}>
                  <span>{e.name}</span><Icon name="edit" size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {(<>
        <label className="field"><span className="label">{t.instr.palette}</span>
          <select value={set.palette ?? defaultPalette(project.genre)} data-testid="palette-select" onChange={(e) => setPalette(e.target.value as 'acustic' | 'clasic' | 'vesel')}>
            <option value="acustic">{t.instr.paletteAcustic}</option><option value="vesel">{t.instr.paletteVesel}</option><option value="clasic">{t.instr.paletteClasic}</option>
          </select>
          <span className="hint">{t.instr.paletteHint}</span>
        </label>
      </>)}
      {loading && <p className="hint" role="status" data-testid="inst-loading">{t.instr.loadingN(loading.name, loading.progress)}</p>}
      <div className="space-row">
        <label className="field"><span className="label">{t.instr.space}</span>
          <select value={set.space ?? ''} data-testid="space-select" onChange={(e) => setSpace(e.target.value || null)}>
            <option value="">{SPACE_RO[DEFAULT_SPACE[project.genre]]} (implicit)</option>
            {SPACE_IDS.map((id) => <option key={id} value={id}>{SPACE_RO[id]}</option>)}
          </select>
        </label>
        <label className="field"><span className="label">{t.instr.spaceAmount}: {Math.round((set.spaceLevel ?? 1) * 100)}%</span>
          <input type="range" min={0} max={150} step={5} value={Math.round((set.spaceLevel ?? 1) * 100)} data-testid="space-level" onChange={(e) => setSpace(set.space ?? null, Number(e.target.value) / 100)} />
        </label>
      </div>
      <p className="hint">{t.instr.spaceHint}</p>
      <InstrumentPicker trackId={picking} onClose={() => setPicking(null)} />
      <h3 className="sub-h">{t.arrange.layersTitle}</h3>
      <p className="hint">{t.arrange.layersHint}</p>
      <div className="layer-row">
        {(['lead', 'answers', 'counter'] as const).map((l) => {
          const on = !(set.layersOff ?? defaultLayersOff(set.palette ?? defaultPalette(project.genre))).includes(l);
          return (
            <button key={l} className={`btn btn-sm layer-btn ${on ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={on} onClick={() => toggleLayer(l)}>
              {t.arrange.layers[l]}: {on ? t.arrange.on : t.arrange.off}
            </button>
          );
        })}
        {!(set.layersOff ?? defaultLayersOff(set.palette ?? defaultPalette(project.genre))).includes('answers') && !arr.tracks.some((x) => x.id === 'answers') && <p className="hint layer-hint" role="note">{t.arrange.answersNone}</p>}
        <button className="btn btn-ghost btn-sm" onClick={regen}><Icon name="wand" size={14} />{t.arrange.regenerate}</button>
      </div>
      <h3 className="sub-h">{t.arrange.energyTitle}</h3>
      <ol className="energy-list">
        {arr.plan.map((s, i) => {
          const manual = set.energy[s.id] !== undefined;
          const shown = s.energy;
          return (
            <li key={s.id} style={{ ['--glass' as string]: SECTION_COLOR[s.type] }}>
              <span className="energy-label"><span className="section-swatch" aria-hidden="true" />{s.label}
                {s.rampTo && !manual && <em>{t.arrange.ramp(s.energy, s.rampTo)}</em>}
                {arr.melodic && (() => {
                  const m = arr.melodic!.perSection[s.id];
                  if (!m) return null;
                  const bits = [
                    s.type === 'intro' && m.lead ? t.arrange.hookIn : m.lead ? t.arrange.leadN(m.lead) : '',
                    m.answers ? t.arrange.answersN(m.answers) : '',
                    m.counter ? t.arrange.counterOn : '',
                  ].filter(Boolean);
                  return <small className="gen-note">{bits.length ? bits.join(' · ') : t.arrange.nothingMelodic}</small>;
                })()}
              </span>
              <span className="energy-dots" role="group" aria-label={`${t.arrange.energy}: ${s.label}`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={`dot ${n <= shown ? 'on' : ''} ${n === shown ? 'cur' : ''}`} aria-pressed={n === shown} aria-label={`${n}`} onClick={() => setEnergy(s.id, n)} />
                ))}
              </span>
              <button className="btn btn-quiet btn-sm" disabled={!manual && !!defaults[i]} onClick={() => setEnergy(s.id, null)} style={{ visibility: manual ? 'visible' : 'hidden' }}>{t.arrange.auto}</button>
            </li>
          );
        })}
      </ol>
      <label className="check-row">
        <input type="checkbox" checked={set.drop} onChange={(e) => setDrop(e.target.checked)} />
        <span>{t.arrange.drop}</span>
      </label>
      <p className="hint">{t.arrange.hint}</p>
    </section>
  );
}
