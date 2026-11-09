import { useEffect, useRef, useState } from 'react';
import type { Take } from '../model/types';
import type { SeparateResult } from '../ai/types';
import type { TapGrid } from '../dsp/tapGrid';
import { BatchPanel, SongPractice } from './StemsUI';
import { clearAiVariant, requestAiVariant } from '../store/aiVariant';
import { AI_A5_UI, ai, aiMessage, useAi } from '../store/ai';
import { useApp } from '../store/store';
import { TIME_SIGS } from '../music/timesig';
import type { Emotion, Genre } from '../model/types';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { Progress } from './common';

/** polls the local AI service every few seconds while mounted */
export function useAiStatus() {
  const status = useAi((s) => s.status);
  const poll = useAi((s) => s.poll);
  useEffect(() => { void poll(); const id = setInterval(() => void poll(), 6000); return () => clearInterval(id); }, [poll]);
  return status;
}

/** Romanian status chip: off / loading / ready. Offline shows how to start it; AI features are hidden or disabled meanwhile. */
export function AiChip() {
  const st = useAiStatus();
  const state = st?.state ?? 'offline';
  const label = state === 'ready' ? t.ai.chipReady : state === 'loading' ? t.ai.chipLoading : state === 'error' ? t.ai.chipError : t.ai.chipOffline;
  return <span className={`ai-chip ai-${state}`} role="status" data-testid="ai-chip" title={st?.health ? `GPU: ${st.health.gpu?.name ?? '—'}` : undefined}><span className="ai-dot" aria-hidden="true" />{label}</span>;
}

/** A/B between the classic, AI and restored cleaning results of a take */
function CleanAb({ sectionId, take }: { sectionId: string; take: Take }) {
  const setKind = useAi((s) => s.setCleanKind);
  const kinds = (['classic', 'ai', 'restore'] as const).filter((k) => take.cleanIds?.[k]);
  if (kinds.length < 2) return null;
  const label = { classic: t.ai.classic, ai: t.ai.aiKind, restore: t.ai.restoreKind };
  return (
    <div className="seg" role="group" aria-label={t.ai.compare} data-testid="clean-ab">
      {kinds.map((k) => <button key={k} className={take.cleanKind === k ? 'on' : ''} aria-pressed={take.cleanKind === k} onClick={() => setKind(sectionId, take.id, k)}>{label[k]}</button>)}
    </div>
  );
}

/** Voce › Curățare: "Curățare AI" next to the classic cleaning, with A/B between the results. */
export function AiCleanButtons({ sectionId, take, restore = false }: { sectionId: string; take: Take | null; restore?: boolean }) {
  const st = useAiStatus();
  const clean = useAi((s) => s.cleanTake);
  const busy = useAi((s) => (take ? s.busy[take.id] : undefined));
  if (!take || !st?.available.denoise) return null;
  return (
    <div className="ai-clean" data-testid="ai-clean">
      {busy ? <Progress label={busy.label} /> : (
        <>
          <button className="btn btn-ghost btn-lg" onClick={() => void clean(sectionId, take.id, 'ai')}><Icon name="wand" size={18} />{t.ai.cleanAi}</button>
          {restore && <button className="btn btn-ghost btn-lg" data-testid="restore-btn" onClick={() => void clean(sectionId, take.id, 'restore')}><Icon name="wand" size={18} />{t.ai.restore}</button>}
        </>
      )}
      <CleanAb sectionId={sectionId} take={take} />
      {Object.keys(take.cleanIds ?? {}).length > 1 && <p className="hint">{t.ai.abHint}</p>}
    </div>
  );
}

