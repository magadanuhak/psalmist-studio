import { useEffect, useRef, useState } from 'react';
import { activeTake, useApp } from '../store/store';
import { useRec } from '../store/rec';
import { loadAudio } from '../store/audioCache';
import { fullSongMidi } from '../store/arrangeInput';
import { engine } from '../audio/engine';
import { t } from '../i18n/ro';
import { keyName, midiName, pcName, type NameStyle } from '../music/theory';
import { sectionMidi, songMidi } from '../music/midiExport';
import { downloadBlob, encodeWav } from '../music/wav';
import type { KeySig, QuantGrid, Section, Take } from '../model/types';
import { ConfirmDialog, Progress, Slider } from './common';
import { Icon } from './icons';

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'psalmist';

/* ------------------------------------------------------------------ Record */

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const segs = 24;
  return (
    <div className={`meter ${active ? '' : 'meter-off'}`} role="meter" aria-label={t.rec.level} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      {Array.from({ length: segs }, (_, i) => {
        const on = active && level * segs > i;
        const zone = i > segs * 0.85 ? 'hot' : i > segs * 0.6 ? 'warm' : 'ok';
        return <i key={i} className={`${on ? 'on' : ''} ${zone}`} />;
      })}
    </div>
  );
}

export function RecordPanel({ section }: { section: Section }) {
  const rec = useRec();
  const project = useApp((s) => s.project)!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const busy = rec.status === 'countin' || rec.status === 'recording' || rec.status === 'paused' || rec.status === 'saving' || rec.status === 'roomtone' || rec.status === 'calibrating';
  const micOn = rec.status !== 'idle' && rec.status !== 'opening';
  const beats = project.timeSig.num;

  useEffect(() => () => { /* keep mic open across sections; closed when leaving the studio */ }, []);

  const importFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) void rec.importFile(section.id, f);
  };

  return (
    <section className="panel" aria-labelledby="p-rec">
      <div className="panel-head">
        <h2 id="p-rec">{t.rec.title}</h2>
        {micOn && <button className="btn btn-quiet btn-sm" onClick={rec.closeMic} disabled={busy}>{t.rec.micOff}</button>}
      </div>

      {!micOn ? (
        <div className="mic-gate">
          <p>{t.rec.gateBody}</p>
          <button className="btn btn-primary btn-lg" onClick={() => void rec.openMic()} disabled={rec.status === 'opening'}>
            <Icon name="mic" size={18} />{rec.status === 'opening' ? t.rec.opening : t.rec.micOn}
          </button>
          {rec.error && <p className="form-error" role="alert">{rec.error}</p>}
          <p className="hint">{t.rec.privacy}</p>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="mic-dev">{t.rec.device}</label>
            <select id="mic-dev" value={rec.deviceId} onChange={(e) => void rec.setDevice(e.target.value)} disabled={busy}>
              {rec.devices.length === 0 && <option value="">{t.rec.defaultDevice}</option>}
              {rec.devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t.rec.device} ${i + 1}`}</option>)}
            </select>
          </div>
          <LevelMeter level={rec.level} active={micOn} />
          <p className={`hint ${rec.peak > 0.04 ? 'ok-line' : 'warn-line'}`} role="status">{rec.peak > 0.04 ? <><Icon name="check" size={14} />{t.rec.signalOk}</> : t.rec.noSignal}</p>
          <p className="hint">{t.rec.headphones}</p>

          <div className="rec-row">
            <div>
              <strong>{t.rec.roomTone}</strong>
              <p className="hint">{project.roomTone ? t.rec.roomToneHave : t.rec.roomToneHint}</p>
            </div>
            <button className="btn btn-ghost" onClick={() => void rec.captureRoomTone()} disabled={busy}>
              {rec.status === 'roomtone' ? t.rec.roomToneBusy : project.roomTone ? t.rec.roomToneAgain : t.rec.roomToneDo}
            </button>
          </div>

          <div className="rec-controls">
            {rec.status === 'countin' || rec.status === 'recording' || rec.status === 'paused' ? (
              <>
                <div className="rec-buttons">
                  {rec.status === 'paused' ? (
                    <button className="btn btn-rec" onClick={rec.resumeRecording} title="P"><Icon name="rec" size={18} />{t.rec.resume}</button>
                  ) : (
                    <button className="btn btn-ghost btn-lg" onClick={rec.pauseRecording} title="P"><Icon name="pause" size={18} />{t.rec.pause}</button>
                  )}
                  <button className="btn btn-rec recording" style={rec.status === 'paused' ? { animation: 'none' } : undefined} onClick={rec.stopRecording} title="R"><Icon name="stop" size={18} />{t.rec.stop}</button>
                </div>
                <div className="beats" aria-live="polite">
                  {Array.from({ length: beats }, (_, i) => {
                    const cur = rec.status === 'paused' ? -1 : rec.beatIndex >= 0 ? rec.beatIndex % beats : -1;
                    return <span key={i} className={`beat ${cur === i ? 'on' : ''} ${rec.status === 'countin' ? 'count' : ''}`}>{i + 1}</span>;
                  })}
                  <span className="beat-label">
                    {rec.status === 'countin' ? t.rec.countInBar(rec.barNumber) : rec.status === 'paused' ? t.rec.pausedAt(rec.barNumber) : t.rec.barOf(Math.min(section.bars, rec.barNumber), section.bars)}
                  </span>
                </div>
              </>
            ) : (
              <button className="btn btn-rec" onClick={() => void rec.record(section.id)} disabled={busy} title="R">
                <Icon name="rec" size={18} />{rec.status === 'saving' ? t.common.saving : t.rec.start}
              </button>
            )}
          </div>
          {(rec.status === 'countin' || rec.status === 'recording') && <p className="hint">{t.rec.autoStop(section.bars)}</p>}
          {rec.status === 'paused' && <p className="hint">{t.rec.pausedHint(rec.barNumber)}</p>}
          {rec.error && <p className="form-error" role="alert">{rec.error}</p>}

          <details className="more">
            <summary>{t.rec.advanced}</summary>
            <label className="chip-toggle block"><input type="checkbox" checked={rec.metronomeOn} onChange={(e) => rec.setMetronomeOn(e.target.checked)} /><span>{t.rec.metronome}</span></label>
            <Slider label={t.rec.clickVolume} value={Math.round(rec.clickVolume * 100)} min={0} max={100} unit="%" onChange={(v) => rec.setClickVolume(v / 100)} />
            <Slider label={t.rec.latency} value={rec.latencyMs} min={-100} max={400} step={1} unit=" ms" onChange={rec.setLatency} hint={t.rec.latencyHint} />
            <button className="btn btn-ghost" onClick={() => void rec.calibrate()} disabled={busy}>{rec.status === 'calibrating' ? t.rec.calibrating : t.rec.calibrate}</button>
            <p className="hint">{t.rec.calibrateHint}</p>
          </details>
        </>
      )}

      <div
        className={`dropzone ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); importFiles(e.dataTransfer.files); }}
      >
        <Icon name="import" size={18} />
        <span>{t.rec.dropHint}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>{t.rec.import}</button>
        <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.m4a" hidden data-testid="import-input" onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- Takes */

