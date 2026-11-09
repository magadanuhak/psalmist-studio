import { useRef, useState } from 'react';
import { useApp } from '../store/store';
import { arrangementFor, arrangementSettings } from '../store/arrangeInput';
import { exportSong, fileBase, type ExportOpts, type ExportOut } from '../store/exportSong';
import { usePlayer } from '../store/player';
import { engine } from '../audio/engine';
import { downloadBlob } from '../music/wav';
import { keyName } from '../music/theory';
import { t } from '../i18n/ro';
import { Empty, Progress } from './common';
import { Icon } from './icons';

/** Runs an offline export with progress and cancel. */
export function useExporter() {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ lufs: number; tp: number; sec: number; audit?: import('../audio/audit').ExportAudit; fallbacks?: string[] } | null>(null);
  const sig = useRef<{ aborted: boolean }>({ aborted: false });
  const run = async (o: Omit<ExportOpts, 'onProgress' | 'signal'>, save: (out: ExportOut, base: string) => void) => {
    const p = useApp.getState().project;
    if (!p) return;
    sig.current = { aborted: false };
    setProgress(0); setError(null); setLast(null);
    try {
      const out = await exportSong(p, { ...o, onProgress: setProgress, signal: sig.current });
      setLast({ lufs: out.lufs, tp: out.truePeakDb, sec: out.seconds, audit: out.audit, fallbacks: out.fallbacks });
      save(out, fileBase(p));
    } catch (e) {
      if (!(e instanceof Error && e.message === 'aborted')) { console.error('[psalmist] export failed', e); setError(t.exportM6.errRender); }
    } finally { setProgress(null); }
  };
  return { progress, error, last, run, cancel: () => { sig.current.aborted = true; } };
}

export function MinusView() {
  const project = useApp((s) => s.project)!;
  const arr = arrangementFor(project);
  const preset = usePlayer((s) => s.preset);
  const setScope = usePlayer((s) => s.setScope);
  const [guide, setGuide] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [metro, setMetro] = useState(false);
  const [rate, setRate] = useState<44100 | 48000>(44100);
  const ex = useExporter();
  const semis = arrangementSettings(project).transpose ?? 0;
  if (!arr) return <section className="panel"><Empty title={t.minus.emptyTitle} body={t.minus.emptyBody} /></section>;
  const key = project.key ? keyName({ tonic: (project.key.tonic + semis + 120) % 12, mode: project.key.mode }, 'solfege') : '–';
  const listen = () => {
    setScope('song');
    preset('acc', ['voce', 'melodie', ...arr.tracks.map((x) => x.id)]);
    engine.stop();
    void usePlayer.getState().toggle();
  };
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>{t.minus.title}</h2></div>
        <p className="lede">{t.minus.lede}</p>
        <dl className="facts">
          <div><dt>{t.minus.key}</dt><dd>{key}{semis !== 0 && <small> ({semis > 0 ? '+' : ''}{semis})</small>}</dd></div>
          <div><dt>{t.minus.tempo}</dt><dd className="num">{project.bpm} BPM · {project.timeSig.num}/{project.timeSig.den}</dd></div>
          <div><dt>{t.minus.length}</dt><dd className="num">{Math.floor(arr.songSec / 60)}:{String(Math.floor(arr.songSec % 60)).padStart(2, '0')}</dd></div>
          <div><dt>{t.minus.instruments}</dt><dd>{arr.tracks.length}</dd></div>
        </dl>
        <fieldset className="quick-form">
          <legend>{t.minus.options}</legend>
          <div className="quick-grid">
            <label className="check-row"><input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /><span>{t.minus.guide}</span></label>
            <label className="check-row"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /><span>{t.minus.countIn}</span></label>
            <label className="check-row"><input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} /><span>{t.minus.metronome}</span></label>
            <label className="field quick-num"><span className="label">{t.exportM6.rate}</span>
              <select value={rate} onChange={(e) => setRate(Number(e.target.value) as 44100 | 48000)}><option value={44100}>44,1 kHz</option><option value={48000}>48 kHz</option></select>
            </label>
          </div>
        </fieldset>
        {ex.progress !== null ? (
          <div className="export-run">
            <Progress label={t.exportM6.rendering(Math.round(ex.progress * 100))} value={ex.progress} />
            <button className="btn btn-ghost btn-sm" onClick={ex.cancel}>{t.common.cancel}</button>
          </div>
        ) : (
          <div className="big-actions">
            <button className="btn btn-ghost btn-lg" onClick={listen}><Icon name="play" size={18} />{t.minus.listen}</button>
            <button className="btn btn-primary btn-lg" onClick={() => void ex.run({ kind: 'minus', rate, stems: false, guide, countIn, metronome: metro }, (o, b) => downloadBlob(o.wav, `${b}-minus.wav`, 'audio/wav'))}>
              <Icon name="export" size={18} />{t.minus.export}
            </button>
          </div>
        )}
        {ex.error && <p className="form-error" role="alert">{ex.error}</p>}
        {ex.last && <p className="hint ok-line"><Icon name="check" size={14} />{t.exportM6.done(ex.last.lufs.toFixed(1), ex.last.tp.toFixed(1), ex.last.sec.toFixed(1))}</p>}
        <p className="hint">{t.minus.hint}</p>
      </section>
    </div>
  );
}
