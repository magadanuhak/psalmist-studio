import { useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { CLICK_SOUND_LABEL, type ClickSound } from '../audio/click';
import { TIME_SIGS, barClicks, beatSec, tapTempo } from '../music/timesig';
import { currentSection, useApp } from '../store/store';
import { useRec } from '../store/rec';
import { t } from '../i18n/ro';
import { Icon } from './icons';

type Step = 'tempo' | 'meter' | 'record';
const METERS = ['2/4', '3/4', '4/4', '6/8'];

/** "Asistent înregistrare": 1 tap the tempo, 2 find the meter by ear (accented "1"), 3 record with the metronome in the headphones. */
export function RecAssistant({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const p = useApp((s) => s.project);
  const patch = useApp((s) => s.patchProject);
  const sec = useApp(currentSection);
  const realId = useApp((s) => s.sectionId);
  const [step, setStep] = useState<Step>('tempo');
  const [taps, setTaps] = useState<number[]>([]);
  const [meterId, setMeterId] = useState('4/4');
  const rec = useRec();
  const playing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listening, setListening] = useState(false);

  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  useEffect(() => { if (open && p) setMeterId(TIME_SIGS.find((x) => x.sig.num === p.timeSig.num && x.sig.den === p.timeSig.den)?.id ?? '4/4'); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;

  const bpm = tapTempo(taps);
  const tap = () => setTaps((x) => [...x.slice(-11), performance.now()]);
  const sig = TIME_SIGS.find((x) => x.id === meterId)?.sig ?? p.timeSig;
  const close = () => { if (playing.current) clearTimeout(playing.current); setListening(false); onClose(); };

  /** two bars with an accented "1", at the project tempo, to decide the meter by ear */
  const listen = async () => {
    await engine.ensureContext();
    const ctx = engine.rawContext, pat = barClicks(sig), b = beatSec(p.bpm);
    const t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < sig.num * 2; i++) engine.tick(pat[i % sig.num], t0 + i * b, 0.7, rec.click.sound);
    setListening(true);
    playing.current = setTimeout(() => setListening(false), (sig.num * 2 * b + 0.2) * 1000);
  };

  const phase = rec.status;
  const beats = sig.num;
  const lit = rec.beatIndex;
  const bleed = rec.bleed?.report;
  const recording = phase === 'countin' || phase === 'recording' || phase === 'paused';
  const subLabel: Record<number, string> = { 1: t.recAssist.subNone, 2: '1/2', 3: t.recAssist.subTriplet, 4: '1/4' };

  return (
    <dialog ref={ref} className="dialog dialog-wide" data-testid="rec-assistant" onCancel={(e) => { e.preventDefault(); if (!recording) close(); }}>
      <div className="dialog-body meter-dialog">
        <div className="panel-head"><h2>{t.recAssist.title}</h2><button className="icon-btn" onClick={close} disabled={recording} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <ol className="rec-steps" aria-label={t.recAssist.steps}>
          {(['tempo', 'meter', 'record'] as Step[]).map((s, i) => <li key={s} className={step === s ? 'on' : ''}><button className="chip-btn" aria-current={step === s} onClick={() => !recording && setStep(s)}>{i + 1}. {t.recAssist[s]}</button></li>)}
        </ol>

        {step === 'tempo' && (
          <>
            <p className="lede">{t.recAssist.tempoLede}</p>
            <div className="tap-box">
              <button className="tap-pad" data-testid="ra-tap" onClick={tap} aria-label={t.recAssist.tapPad}>{t.recAssist.tapPad}<small>{bpm ? `${bpm} BPM` : t.recAssist.tapMore}</small></button>
              <button className="btn btn-quiet" onClick={() => setTaps([])}>{t.recAssist.reset}</button>
            </div>
            <p className="hint">{t.recAssist.current(p.bpm)}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" data-testid="ra-use-tempo" disabled={!bpm} onClick={() => { if (bpm) patch({ bpm }); setStep('meter'); }}>{t.recAssist.useTempo(bpm ?? 0)}</button>
              <button className="btn btn-quiet" onClick={() => setStep('meter')}>{t.recAssist.keep}</button>
            </div>
          </>
        )}

        {step === 'meter' && (
          <>
            <p className="lede">{t.recAssist.meterLede}</p>
            <div className="picker-scope" role="radiogroup" aria-label={t.recAssist.meter}>
              {METERS.map((k) => <button key={k} role="radio" aria-checked={meterId === k} className={`chip-btn ${meterId === k ? 'on' : ''}`} data-testid={`ra-meter-${k.replace('/', '-')}`} onClick={() => setMeterId(k)}>{k}</button>)}
            </div>
            <div className="big-actions">
              <button className="btn btn-primary" data-testid="ra-listen" onClick={() => void listen()} aria-busy={listening}><Icon name="play" size={16} />{listening ? t.recAssist.listening : t.recAssist.listen}</button>
            </div>
            <p className="hint">{t.recAssist.meterHint}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" data-testid="ra-use-meter" onClick={() => { patch({ timeSig: sig }); setStep('record'); }}>{t.recAssist.useMeter(meterId)}</button>
            </div>
          </>
        )}

        {step === 'record' && (
          <>
            <p className="notice">{t.recAssist.headphones}</p>
            <div className="field-row">
              <label className="field"><span className="label">{t.recAssist.sound}</span>
                <select value={rec.click.sound} data-testid="ra-sound" onChange={(e) => rec.setClick({ sound: e.target.value as ClickSound })}>
                  {(Object.keys(CLICK_SOUND_LABEL) as ClickSound[]).map((k) => <option key={k} value={k}>{CLICK_SOUND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="field"><span className="label">{t.recAssist.volume}: {Math.round(rec.clickVolume * 100)}%</span>
                <input type="range" min={0.1} max={1} step={0.05} value={rec.clickVolume} onChange={(e) => rec.setClickVolume(+e.target.value)} aria-label={t.recAssist.volume} />
              </label>
            </div>
            <div className="field"><span className="label">{t.recAssist.subdivision}</span>
              <div className="seg" role="group" aria-label={t.recAssist.subdivision}>
                {([1, 2, 3, 4] as const).map((s) => <button key={s} className={rec.click.sub === s ? 'on' : ''} aria-pressed={rec.click.sub === s} data-testid={`ra-sub-${s}`} onClick={() => rec.setClick({ sub: s })}>{subLabel[s]}</button>)}
              </div>
            </div>
            <label className="check-row"><input type="checkbox" checked={rec.click.accents} onChange={(e) => rec.setClick({ accents: e.target.checked })} />{t.recAssist.accents}</label>
            <label className="check-row"><input type="checkbox" checked={rec.metronomeOn} onChange={(e) => rec.setMetronomeOn(e.target.checked)} />{t.recAssist.metroOn}</label>

            <div className="beat-lights" data-testid="ra-beats" aria-live="off" role="img" aria-label={t.recAssist.beatLights}>
              {Array.from({ length: beats }, (_, i) => <span key={i} className={`beat-dot ${i === 0 ? 'one' : ''} ${recording && lit === i ? 'lit' : ''}`}>{i + 1}</span>)}
            </div>
            <p className="hint" data-testid="ra-status">{phase === 'countin' ? t.recAssist.countIn : phase === 'recording' ? t.recAssist.recording(rec.barNumber) : phase === 'saving' ? t.recAssist.saving : t.recAssist.ready(p.bpm, sig.num + '/' + sig.den)}</p>
            {rec.error && <p className="form-error" role="alert">{rec.error}</p>}
            <div className="big-actions">
              {!recording
                ? <button className="btn btn-primary btn-lg" data-testid="ra-record" disabled={phase === 'saving' || phase === 'opening'} onClick={() => void rec.record(realId ?? sec?.id ?? '')}><Icon name="mic" size={18} />{t.recAssist.record}</button>
                : <button className="btn btn-primary btn-lg" data-testid="ra-stop" onClick={() => rec.stopRecording()}><Icon name="stop" size={18} />{t.recAssist.stop}</button>}
            </div>
            {bleed && !recording && (
              <div className={`notice bleed-${bleed.level}`} role="status" data-testid="ra-bleed">
                {bleed.level === 'none' ? <p className="ok-line"><Icon name="check" size={14} />{t.recAssist.bleedNone}</p> : (
                  <>
                    <p>{bleed.level === 'strong' ? t.recAssist.bleedStrong : t.recAssist.bleedMild}</p>
                    <div className="big-actions">
                      <button className="btn btn-primary" data-testid="ra-rerecord" onClick={() => void rec.record(realId ?? sec?.id ?? '')}>{t.recAssist.rerecord}</button>
                      <button className="btn btn-ghost" data-testid="ra-reduce" onClick={() => void rec.reduceLastBleed()}>{t.recAssist.reduce}</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