export function TakesPanel({ section }: { section: Section }) {
  const setActive = useApp((s) => s.setActiveTake);
  const del = useApp((s) => s.deleteTake);
  const busy = useApp((s) => s.busy);
  const voiceSource = useApp((s) => s.voiceSource);
  const setVoiceSource = useApp((s) => s.setVoiceSource);
  const [confirm, setConfirm] = useState<Take | null>(null);
  const take = activeTake(section);

  return (
    <section className="panel" aria-labelledby="p-takes">
      <div className="panel-head"><h2 id="p-takes">{t.takes.title}</h2></div>
      {section.takes.length === 0 ? (
        <p className="empty-line">{t.takes.empty}</p>
      ) : (
        <ul className="takes">
          {section.takes.map((tk) => (
            <li key={tk.id} className={tk.id === section.activeTakeId ? 'active' : ''}>
              <label className="take-pick">
                <input type="radio" name={`take-${section.id}`} checked={tk.id === section.activeTakeId} onChange={() => { engine.stop(); setActive(section.id, tk.id); }} />
                <span className="take-name">{tk.label}</span>
                <span className="num take-dur">{formatTime(tk.durationSec)}</span>
              </label>
              <span className="take-tags">
                <span className="tag">{tk.source === 'mic' ? t.takes.mic : t.takes.file}</span>
                {tk.cleanAudioId && <span className="tag tag-ok">{t.takes.cleaned}</span>}
                {tk.analysis && <span className="tag tag-ok">{t.takes.analyzed}</span>}
                {busy[tk.id] && <span className="tag tag-busy">{busy[tk.id].label}</span>}
              </span>
              <button className="icon-btn danger" onClick={() => setConfirm(tk)} aria-label={`${t.takes.delete}: ${tk.label}`}><Icon name="trash" size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      {take?.cleanAudioId && (
        <div className="ab" role="group" aria-label={t.takes.ab}>
          <span className="ab-label">{t.takes.listen}</span>
          <div className="seg">
            <button className={voiceSource === 'raw' ? 'on' : ''} aria-pressed={voiceSource === 'raw'} onClick={() => setVoiceSource('raw')}>{t.takes.raw}</button>
            <button className={voiceSource === 'clean' ? 'on' : ''} aria-pressed={voiceSource === 'clean'} onClick={() => setVoiceSource('clean')}>{t.takes.clean}</button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm} title={t.takes.deleteTitle} body={t.takes.deleteBody(confirm?.label ?? '')} confirmLabel={t.takes.delete}
        onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm) { engine.stop(); del(section.id, confirm.id); } setConfirm(null); }}
      />
    </section>
  );
}

export const formatTime = (s: number) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

/* ----------------------------------------------------------------- Process */

export function ProcessPanel({ section, take }: { section: Section; take: Take | null }) {
  const run = useApp((s) => s.runAll);
  const clean = useApp((s) => s.runClean);
  const analyze = useApp((s) => s.runAnalyze);
  const busy = useApp((s) => (take ? s.busy[take.id] : undefined));
  const roomTone = useApp((s) => s.project?.roomTone);
  return (
    <section className="panel" aria-labelledby="p-proc">
      <div className="panel-head"><h2 id="p-proc">{t.proc.title}</h2></div>
      {!take ? <p className="empty-line">{t.proc.needTake}</p> : (
        <>
          <ol className="proc-steps">
            <li className={take.cleanAudioId ? 'done' : ''}>
              <div><strong>{t.steps.clean}</strong><p className="hint">{t.proc.cleanHint}{take.cleanAudioId ? ` ${roomTone ? t.proc.usedRoom : t.proc.usedAuto}` : ''}</p></div>
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => void clean(section.id, take.id)}>{take.cleanAudioId ? t.proc.redo : t.steps.clean}</button>
            </li>
            <li className={take.analysis ? 'done' : ''}>
              <div><strong>{t.steps.analyze}</strong><p className="hint">{t.proc.analyzeHint}</p></div>
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => void analyze(section.id, take.id)}>{take.analysis ? t.proc.redo : t.steps.analyze}</button>
            </li>
          </ol>
          {busy && <Progress label={busy.label} />}
          {!take.analysis && <button className="btn btn-primary" disabled={!!busy} onClick={() => void run(section.id, take.id)}><Icon name="wand" size={16} />{t.proc.all}</button>}
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- Key */

const TONICS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function KeyPanel({ take }: { take: Take | null }) {
  const project = useApp((s) => s.project)!;
  const setKey = useApp((s) => s.setKey);
  const setLocked = useApp((s) => s.setKeyLocked);
  const style = useApp((s) => s.noteStyle);
  const est = take?.analysis?.keyEstimate ?? null;
  const key = project.key;
  const pct = est ? Math.round(est.confidence * 100) : 0;
  const same = (a: KeySig, b: KeySig) => a.tonic === b.tonic && a.mode === b.mode;
  return (
    <section className="panel" aria-labelledby="p-key">
      <div className="panel-head">
        <h2 id="p-key">{t.key.title}</h2>
        {key && (
          <label className="chip-toggle" title={t.key.lockHint}>
            <input type="checkbox" checked={project.keyLocked} onChange={(e) => setLocked(e.target.checked)} />
            <span><Icon name={project.keyLocked ? 'check' : 'plus'} size={13} />{project.keyLocked ? t.key.locked : t.key.unlocked}</span>
          </label>
        )}
      </div>
      <p className="key-now">{key ? <><span className="key-big">{keyName(key, style)}</span></> : <span className="muted">{t.key.none}</span>}</p>
      <div className="key-edit">
        <div className="field">
          <label htmlFor="k-tonic">{t.key.tonic}</label>
          <select id="k-tonic" value={key?.tonic ?? ''} onChange={(e) => setKey({ tonic: Number(e.target.value), mode: key?.mode ?? 'major' })}>
            {!key && <option value="" disabled>-</option>}
            {TONICS.map((p) => <option key={p} value={p}>{pcName(p, style)}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label">{t.key.mode}</span>
          <div className="seg" role="group" aria-label={t.key.mode}>
            <button className={key?.mode === 'major' ? 'on' : ''} aria-pressed={key?.mode === 'major'} onClick={() => setKey({ tonic: key?.tonic ?? 0, mode: 'major' })}>{t.key.major}</button>
            <button className={key?.mode === 'minor' ? 'on' : ''} aria-pressed={key?.mode === 'minor'} onClick={() => setKey({ tonic: key?.tonic ?? 0, mode: 'minor' })}>{t.key.minor}</button>
          </div>
        </div>
      </div>
      {est?.ambiguous && <p className="notice" role="status">{t.key.ambiguous(keyName(est.top3[0], style), keyName(est.top3[1], style))}</p>}
      {est ? (
        <div className="estimate">
          <div className="conf" role="img" aria-label={t.key.confidence(pct)}>
            <div className="conf-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="hint">{t.key.detected(keyName(est, style), pct)}</p>
          <div className="alts" role="group" aria-label={t.key.alternatives}>
            {est.top3.map((c, i) => (
              <button key={i} className={`chip ${key && same(key, c) ? 'on' : ''}`} onClick={() => setKey({ tonic: c.tonic, mode: c.mode })}>
                {keyName(c, style)}
              </button>
            ))}
          </div>
        </div>
      ) : <p className="hint">{t.key.needAnalysis}</p>}
      <p className="hint">{t.key.lockHint}</p>
    </section>
  );
}

/* -------------------------------------------------------------- Correction */

const GRIDS: QuantGrid[] = ['1/4', '1/8', '1/16', '1/8T'];

export function CorrectionPanel({ section, take }: { section: Section; take: Take | null }) {
  const setCorr = useApp((s) => s.setCorrection);
  const reapply = useApp((s) => s.reapplyCorrection);
  const viewNotes = useApp((s) => s.viewNotes);
  const setView = useApp((s) => s.setViewNotes);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const c = take?.correction;
  return (
    <section className="panel" aria-labelledby="p-corr">
      <div className="panel-head">
        <h2 id="p-corr">{t.corr.title}</h2>
        <div className="head-tools">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label={t.common.undo} title="Ctrl+Z"><Icon name="undo" size={16} /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label={t.common.redo} title="Ctrl+Y"><Icon name="redo" size={16} /></button>
        </div>
      </div>
      {!take || !take.analysis || !c ? <p className="empty-line">{t.corr.needAnalysis}</p> : (
        <>
          <div className="ab" role="group" aria-label={t.corr.ab}>
            <span className="ab-label">{t.corr.compare}</span>
            <div className="seg">
              <button className={viewNotes === 'original' ? 'on' : ''} aria-pressed={viewNotes === 'original'} onClick={() => setView('original')}>{t.corr.original}</button>
              <button className={viewNotes === 'corrected' ? 'on' : ''} aria-pressed={viewNotes === 'corrected'} onClick={() => setView('corrected')}>{t.corr.corrected}</button>
            </div>
          </div>
          <label className="chip-toggle block"><input type="checkbox" checked={c.snapToKey} onChange={(e) => setCorr(section.id, take.id, { snapToKey: e.target.checked })} /><span>{t.corr.snap}</span></label>
          <p className="hint">{t.corr.snapHint}</p>
          <Slider label={t.corr.strength} value={c.quantizeStrength} min={0} max={100} unit="%" onChange={(v) => setCorr(section.id, take.id, { quantizeStrength: v })} hint={t.corr.strengthHint} />
          <div className="field">
            <span className="label">{t.corr.grid}</span>
            <div className="seg" role="group" aria-label={t.corr.grid}>
              {GRIDS.map((g) => <button key={g} className={c.grid === g ? 'on' : ''} aria-pressed={c.grid === g} onClick={() => setCorr(section.id, take.id, { grid: g })}>{t.corr.grids[g]}</button>)}
            </div>
          </div>
          <label className="chip-toggle block"><input type="checkbox" checked={c.swing} onChange={(e) => setCorr(section.id, take.id, { swing: e.target.checked })} /><span>{t.corr.swing}</span></label>
          <label className="chip-toggle block"><input type="checkbox" checked={c.cleanup} onChange={(e) => setCorr(section.id, take.id, { cleanup: e.target.checked })} /><span>{t.corr.cleanup}</span></label>
          {take.manuallyEdited && (
            <div className="notice" role="status">
              <p>{t.corr.edited}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => reapply(section.id, take.id)}>{t.corr.reapply}</button>
            </div>
          )}
          <button className="btn btn-quiet" onClick={() => reapply(section.id, take.id, true)}>{t.corr.reset}</button>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Analysis */

export function AnalysisSummary({ take }: { take: Take | null }) {
  const style = useApp((s) => s.noteStyle);
  const setTuningMode = useApp((s) => s.setTuningMode);
  const a = take?.analysis;
  if (!take || !a) return null;
  const n = take.notesCorrected.length;
  const unstable = (a.tuningConcentration ?? 1) < 0.3;
  const cents = a.tuningCents ?? 0;
  const mode = take.tuningMode ?? 'follow';
  return (
    <>
    <dl className="facts">
      <div><dt>{t.analysis.notes}</dt><dd className="num">{n}</dd></div>
      <div><dt>{t.analysis.range}</dt><dd>{a.rangeMidi ? `${midiName(a.rangeMidi.lo, style)} – ${midiName(a.rangeMidi.hi, style)}` : '–'}</dd></div>
      <div><dt>{t.analysis.pauses}</dt><dd className="num">{a.pauses.length}</dd></div>
      <div><dt>{t.analysis.length}</dt><dd className="num">{formatTime(take.durationSec)}</dd></div>
    </dl>
    <div className="tuning-row">
      <p className="tuning-now">
        <strong>{t.analysis.tuning}:</strong> {unstable ? t.analysis.tuningUnstable : cents === 0 ? t.analysis.tuningOk : t.analysis.tuningCents(cents)}
      </p>
      {!unstable && cents !== 0 && (
        <div className="seg seg-sm" role="group" aria-label={t.analysis.tuning}>
          <button className={mode === 'follow' ? 'on' : ''} aria-pressed={mode === 'follow'} onClick={() => setTuningMode(take.id, 'follow')} title={t.analysis.tuningFollowHint}>{t.analysis.tuningFollow}</button>
          <button className={mode === 'a440' ? 'on' : ''} aria-pressed={mode === 'a440'} onClick={() => setTuningMode(take.id, 'a440')} title={t.analysis.tuningA440Hint}>{t.analysis.tuningA440}</button>
        </div>
      )}
    </div>
    </>
  );
}

/* ------------------------------------------------------------------ Export */

export function ExportPanel({ section }: { section: Section }) {
  const project = useApp((s) => s.project)!;
  const take = activeTake(section);
  const notify = useApp((s) => s.notify);
  const naming = useApp((s) => s.chordNaming);
  const idx = project.sections.findIndex((s) => s.id === section.id);
  const hasNotes = !!take && (take.notesCorrected.length > 0 || take.notesOriginal.length > 0);
  const anyNotes = project.sections.some((s) => s.takes.some((tk) => tk.notesCorrected.length || tk.notesOriginal.length));
  const [wavBusy, setWavBusy] = useState(false);

  const exportWav = async () => {
    if (!take) return;
    setWavBusy(true);
    try {
      const a = await loadAudio(take.cleanAudioId ?? take.rawAudioId);
      if (!a) throw new Error('missing');
      downloadBlob(encodeWav(a.data, a.sr), `${slug(project.name)}-${slug(section.label)}-${take.cleanAudioId ? 'curat' : 'brut'}.wav`, 'audio/wav');
    } catch { notify('error', t.export.errWav); } finally { setWavBusy(false); }
  };

  return (
    <section className="panel" aria-labelledby="p-exp">
      <div className="panel-head"><h2 id="p-exp">{t.export.title}</h2></div>
      <div className="export-actions">
        <button className="btn btn-ghost" disabled={!hasNotes} onClick={() => downloadBlob(sectionMidi(project, idx, naming), `${slug(project.name)}-${slug(section.label)}.mid`, 'audio/midi')}>
          <Icon name="export" size={16} />{t.export.sectionMidi}
        </button>
        <button className="btn btn-ghost" disabled={!anyNotes} onClick={() => downloadBlob(fullSongMidi(project) ?? songMidi(project, naming), `${slug(project.name)}.mid`, 'audio/midi')}>
          <Icon name="export" size={16} />{t.export.songMidi}
        </button>
        <button className="btn btn-ghost" disabled={!take || wavBusy} onClick={() => void exportWav()}>
          <Icon name="export" size={16} />{take?.cleanAudioId ? t.export.wavClean : t.export.wavRaw}
        </button>
      </div>
      <p className="hint">{hasNotes ? t.export.hint : t.export.needNotes}</p>
    </section>
  );
}

export type { NameStyle };
