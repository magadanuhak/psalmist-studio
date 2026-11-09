import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { arrangementSettings } from '../store/arrangeInput';
import { effectiveSection, sectionRole } from '../model/sections';
import { t } from '../i18n/ro';
import { analyzeVoice, mergeReports, noteIntonation, recommendKey, VOICE_LABEL, type ReportInput } from '../dsp/voiceReport';
import { keyName, midiName } from '../music/theory';
import type { Note, Section, Take } from '../model/types';
import { Empty } from './common';
import { Icon } from './icons';

function takeOf(s: Section): Take | null {
  return s.takes.find((x) => x.id === s.activeTakeId) ?? null;
}

/** Notes coloured by intonation on a small piano roll (flat / in tune / sharp). */
function IntonationRoll({ notes }: { notes: Note[] }) {
  if (!notes.length) return null;
  const lo = Math.min(...notes.map((n) => n.midi)) - 2, hi = Math.max(...notes.map((n) => n.midi)) + 2;
  const end = Math.max(...notes.map((n) => n.startSec + n.durSec));
  const W = 900, H = 190, rowH = H / (hi - lo + 1);
  const color = { ok: 'var(--ok)', flat: 'var(--glass-sapphire)', sharp: 'var(--ember)' } as const;
  return (
    <figure className="into-roll">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.report.rollLabel} preserveAspectRatio="none">
        {Array.from({ length: hi - lo + 1 }, (_, i) => {
          const m = hi - i;
          return <line key={m} x1="0" x2={W} y1={i * rowH} y2={i * rowH} stroke="var(--line-soft)" strokeWidth={m % 12 === 0 ? 1.2 : 0.5} />;
        })}
        {notes.map((n) => (
          <rect key={n.id} x={(n.startSec / end) * W} y={(hi - n.midi) * rowH + 1} width={Math.max(3, (n.durSec / end) * W - 1)} height={rowH - 2} rx={2}
            fill={color[noteIntonation(n)]} opacity={0.5 + Math.min(0.5, n.confidence * 0.5)}>
            <title>{`${midiName(n.midi, 'solfege')} ${n.centsDev > 0 ? '+' : ''}${n.centsDev} ${t.report.cents}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="into-legend">
        <span><i style={{ background: color.flat }} />{t.report.flat}</span>
        <span><i style={{ background: color.ok }} />{t.report.inTune}</span>
        <span><i style={{ background: color.sharp }} />{t.report.sharp}</span>
        <span className="muted">{midiName(lo + 2, 'solfege')} – {midiName(hi - 2, 'solfege')}</span>
      </figcaption>
    </figure>
  );
}

export function VoiceReportView() {
  const project = useApp((s) => s.project)!;
  const sectionId = useApp((s) => s.sectionId);
  const setTranspose = useApp((s) => s.setTranspose);
  const [scope, setScope] = useState<'section' | 'song'>('song');
  const current = arrangementSettings(project).transpose ?? 0;

  const input = useMemo((): ReportInput | null => {
    const takes = project.sections.filter((s) => sectionRole(s) === 'source' || s.takes.length).map((s) => ({ s, tk: takeOf(effectiveSection(project, s)) })).filter((x): x is { s: Section; tk: Take } => !!x.tk && x.tk.notesOriginal.length > 0);
    const mk = (tk: Take): ReportInput => ({ notes: tk.notesOriginal, analysis: tk.analysis ?? null, bpm: project.bpm });
    if (scope === 'section') {
      const sel = project.sections.find((s) => s.id === sectionId);
      const tk = sel ? takeOf(effectiveSection(project, sel)) : null;
      return tk && tk.notesOriginal.length ? mk(tk) : null;
    }
    const uniq = [...new Map(takes.map((x) => [x.tk.id, x.tk])).values()];
    return uniq.length ? mergeReports(uniq.map(mk)) : null;
  }, [project, sectionId, scope]);

  const report = useMemo(() => (input ? analyzeVoice(input) : null), [input]);
  if (!report || !input) {
    return <section className="panel"><Empty title={t.report.emptyTitle} body={t.report.emptyBody} /></section>;
  }
  const adv = recommendKey(report, project.key);
  const r = report;
  const note = (m: number) => midiName(m, 'solfege');
  return (
    <div className="stack report">
      <section className="panel">
        <div className="panel-head">
          <h2>{t.report.title}</h2>
          <div className="seg seg-sm" role="group" aria-label={t.report.scope}>
            <button className={scope === 'section' ? 'on' : ''} aria-pressed={scope === 'section'} onClick={() => setScope('section')}>{t.report.scopeSection}</button>
            <button className={scope === 'song' ? 'on' : ''} aria-pressed={scope === 'song'} onClick={() => setScope('song')}>{t.report.scopeSong}</button>
          </div>
        </div>
        <p className="lede report-type">
          {r.voiceType ? <>{t.report.youAre} <strong>{VOICE_LABEL[r.voiceType]}</strong>{r.range && <> · {note(r.range.lo)} – {note(r.range.hi)}</>}</> : t.report.noType}
        </p>
        <dl className="facts report-facts">
          <div><dt>{t.report.range}</dt><dd>{r.range ? `${note(r.range.lo)} – ${note(r.range.hi)}` : '–'}</dd></div>
          <div><dt>{t.report.tessitura}</dt><dd>{r.tessitura ? `${note(r.tessitura.lo)} – ${note(r.tessitura.hi)}` : '–'}</dd></div>
          <div><dt>{t.report.intonation}</dt><dd>{Math.round(r.intonation.meanAbsCents)} {t.report.cents} · {Math.round(r.intonation.withinTolerancePct)}% {t.report.inTuneShort}</dd></div>
          <div><dt>{t.report.tuning}</dt><dd>{r.intonation.globalCents > 0 ? '+' : ''}{r.intonation.globalCents} {t.report.cents}</dd></div>
          <div><dt>{t.report.timing}</dt><dd>{Math.round(r.timing.meanAbsMs)} ms ({t.report.max} {Math.round(r.timing.maxAbsMs)})</dd></div>
          <div><dt>{t.report.vibrato}</dt><dd>{r.stability.vibratoHz ? `${r.stability.vibratoHz.toFixed(1)} Hz · ±${Math.round(r.stability.vibratoCents ?? 0)} ${t.report.cents}` : t.report.none}</dd></div>
          <div><dt>{t.report.drift}</dt><dd>{Math.round(r.stability.driftCentsPerSec)} {t.report.centsPerSec}</dd></div>
          <div><dt>{t.report.breath}</dt><dd>{r.breath.pauses} · {t.report.longest} {r.breath.longestSec.toFixed(1)} s</dd></div>
          <div><dt>{t.report.dynamics}</dt><dd>{Math.round(r.dynamics.rangeDb)} dB</dd></div>
        </dl>
        <IntonationRoll notes={input.notes} />
      </section>

      <section className="panel key-advice" aria-labelledby="p-adv">
        <div className="panel-head"><h2 id="p-adv">{t.report.adviceTitle}</h2></div>
        <p className="lede">{adv.reason}</p>
        <div className="adv-row">
          <div className="adv-key">
            <span className="muted">{t.report.now}</span>
            <strong>{project.key ? keyName({ tonic: (project.key.tonic + current + 120) % 12, mode: project.key.mode }, 'solfege') : '–'}</strong>
            {current !== 0 && <em>{current > 0 ? '+' : ''}{current} {t.report.semitones}</em>}
          </div>
          <Icon name="down" size={18} aria-hidden="true" />
          <div className="adv-key rec">
            <span className="muted">{t.report.recommended}</span>
            <strong>{adv.newKey ? keyName(adv.newKey, 'solfege') : '–'}</strong>
            <em>{adv.semitones > 0 ? '+' : ''}{adv.semitones} {t.report.semitones}</em>
          </div>
          <div className="adv-actions">
            <button className="btn btn-primary" disabled={adv.semitones === current} onClick={() => setTranspose(adv.semitones)}>
              <Icon name="wand" size={16} />{adv.semitones === current ? t.report.applied : t.report.transpose}
            </button>
            {current !== 0 && <button className="btn btn-ghost" onClick={() => setTranspose(0)}>{t.report.original}</button>}
          </div>
        </div>
        <p className="hint">{t.report.transposeHint}</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>{t.report.tipsTitle}</h2></div>
        <ul className="tips">{r.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
      </section>
    </div>
  );
}
