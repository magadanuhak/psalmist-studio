import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { arrangementFor } from '../store/arrangeInput';
import { useUserInstruments } from '../store/userInstruments';
import { engine } from '../audio/engine';
import { CATALOG, FAMILIES, forGenre, searchInstruments } from '../audio/instruments/catalog';
import type { CatalogEntry, Family } from '../audio/instruments/types';
import { FAMILY_RO, PICKER_RO, TIER_RO } from '../audio/instruments/strings.ro';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { YourInstrumentDialog } from './YourInstrumentDialog';

const MELODIC_ROLES = ['comp', 'pad', 'melody', 'lead', 'counter', 'fx'];

/** Instrument picker of one mixer / arrangement track: search, family tabs, "în cântec" vs "toate", preview, the user's own instruments. */
export function InstrumentPicker({ trackId, onClose }: { trackId: string | null; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const project = useApp((s) => s.project)!;
  const setInstrument = useApp((s) => s.setInstrument);
  const mine = useUserInstruments((s) => s.list);
  const refresh = useUserInstruments((s) => s.refresh);
  const arr = arrangementFor(project);
  const track = arr?.tracks.find((x) => x.id === trackId);
  const [q, setQ] = useState('');
  const [fam, setFam] = useState<Family | 'all' | 'yours'>('all');
  const [scope, setScope] = useState<'song' | 'all'>('song');
  const [busy, setBusy] = useState<string | null>(null);
  const [fail, setFail] = useState('');
  const [yours, setYours] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (trackId && !d.open) d.showModal();
    if (!trackId && d.open) d.close();
  }, [trackId]);

  const bass = !!track && /^bas/.test(track.id);
  const list = useMemo(() => {
    let base: CatalogEntry[] = [...CATALOG, ...mine].filter((e) => e.family !== 'drums' && e.family !== 'percussion');
    base = bass ? base.filter((e) => e.roles.includes('bass')) : base.filter((e) => e.roles.some((r) => MELODIC_ROLES.includes(r)));
    if (scope === 'song') { const ok = new Set(forGenre(project.genre).map((e) => e.id)); base = base.filter((e) => ok.has(e.id) || e.id.startsWith('user:')); }
    if (fam === 'yours') base = base.filter((e) => e.id.startsWith('user:'));
    else if (fam !== 'all') base = base.filter((e) => e.family === fam);
    return searchInstruments(q, base);
  }, [q, fam, scope, bass, mine, project.genre]);

  const preview = async (e: CatalogEntry) => {
    setBusy(e.id); setFail('');
    const ok = await engine.previewInstrument(e, e.preview);
    if (!ok) setFail(t.instr.previewFail);
    setBusy(null);
  };
  const pick = (id: string | null) => { if (trackId) setInstrument(trackId, id); onClose(); };
  const families = FAMILIES.filter((f) => f !== 'drums' && f !== 'percussion');

  return (
    <>
      <dialog ref={ref} className="dialog dialog-wide picker" data-testid="instrument-picker" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
        <div className="dialog-body">
          <div className="panel-head"><h2>{PICKER_RO.title}{track ? `: ${track.name}` : ''}</h2><button className="icon-btn" onClick={onClose} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
          <input className="picker-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={PICKER_RO.search} aria-label={PICKER_RO.search} data-testid="picker-search" />
          <div className="picker-scope" role="radiogroup" aria-label={PICKER_RO.title}>
            <button role="radio" aria-checked={scope === 'song'} className={`chip-btn ${scope === 'song' ? 'on' : ''}`} onClick={() => setScope('song')}>{PICKER_RO.inSong}</button>
            <button role="radio" aria-checked={scope === 'all'} className={`chip-btn ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>{PICKER_RO.all}</button>
          </div>
          <div className="picker-tabs" role="tablist" aria-label={t.instr.tabsAll}>
            {(['all', ...families, ...(mine.length ? ['yours'] : [])] as (Family | 'all' | 'yours')[]).map((f) => (
              <button key={f} role="tab" aria-selected={fam === f} className={`chip-btn ${fam === f ? 'on' : ''}`} onClick={() => setFam(f)}>{f === 'all' ? t.instr.tabsAll : f === 'yours' ? PICKER_RO.yours : FAMILY_RO[f]}</button>
            ))}
          </div>
          {fail && <p className="form-error" role="alert">{fail}</p>}
          <ul className="picker-list" aria-label={PICKER_RO.title}>
            {list.map((e) => (
              <li key={e.id} className={`picker-row ${track?.inst === e.id ? 'cur' : ''}`} data-inst={e.id}>
                <div className="picker-name"><strong>{e.name}</strong><small>{FAMILY_RO[e.family]} · <span className={`tier tier-${e.tier}`} title={TIER_RO[e.tier].hint}>{t.instr.tierBadge[e.tier]}</span></small></div>
                <button className="btn btn-ghost btn-sm" disabled={busy === e.id} onClick={() => void preview(e)} aria-label={`${PICKER_RO.preview}: ${e.name}`}><Icon name="play" size={14} />{busy === e.id ? PICKER_RO.loading : PICKER_RO.preview}</button>
                <button className={`btn btn-sm ${track?.inst === e.id ? 'btn-quiet' : 'btn-primary'}`} onClick={() => pick(e.id)} data-testid={`pick-${e.id}`}>{track?.inst === e.id ? t.instr.picked : t.instr.pick}</button>
              </li>
            ))}
            {!list.length && <li className="hint">{t.instr.empty}</li>}
          </ul>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={() => setYours(true)} data-testid="open-yours"><Icon name="rec" size={14} />{t.instr.yoursOpen}</button>
            <button className="btn btn-quiet" onClick={() => pick(null)}>{t.instr.reset}</button>
          </div>
        </div>
      </dialog>
      <YourInstrumentDialog open={yours} onClose={() => setYours(false)} onSaved={(id) => { setYours(false); if (id) pick(id); }} />
    </>
  );
}