/** "Importă cântec întreg": Demucs separation (local); the vocals go on to "Din vocea completă". */
export function ImportSongDialog({ open, onClose, onVocals }: { open: boolean; onClose(): void; onVocals(f: File, grid?: TapGrid): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const st = useAiStatus();
  const separate = useAi((s) => s.separateSong);
  const busy = useAi((s) => s.busy.separate);
  const [model, setModel] = useState<'htdemucs' | 'htdemucs_ft'>('htdemucs');
  const [quality, setQuality] = useState<'fast' | 'best'>('fast');
  const [res, setRes] = useState<{ vocals: File; residualDb: number | null; result: SeparateResult; source: File } | null>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const ready = !!st?.available.separate;
  const pick = async (f: File | undefined) => { if (!f) return; setRes(null); const r = await separate(f, { model, quality }); if (r) setRes({ vocals: r.vocals, residualDb: r.result.residualDb, result: r.result, source: f }); };
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }} data-testid="import-song-dialog">
      <div className="dialog-body">
        <div className="panel-head"><h2>{t.ai.importTitle}</h2><button className="icon-btn" onClick={onClose} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <p className="lede">{t.ai.importBody}</p>
        <p className="hint">{t.ai.personalUse}</p>
        {!ready ? <p className="notice" role="status">{t.ai.offlineHint}</p> : (
          <>
            <div className="field"><span className="label">{t.ai.model}</span>
              <select value={model} onChange={(e) => setModel(e.target.value as typeof model)}><option value="htdemucs">{t.ai.modelFast}</option><option value="htdemucs_ft">{t.ai.modelBest}</option></select>
            </div>
            <div className="field"><span className="label">{t.ai.quality}</span>
              <div className="seg" role="group" aria-label={t.ai.quality}>
                <button className={quality === 'fast' ? 'on' : ''} aria-pressed={quality === 'fast'} onClick={() => setQuality('fast')}>{t.ai.qFast}</button>
                <button className={quality === 'best' ? 'on' : ''} aria-pressed={quality === 'best'} onClick={() => setQuality('best')}>{t.ai.qBest}</button>
              </div>
            </div>
            {busy ? <Progress label={busy.label} value={busy.progress} /> : (
              <label className="btn btn-primary btn-lg file-btn"><Icon name="import" size={18} />{t.ai.pick}
                <input type="file" accept="audio/*" hidden data-testid="import-song-input" onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
            )}
            {res && (
              <div className="ai-result">
                {res.residualDb != null && <p className="hint">{t.ai.bleed(res.residualDb)}</p>}
                <button className="btn btn-primary btn-lg" onClick={() => { onVocals(res.vocals); onClose(); }}>{t.ai.useVocals}</button>
                {AI_A5_UI && <SongPractice result={res.result} vocals={res.vocals} source={res.source} onVocals={(f, g) => { onVocals(f, g); onClose(); }} />}
              </div>
            )}
          </>
        )}
        {AI_A5_UI && ready && <BatchPanel />}
      </div>
    </dialog>
  );
}

/** Aranjament: "Variantă AI" for one layer. The generator proposes; the key, chord, clash, range and density filters decide what stays. */
export function AiVariantButton({ trackId, applied }: { trackId: string; applied: boolean }) {
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState('');
  return (
    <span className="ai-variant" data-testid={`ai-variant-${trackId}`}>
      {busy ? <span className="muted" role="status">{t.ai.variantBusy}</span> : (
        <>
          <button className="btn btn-quiet btn-sm" onClick={async () => { setBusy(true); const r = await requestAiVariant(trackId); setBusy(false); if (r) setRep(t.ai.variantKept(r.kept, r.input, r.anomalies.length)); }}><Icon name="wand" size={13} />{t.ai.variantAi}</button>
          {applied && <button className="btn btn-quiet btn-sm" onClick={() => { clearAiVariant(trackId); setRep(''); }}>{t.ai.variantBack}</button>}
          {rep && <span className="hint" role="status">{rep}</span>}
        </>
      )}
    </span>
  );
}

/** Kept so the Studio import stays valid: the per-layer buttons live in the instrument list. */
export function AiVariantNote() { return null; }

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LABELS: Record<string, string> = { genre: 'Gen', emotion: 'Emoție', bpm: 'BPM', timeSig: 'Măsura', mode: 'Mod', tonic: 'Tonică', simplicity: 'Simplitate' };

