import { useEffect, useMemo } from 'react';
import { useApp } from '../store/store';
import { useRec } from '../store/rec';
import { useFinal } from '../store/final';
import { usePlayer } from '../store/player';
import { arrangementFor, arrangementSettings, songLayout } from '../store/arrangeInput';
import { fxPreset } from '../store/finalMix';
import { engine } from '../audio/engine';
import { loadAudio } from '../store/audioCache';
import { t } from '../i18n/ro';
import { Empty, Slider } from './common';
import { Icon } from './icons';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function FxPanel() {
  const project = useApp((s) => s.project)!;
  const patch = useApp((s) => s.patchFx);
  const mode = useApp((s) => s.mode);
  const fx = arrangementSettings(project).fx ?? {};
  const pr = fxPreset(project);
  return (
    <section className="panel" aria-labelledby="p-fx">
      <div className="panel-head">
        <h2 id="p-fx">{t.final.fxTitle}</h2>
        <label className="check-row inline"><input type="checkbox" checked={fx.on !== false} onChange={(e) => patch({ on: e.target.checked })} /><span>{t.final.fxOn}</span></label>
      </div>
      <p className="hint">{t.final.fxHint(pr.name)}</p>
      {mode === 'pro' ? (
        <div className="fx-sliders">
          <Slider label={t.final.reverb} value={Math.round(pr.reverb.send * 100)} min={0} max={50} unit="%" onChange={(v) => patch({ reverb: v / 100 })} />
          <Slider label={t.final.delay} value={Math.round(pr.delay.send * 100)} min={0} max={40} unit="%" onChange={(v) => patch({ delay: v / 100 })} />
          <Slider label={t.final.duck} value={fx.duckDb ?? 3} min={0} max={6} step={0.5} unit=" dB" onChange={(v) => patch({ duckDb: v })} />
        </div>
      ) : <p className="hint">{t.final.fxProHint}</p>}
    </section>
  );
}

