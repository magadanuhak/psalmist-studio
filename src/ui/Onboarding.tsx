import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/ro';
import { Icon } from './icons';

const KEY = 'psalmist.onboarded.v1';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const mark = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

/** 3-step welcome, shown once. */
export function Onboarding() {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(() => !seen());
  useEffect(() => { const d = ref.current; if (open && d && !d.open) d.showModal(); }, [open]);
  if (!open) return null;
  const steps = t.onboarding.steps;
  const last = step === steps.length - 1;
  const close = () => { mark(); ref.current?.close(); setOpen(false); };
  return (
    <dialog ref={ref} className="dialog onboarding" aria-labelledby="ob-title" onCancel={(e) => { e.preventDefault(); close(); }}>
      <div className="dialog-body">
        <p className="ob-kicker" id="ob-title">{t.onboarding.title}</p>
        <div className="ob-dots" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
        <h2 className="ob-step" aria-live="polite">{steps[step].h}</h2>
        <p className="lede">{steps[step].p}</p>
        <div className="dialog-actions">
          <button className="btn btn-quiet" onClick={close}>{t.onboarding.skip}</button>
          {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>{t.common.back}</button>}
          <button className="btn btn-primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? t.common.finish : t.common.next}</button>
        </div>
      </div>
    </dialog>
  );
}

/** "?" keyboard-shortcut sheet. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="help-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-body">
        <div className="panel-head"><h2 id="help-title">{t.help.title}</h2><button className="icon-btn" onClick={onClose} aria-label={t.help.close}><Icon name="close" size={16} /></button></div>
        <dl className="keys-list">
          {t.help.rows.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
        </dl>
        <div className="dialog-actions"><button className="btn btn-primary" onClick={onClose}>{t.help.close}</button></div>
      </div>
    </dialog>
  );
}
