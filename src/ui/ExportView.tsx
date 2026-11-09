import { useState } from 'react';
import { useApp } from '../store/store';
import { arrangementFor } from '../store/arrangeInput';
import { fileBase } from '../store/exportSong';
import { fullSongMidi } from '../store/arrangeInput';
import { sheetXml } from '../store/sheet';
import { downloadBlob } from '../music/wav';
import { t } from '../i18n/ro';
import { Empty, Progress } from './common';
import { Icon } from './icons';
import { useExporter } from './MinusUI';

/** Export dialog-as-a-view: mix / stems / minus WAV (24-bit), MIDI, MusicXML, print. Progress and cancel for the offline renders. */
export function ExportView({ onSheet }: { onSheet(): void }) {
  const project = useApp((s) => s.project)!;
  const arr = arrangementFor(project);
  const [rate, setRate] = useState<44100 | 48000>(44100);
  const ex = useExporter();
  if (!arr) return <section className="panel"><Empty title={t.minus.emptyTitle} body={t.minus.emptyBody} /></section>;
  const base = fileBase(project);
  const busy = ex.progress !== null;
  const run = (kind: 'mix' | 'minus', stems: boolean) => void ex.run(
    { kind, rate, stems, guide: false, countIn: false, metronome: false },
    (o) => { if (stems && o.stems) downloadBlob(o.stems.slice().buffer as ArrayBuffer, `${base}-piste.zip`, 'application/zip'); else downloadBlob(o.wav, `${base}${kind === 'minus' ? '-minus' : ''}.wav`, 'audio/wav'); },
  );
  const midi = () => { const m = fullSongMidi(project); if (m) downloadBlob(m, `${base}.mid`, 'audio/midi'); };
  const xml = () => { const x = sheetXml(project); if (x) downloadBlob(x, `${base}.musicxml`, 'application/vnd.recordare.musicxml+xml'); };
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>{t.exportM6.title}</h2></div>
        <p className="lede">{t.exportM6.lede}</p>
        <label className="field quick-num"><span className="label">{t.exportM6.rate}</span>
          <select value={rate} disabled={busy} onChange={(e) => setRate(Number(e.target.value) as 44100 | 48000)}><option value={44100}>44,1 kHz · 24 bit</option><option value={48000}>48 kHz · 24 bit</option></select>
        </label>
        <ul className="export-list">
          <li><div><strong>{t.exportM6.mix}</strong><small>{t.exportM6.mixHint}</small></div><button className="btn btn-primary" disabled={busy} onClick={() => run('mix', false)}><Icon name="export" size={16} />WAV</button></li>
          <li><div><strong>{t.exportM6.stems}</strong><small>{t.exportM6.stemsHint}</small></div><button className="btn btn-ghost" disabled={busy} onClick={() => run('mix', true)}><Icon name="export" size={16} />ZIP</button></li>
          <li><div><strong>{t.exportM6.minus}</strong><small>{t.minus.hint}</small></div><button className="btn btn-ghost" disabled={busy} onClick={() => run('minus', false)}><Icon name="export" size={16} />WAV</button></li>
          <li><div><strong>{t.exportM6.midi}</strong></div><button className="btn btn-ghost" onClick={midi}><Icon name="export" size={16} />MIDI</button></li>
          <li><div><strong>{t.exportM6.musicxml}</strong></div><button className="btn btn-ghost" onClick={xml}><Icon name="export" size={16} />MusicXML</button></li>
          <li><div><strong>{t.exportM6.print}</strong></div><button className="btn btn-ghost" onClick={onSheet}>{t.exportM6.sheet}</button></li>
        </ul>
        {busy && (
          <div className="export-run">
            <Progress label={t.exportM6.rendering(Math.round((ex.progress ?? 0) * 100))} value={ex.progress ?? 0} />
            <button className="btn btn-ghost btn-sm" onClick={ex.cancel}>{t.common.cancel}</button>
          </div>
        )}
        {ex.error && <p className="form-error" role="alert">{ex.error}</p>}
        {ex.last && <p className="hint ok-line"><Icon name="check" size={14} />{t.exportM6.done(ex.last.lufs.toFixed(1), ex.last.tp.toFixed(1), ex.last.sec.toFixed(1))}</p>}
        {ex.last?.audit && (
          <div className="audit" data-testid="audit" aria-live="polite">
            <h3 className="sub-h">{t.audit.title}</h3>
            {ex.last.audit.warnings.length === 0 && !ex.last.fallbacks?.length && <p className="hint ok-line"><Icon name="check" size={14} />{t.audit.ok}</p>}
            <ul className="audit-list">
              {(ex.last.fallbacks ?? []).map((n) => <li key={n} className="audit-item info">{t.audit.fallback(n)}</li>)}
              {ex.last.audit.warnings.map((w) => <li key={w.id} className={`audit-item ${w.level}`}>{t.audit[w.id]}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
