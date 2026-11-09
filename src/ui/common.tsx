import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../store/store';
import { t } from '../i18n/ro';
import { Icon } from './icons';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label={t.common.notifications}>
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={x.kind === 'error' ? 'info' : x.kind === 'ok' ? 'check' : 'info'} size={16} />
          <span>{x.text}</span>
          <button className="icon-btn" onClick={() => dismiss(x.id)} aria-label={t.common.close}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel }: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm(): void; onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
      <div className="dialog-body">
        <h2>{title}</h2>
        <div className="dialog-text">{body}</div>
        <div className="dialog-actions">
          <button className="btn btn-quiet" onClick={onCancel} autoFocus>{t.common.cancel}</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange, hint, format }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; hint?: string;
  onChange(v: number): void; format?: (v: number) => string;
}) {
  const id = useRef(`sl-${Math.random().toString(36).slice(2, 8)}`).current;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="num">{format ? format(value) : `${value}${unit}`}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} aria-describedby={hint ? `${id}-h` : undefined} />
      {hint && <p id={`${id}-h`} className="hint">{hint}</p>}
    </div>
  );
}

export function Progress({ label, value }: { label: string; value?: number }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value !== undefined ? Math.round(value * 100) : undefined}>
      <div className={`progress-bar ${value === undefined ? 'indeterminate' : ''}`} style={value !== undefined ? { width: `${Math.round(value * 100)}%` } : undefined} />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 48" width="120" height="48"><g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 24h112" opacity=".25" /><path d="M10 24v0M22 14v20M34 8v32M46 17v14M58 12v24M70 19v10M82 6v36M94 15v18M106 21v6" />
        </g></svg>
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
