import { useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import type { TapIn } from '../dsp/meter';
import { gridFromTaps, type TapGrid } from '../dsp/tapGrid';
import type { Emotion, Genre } from '../model/types';
import { FULL_SIGS, analyzeFullVocal, buildFromFullVocal, planFullVocal, type FullAnalysis } from '../store/fullVocal';
import { t } from '../i18n/ro';
import { Icon } from './icons';
import { useAiStatus } from './AiUI';
import { aiBeatGrid } from '../store/ai';

const FORM_RO: Record<string, string> = { intro: 'Intro', strofa: 'Strofă', refren: 'Refren', bridge: 'Pauză', outro: 'Final' };
type Step = 'pick' | 'analyzing' | 'tap' | 'building';

/** "Din vocea completă": file -> analysis -> tap-along (the user's grid overrides the estimate) -> project. */
export function FullVocalDialog({ open, onClose, genre, emotion, initialFile, initialGrid }: { open: boolean; onClose(): void; genre: Genre; emotion: Emotion; initialFile?: File; initialGrid?: TapGrid }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>('pick');
  const [a, setA] = useState<FullAnalysis | null>(null);
  const [err, setErr] = useState('');
  const [taps, setTaps] = useState<TapIn[]>([]);
  const [tapping, setTapping] = useState(false);
  const [sigId, setSigId] = useState('4/4');
  const aiSt = useAiStatus();
  const [aiGrid, setAiGrid] = useState<TapGrid | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 1 });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const sig = FULL_SIGS[sigId];
  useEffect(() => { if (open && initialFile && step === 'pick' && !a) void pick(initialFile); }, [open, initialFile]); // eslint-disable-line react-hooks/exhaustive-deps
  const tapGrid = useMemo(() => gridFromTaps(taps, sig.num), [taps, sig.num]);
  const grid = tapGrid ?? aiGrid; // the user's own taps win over the AI grid
  const estimate = useMemo(() => (a ? planFullVocal(a.notes, a.sec, { sigId }) : null), [a, sigId]);

  const close = () => { engine.stop(); setTapping(false); setStep('pick'); setA(null); setTaps([]); setErr(''); onClose(); };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setStep('analyzing'); setErr('');
    try {
      const an = await analyzeFullVocal(f);
      if (an.notes.length < 12) { setErr(t.fullVocal.errNotes); setStep('pick'); return; }
      setA(an); setTaps([]); setAiGrid(initialGrid ?? null); setStep('tap');
    } catch { setErr(t.fullVocal.errRead); setStep('pick'); }
  };
  const detectBeats = async () => {
    if (!a) return;
    setAiBusy(true); setErr('');
    const r = await aiBeatGrid(a.mono, a.sr);
    setAiBusy(false);
    if (!r) { setErr(t.fullVocal.aiBeatsFail); return; }
    const id = Object.keys(FULL_SIGS).find((k) => FULL_SIGS[k].num === r.perBar && (r.perBar !== 2 || k === '2/4'));
    if (id) setSigId(id);
    setAiGrid(r.grid); setTaps([]);
  };
  const startTap = async () => {
    if (!a) return;
    if (tapping) { engine.stop(); setTapping(false); return; }
    setTaps([]); setTapping(true);
    await engine.play({
      from: 0, to: a.sec, loop: false, clips: [{ data: a.mono, sr: a.sr, startSec: 0, durSec: a.sec }], tracks: [],
      bpm: 90, sig, metronome: false, levels: { voce: 0.9, metro: 0.5 }, metroOffset: 0,
    });
  };
  const tap = (down = false) => { if (tapping) setTaps((x) => [...x, { t: engine.position(), down }]); };
  useEffect(() => {
    if (!open || !tapping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); setTaps((x) => [...x, { t: engine.position() }]); }
      if (e.key === '1') { e.preventDefault(); e.stopPropagation(); setTaps((x) => [...x, { t: engine.position(), down: true }]); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, tapping]);

  const build = async (useTaps: boolean) => {
    if (!a) return;
    engine.stop(); setTapping(false);
    const plan = planFullVocal(a.notes, a.sec, { sigId, grid: useTaps ? grid : null });
    if (!plan) { setErr(t.fullVocal.errNotes); return; }
    setStep('building');
    try {
      const id = await buildFromFullVocal(a, plan, { genre, emotion, onProgress: setProg });
      close();
      location.hash = '#/p/' + id;
    } catch { setErr(t.fullVocal.errRead); setStep('tap'); }
  };

  const formText = (p: ReturnType<typeof planFullVocal>) => (p ? p.form.sections.map((s) => `${FORM_RO[s.type] ?? s.type} ${s.bars}`).join(' · ') : '');
  return (
    <dialog ref={ref} className="dialog dialog-wide" data-testid="full-vocal" onCancel={(e) => { e.preventDefault(); if (step !== 'building') close(); }}>
      <div className="dialog-body meter-dialog">
        <div className="panel-head"><h2>{t.fullVocal.title}</h2>{step !== 'building' && <button className="icon-btn" onClick={close} aria-label={t.common.close}><Icon name="close" size={16} /></button>}</div>
        {(step === 'pick' || step === 'analyzing') && (
          <>
            <p className="lede">{t.fullVocal.lede}</p>
            <label className="btn btn-primary btn-lg" aria-busy={step === 'analyzing'}>
              <Icon name="import" size={18} />{step === 'analyzing' ? t.fullVocal.analyzing : t.fullVocal.pick}
              <input type="file" accept="audio/*,.wav,.mp3,.m4a" hidden data-testid="full-vocal-input" disabled={step === 'analyzing'} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {err && <p className="form-error" role="alert">{err}</p>}
          </>
        )}
        {step === 'tap' && a && (
          <>
            <p className="hint">{t.fullVocal.found(a.notes.length, a.sec.toFixed(0))}</p>
            <h3>{t.fullVocal.tapTitle}</h3>
            <p className="lede">{t.fullVocal.tapLede}</p>
            <div className="field">
              <span className="label">{t.fullVocal.meter}</span>
              <div className="picker-scope" role="radiogroup" aria-label={t.fullVocal.meter}>
                {Object.keys(FULL_SIGS).map((k) => <button key={k} role="radio" aria-checked={sigId === k} className={`chip-btn ${sigId === k ? 'on' : ''}`} onClick={() => { setSigId(k); setTaps([]); }}>{k}</button>)}
              </div>
            </div>
            <div className="tap-box">
              <button className={`btn ${tapping ? 'btn-ghost' : 'btn-primary'}`} data-testid="fv-listen" onClick={() => void startTap()}>
                <Icon name={tapping ? 'stop' : 'play'} size={16} />{tapping ? t.fullVocal.stop : t.fullVocal.listen}
              </button>
              <button className="tap-pad" data-testid="fv-pad" disabled={!tapping} onClick={() => tap()} aria-label={t.fullVocal.pad}>{t.fullVocal.pad}<small>{t.fullVocal.padHint}</small></button>
              <button className="btn btn-ghost" data-testid="fv-one" disabled={!tapping} onClick={() => tap(true)}>{t.fullVocal.one}</button>
              <span className="muted">{t.fullVocal.taps(taps.length)}</span>
            </div>
            {aiSt?.state === 'ready' && <p><button className="btn btn-ghost" data-testid="fv-ai-beats" disabled={aiBusy} aria-busy={aiBusy} onClick={() => void detectBeats()}><Icon name="wand" size={16} />{aiBusy ? t.fullVocal.aiBeatsBusy : t.fullVocal.aiBeats}</button> <span className="hint">{t.fullVocal.aiBeatsHint}</span></p>}
            <p className="hint">{t.fullVocal.tapHint}</p>
            <p className="notice" data-testid="fv-grid">{grid ? t.fullVocal.gridOk(String(grid.bpm), grid.barSec.toFixed(2)) : t.fullVocal.gridBad}</p>
            {estimate && <p className="hint">{t.fullVocal.estimate}: {t.fullVocal.result(estimate.bpm, formText(estimate))}</p>}
            {err && <p className="form-error" role="alert">{err}</p>}
            <div className="dialog-actions">
              <button className="btn btn-quiet" data-testid="fv-skip" onClick={() => void build(false)}>{t.fullVocal.skip}</button>
              <button className="btn btn-primary" data-testid="fv-use" disabled={!grid} onClick={() => void build(true)}>{t.fullVocal.useTaps}</button>
            </div>
          </>
        )}
        {step === 'building' && (
          <div aria-live="polite" data-testid="fv-building">
            <p className="lede">{t.fullVocal.building(prog.done, prog.total)}</p>
            <progress value={prog.done} max={prog.total} style={{ width: '100%' }} />
          </div>
        )}
      </div>
    </dialog>
  );
}