/** Romanian assistant (local Qwen): returns a validated settings patch; it is shown first and applied only on the user's click. */
export function AssistantDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ patch: Record<string, unknown>; rejected: string[]; explanation: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  const ask = async () => {
    const p = useApp.getState().project;
    if (!p || !text.trim()) return;
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await ai.assistantPatch(text.trim(), { current: { genre: p.genre, emotion: p.emotion, bpm: p.bpm, timeSig: `${p.timeSig.num}/${p.timeSig.den}`, simplicity: p.simplicity } });
      setRes({ patch: r.patch as Record<string, unknown>, rejected: r.rejected, explanation: r.explanation });
    } catch (e) { setErr(aiMessage(e)); }
    setBusy(false);
  };
  const apply = () => {
    if (!res) return;
    const st = useApp.getState(), p = st.project!, pa = res.patch;
    const sig = typeof pa.timeSig === 'string' ? TIME_SIGS.find((x) => x.id === pa.timeSig)?.sig : undefined;
    st.patchProject({ ...(typeof pa.genre === 'string' ? { genre: pa.genre as Genre } : {}), ...(typeof pa.emotion === 'string' ? { emotion: pa.emotion as Emotion } : {}), ...(typeof pa.bpm === 'number' ? { bpm: Math.round(pa.bpm) } : {}), ...(sig ? { timeSig: sig } : {}) });
    const tonic = typeof pa.tonic === 'string' ? TONICS.indexOf(pa.tonic.replace('♯', '#')) : -1;
    if ((tonic >= 0 || pa.mode) && (p.key || tonic >= 0)) st.setKey({ tonic: tonic >= 0 ? tonic : p.key!.tonic, mode: pa.mode === 'minor' ? 'minor' : pa.mode === 'major' ? 'major' : p.key?.mode ?? 'major' });
    if (pa.simplicity === 'simplu' || pa.simplicity === 'normal' || pa.simplicity === 'bogat') st.setSimplicity(pa.simplicity);
    st.notify('ok', t.ai.applied);
    onClose();
  };
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }} data-testid="assistant-dialog">
      <div className="dialog-body">
        <div className="panel-head"><h2>{t.ai.assistant}</h2><button className="icon-btn" onClick={onClose} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <p className="hint">{t.ai.assistantHint}</p>
        <textarea className="assistant-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.ai.assistantPlaceholder} aria-label={t.ai.assistant} />
        <div className="big-actions"><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void ask()}>{busy ? t.ai.thinking : t.ai.ask}</button></div>
        {err && <p className="form-error" role="alert">{err}</p>}
        {res && (
          <div className="assistant-patch" data-testid="assistant-patch">
            <p>{res.explanation}</p>
            {Object.keys(res.patch).length ? (
              <ul>{Object.entries(res.patch).map(([k, v]) => <li key={k}><strong>{LABELS[k] ?? k}</strong>: {String(v)}</li>)}</ul>
            ) : <p className="hint">{t.ai.noPatch}</p>}
            {res.rejected.length > 0 && <p className="hint">{t.ai.rejected(res.rejected.join(', '))}</p>}
            {Object.keys(res.patch).length > 0 && <button className="btn btn-primary" onClick={apply}>{t.ai.apply}</button>}
          </div>
        )}
      </div>
    </dialog>
  );
}

/** "Detecție note: Clasic | AI (CREPE)": shown only when the service is up */
export function PitchEngineToggle() {
  const st = useAiStatus();
  const eng = useAi((s) => s.pitchEngine);
  const set = useAi((s) => s.setPitchEngine);
  if (st?.state !== 'ready') return null;
  return (
    <div className="field pitch-engine" data-testid="pitch-engine">
      <span className="label">{t.ai.pitchEngine}</span>
      <div className="seg" role="group" aria-label={t.ai.pitchEngine}>
        <button className={eng === 'classic' ? 'on' : ''} aria-pressed={eng === 'classic'} onClick={() => set('classic')}>{t.ai.classic}</button>
        <button className={eng === 'ai' ? 'on' : ''} aria-pressed={eng === 'ai'} onClick={() => set('ai')}>{t.ai.pitchAi}</button>
      </div>
      <span className="hint">{t.ai.pitchHint}</span>
    </div>
  );
}