export function FinalView() {
  const project = useApp((s) => s.project)!;
  const del = useApp((s) => s.deleteFinalTake);
  const setComp = useApp((s) => s.setComp);
  const rec = useRec();
  const fin = useFinal();
  const toggle = usePlayer((s) => s.toggle);
  const setScope = usePlayer((s) => s.setScope);
  const arr = arrangementFor(project);
  const lay = useMemo(() => songLayout(project), [project]);
  const takes = project.final?.takes ?? [];
  const busy = fin.status !== 'idle';
  // live position while recording
  useEffect(() => { if (fin.status === 'idle') return; const id = setInterval(() => useFinal.setState({}), 200); return () => clearInterval(id); }, [fin.status]);

  if (!arr) return <section className="panel"><Empty title={t.final.emptyTitle} body={t.final.emptyBody} /></section>;

  const playTake = async (id: string) => {
    const tk = takes.find((x) => x.id === id);
    if (!tk) return;
    const a = await loadAudio(tk.audioId);
    if (!a) return;
    engine.stop();
    await engine.play({ from: 0, to: a.data.length / a.sr, loop: false, clips: [{ data: a.data, sr: a.sr, startSec: 0, durSec: a.data.length / a.sr }], tracks: [], bpm: project.bpm, sig: project.timeSig, metronome: false, levels: { voce: 0.9 } });
  };
  const pos = engine.position();

  return (
    <div className="stack final">
      <section className="panel">
        <div className="panel-head"><h2>{t.final.title}</h2></div>
        <p className="lede">{t.final.lede}</p>
        <div className="final-setup">
          <label className="field"><span className="label">{t.final.target}</span>
            <select value={fin.target} onChange={(e) => fin.setTarget(e.target.value)} disabled={busy}>
              <option value="song">{t.final.wholeSong}</option>
              {lay.sections.map((s) => <option key={s.id} value={s.id}>{t.final.punchIn(s.label)}</option>)}
            </select>
          </label>
          <label className="check-row"><input type="checkbox" checked={fin.guide} onChange={(e) => fin.setGuide(e.target.checked)} disabled={busy} /><span>{t.minus.guide}</span></label>
          <label className="check-row"><input type="checkbox" checked={fin.metronome} onChange={(e) => fin.setMetronome(e.target.checked)} disabled={busy} /><span>{t.minus.metronome}</span></label>
          <Slider label={t.rec.latency} value={rec.latencyMs} min={0} max={400} step={5} unit=" ms" onChange={rec.setLatency} hint={t.final.latencyHint} />
        </div>
        <p className="hint">{t.final.headphones}</p>
        <div className="rec-controls final-controls">
          {fin.status === 'idle' || fin.status === 'opening' ? (
            <button className="btn btn-rec" onClick={() => void fin.start()} disabled={fin.status === 'opening'}><Icon name="rec" size={18} />{fin.status === 'opening' ? t.rec.opening : t.final.start}</button>
          ) : (
            <>
              <span className={`final-state ${fin.status}`} role="status">
                {fin.status === 'countin' ? t.final.countin : fin.status === 'recording' ? t.final.recording : fin.status === 'paused' ? t.final.paused : t.common.saving}
                {(fin.status === 'recording' || fin.status === 'countin') && <b className="num"> {clock(Math.max(0, pos))}</b>}
              </span>
              {fin.status === 'paused'
                ? <button className="btn btn-primary" onClick={() => void fin.resume()}><Icon name="play" size={16} />{t.final.resume}</button>
                : <button className="btn btn-ghost" onClick={fin.pause} disabled={fin.status === 'saving'}><Icon name="pause" size={16} />{t.final.pause}</button>}
              <button className="btn btn-danger" onClick={() => void fin.stop()} disabled={fin.status === 'saving'}><Icon name="stop" size={16} />{t.final.stop}</button>
            </>
          )}
        </div>
        {fin.error && <p className="form-error" role="alert">{fin.error}</p>}
      </section>

      <section className="panel" aria-labelledby="p-takes">
        <div className="panel-head"><h2 id="p-takes">{t.final.takes}</h2></div>
        {!takes.length ? <p className="empty-line">{t.final.noTakes}</p> : (
          <ul className="take-list">
            {takes.map((tk) => (
              <li key={tk.id}>
                <span><strong>{tk.label}</strong><small className="muted"> · {clock(tk.range[0])}–{clock(tk.range[1])} · {tk.latencyMs} ms</small></span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => void playTake(tk.id)} aria-label={`${t.final.listen} ${tk.label}`}><Icon name="play" size={15} /></button>
                  <button className="icon-btn" onClick={() => del(tk.id)} aria-label={`${t.common.delete} ${tk.label}`}><Icon name="trash" size={15} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {takes.length > 0 && (
          <>
            <h3 className="sub-h">{t.final.comp}</h3>
            <p className="hint">{t.final.compHint}</p>
            <ul className="comp-list">
              {lay.sections.map((s) => {
                const cover = takes.filter((tk) => tk.range[0] <= s.startSec + s.durSec - 0.5 && tk.range[1] >= s.startSec + 0.5);
                return (
                  <li key={s.id}>
                    <label htmlFor={`comp-${s.id}`}>{s.label}</label>
                    <select id={`comp-${s.id}`} value={project.final?.comp[s.id] ?? ''} onChange={(e) => setComp(s.id, e.target.value || null)} disabled={!cover.length}>
                      <option value="">{t.final.noneChosen}</option>
                      {cover.map((tk) => <option key={tk.id} value={tk.id}>{tk.label}</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
            <div className="big-actions">
              <button className="btn btn-primary" onClick={() => { setScope('song'); engine.stop(); void toggle(); }}><Icon name="play" size={16} />{t.final.listenMix}</button>
            </div>
          </>
        )}
      </section>
      <FxPanel />
    </div>
  );
}
