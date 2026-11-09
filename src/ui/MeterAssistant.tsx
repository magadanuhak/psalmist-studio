import { useEffect, useMemo, useRef, useState } from 'react';
import { activeTake, currentSection, useApp } from '../store/store';
import { loadAudio } from '../store/audioCache';
import { engine } from '../audio/engine';
import { detectMeter, type MeterOption, type TapIn } from '../dsp/meter';
import { barSec } from '../music/timesig';
import { t } from '../i18n/ro';
import { Icon } from './icons';

const barLen = (o: MeterOption) => barSec(o.bpm, o.sig);

/** "Nu știu tempoul / măsura": taps (optional) + vocal onsets -> top 2 meters, listen with an accented "1", apply and align. */
export function MeterAssistant({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const sec = useApp(currentSection);
  const realId = useApp((s) => s.sectionId);
  const applyMeter = useApp((s) => s.applyMeter);
  const take = activeTake(sec);
  const [taps, setTaps] = useState<TapIn[]>([]);
  const [tapping, setTapping] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(false);
  const t0 = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const result = useMemo(() => {
    if (!take?.notesOriginal.length) return null;
    return detectMeter({ notes: take.notesOriginal.map((n) => ({ startSec: n.startSec, durSec: n.durSec, midi: n.midi, velocity: n.velocity })), taps });
  }, [take, taps]);

  const playVoice = async (opt?: MeterOption) => {
    if (!take) return;
    const a = await loadAudio(take.cleanAudioId ?? take.rawAudioId);
    if (!a) return;
    const dur = a.data.length / a.sr;
    t0.current = performance.now();
    await engine.play({
      from: 0, to: dur, loop: false, clips: [{ data: a.data, sr: a.sr, startSec: 0, durSec: dur }], tracks: [],
      bpm: opt?.bpm ?? 90, sig: opt?.sig ?? { num: 4, den: 4, grouping: [4] }, metronome: !!opt,
      levels: { voce: 0.9, metro: 0.5 }, metroOffset: opt ? opt.firstDownbeatSec + nudge / 1000 : 0,
    });
  };

  const tap = (down = false) => {
    if (!tapping) return;
    setTaps((x) => [...x, { t: engine.position(), down }]);
  };
  useEffect(() => {
    if (!open || !tapping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); setTaps((x) => [...x, { t: engine.position() }]); }
      if (e.key === '1') { e.preventDefault(); e.stopPropagation(); setTaps((x) => [...x, { t: engine.position(), down: true }]); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, tapping]);

  const close = () => { engine.stop(); setTapping(false); onClose(); };
  const use = async (o: MeterOption) => {
    if (!take || !realId) return;
    setBusy(true);
    engine.stop();
    await applyMeter({ bpm: o.bpm, sig: o.sig, bars: o.bars, sectionId: realId, takeId: take.id, shiftSec: (o.pickupSec > 0 ? barLen(o) : 0) - (o.firstDownbeatSec + nudge / 1000) });
    setBusy(false);
    close();
  };

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="dialog-body meter-dialog">
        <div className="panel-head"><h2>{t.tempo.title}</h2><button className="icon-btn" onClick={close} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <p className="lede">{t.tempo.lede}</p>
        {!take?.notesOriginal.length ? (
          <p className="notice">{t.tempo.needAnalysis}</p>
        ) : (
          <>
            <div className="tap-box">
              <button className={`btn ${tapping ? 'btn-ghost' : 'btn-primary'}`} onClick={() => { if (tapping) { engine.stop(); setTapping(false); } else { setTaps([]); setTapping(true); void playVoice(); } }}>
                <Icon name={tapping ? 'stop' : 'play'} size={16} />{tapping ? t.tempo.stopTap : t.tempo.startTap}
              </button>
              <button className="tap-pad" disabled={!tapping} onClick={() => tap()} aria-label={t.tempo.pad}>{t.tempo.pad}<small>{t.tempo.padHint}</small></button>
              <button className="btn btn-ghost" disabled={!tapping} onClick={() => tap(true)}>{t.tempo.one}</button>
              <span className="muted">{t.tempo.taps(taps.length)}</span>
            </div>
            <p className="hint">{t.tempo.optional}</p>
            {result ? (
              <div className="meter-options">
                {result.options.map((o, i) => (
                  <article key={o.id} className={`meter-card ${i === 0 ? 'top' : ''}`}>
                    <header><strong>{o.label}</strong><span className="conf">{Math.round(o.confidence * 100)}%</span>{i === 0 && <em>{t.tempo.best}</em>}</header>
                    <p className="meter-nums num">{o.bpm} BPM · {o.bars} {t.setup.barsUnit}</p>
                    {o.pickupSec > 0 && <p className="hint">{t.tempo.pickup(o.pickupSec.toFixed(1))}</p>}
                    <p>{o.explanation}</p>
                    <div className="meter-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => void playVoice(o)}><Icon name="metro" size={14} />{t.tempo.listen}</button>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void use(o)}>{busy ? t.common.saving : t.tempo.use}</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="notice">{t.tempo.noResult}</p>}
            {result && (
              <label className="field nudge">
                <span className="label">{t.tempo.nudge}: {nudge > 0 ? '+' : ''}{nudge} ms</span>
                <input type="range" min={-300} max={300} step={10} value={nudge} onChange={(e) => setNudge(Number(e.target.value))} />
                <span className="hint">{t.tempo.nudgeHint}</span>
              </label>
            )}
          </>
        )}
        <div className="dialog-actions"><button className="btn btn-quiet" onClick={close}>{t.common.close}</button></div>
      </div>
    </dialog>
  );
}
