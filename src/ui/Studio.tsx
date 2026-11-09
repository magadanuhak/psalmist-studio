import { useEffect, useRef, useState } from 'react';
import { activeTake, currentSection, selectedSection, useApp } from '../store/store';
import { effectiveSection, sectionRole } from '../model/sections';
import { useRec } from '../store/rec';
import { usePlayer, pickSection } from '../store/player';
import { engine } from '../audio/engine';
import { t } from '../i18n/ro';
import { CHRISTIAN_EMOTIONS, EMOTIONS, GENRES, SECTION_COLOR, SECTION_TYPES } from '../model/presets';
import { keyName } from '../music/theory';
import { timeSigId } from '../music/timesig';
import type { Section, Take } from '../model/types';
import { Icon } from './icons';
import { Empty, Progress } from './common';
import { ChordPanel, ChordPopover, ChordStrip } from './ChordUI';
import { PianoRoll } from './PianoRoll';
import { ChipGroup, MeterFields, QuickForm, StructureEditor } from './ProjectForm';
import {
  AnalysisSummary, CorrectionPanel, ExportPanel, KeyPanel, ProcessPanel, RecordPanel, TakesPanel,
} from './panels';
import { Transport } from './Transport';
import { ArrangePanel } from './ArrangeUI';
import { VoiceReportView } from './VoiceReportUI';
import { MinusView } from './MinusUI';
import { MixerBody } from './Transport';
import { FxPanel } from './FinalUI';
import { FinalView } from './FinalUI';
import { SheetView } from './SheetUI';
import { ExportView } from './ExportView';
import { MeterAssistant } from './MeterAssistant';
import { RecAssistant } from './RecAssistant';
import { AutotuneView } from './AutotuneUI';
import { TrainerView } from './TrainerUI';
import { AiCleanButtons, AiVariantNote, AssistantDialog, PitchEngineToggle, useAiStatus } from './AiUI';
import { HelpDialog, Onboarding } from './Onboarding';

type Tab = 'voce' | 'acorduri' | 'aranjament' | 'mix' | 'export';
const TABS: Tab[] = ['voce', 'acorduri', 'aranjament', 'mix', 'export'];
/** Voce › Curățare: classic, AI and "Restaurare AI" with A/B */
function CleanView() {
  const sec = useApp(selectedSection);
  const clean = useApp((s) => s.runClean);
  const take = sec ? activeTake(sec) : null;
  if (!sec || !take) return <section className="panel"><p className="lede">{t.tabs.cleanNeed}</p></section>;
  return (
    <section className="panel big-step" data-testid="clean-view">
      <h2>{t.tabs.voceSub.clean}</h2>
      <p className="lede">{t.tabs.cleanBody}</p>
      <div className="big-actions">
        <button className="btn btn-primary btn-lg" onClick={() => void clean(sec.id, take.id)}><Icon name="wand" size={18} />{take.cleanIds?.classic ? t.proc.redo : t.steps.clean}</button>
      </div>
      <AiCleanButtons sectionId={sec.id} take={take} restore />
      <p className="hint">{t.ai.restoreHint}</p>
    </section>
  );
}

const SUBS: Record<Tab, string[]> = { voce: ['flow', 'clean', 'autotune', 'report', 'practice', 'final'], acorduri: [], aranjament: [], mix: [], export: ['export', 'minus', 'sheet'] };
/** tab state lives in the URL hash: #/p/<id>/<tab>[/<sub>] */
function parseTabHash(): { tab: Tab; sub: string } {
  const m = /^#\/p\/[^/]+\/([a-z]+)(?:\/([a-z]+))?/.exec(location.hash);
  const tab = (TABS as string[]).includes(m?.[1] ?? '') ? (m![1] as Tab) : 'voce';
  return { tab, sub: m?.[2] && SUBS[tab].includes(m[2]) ? m[2] : SUBS[tab][0] ?? '' };
}
function useTabHash(projectId: string | undefined) {
  const [st, setSt] = useState(parseTabHash);
  useEffect(() => { const on = () => setSt(parseTabHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const go = (tab: Tab, sub?: string) => { if (projectId) location.hash = '#/p/' + projectId + '/' + tab + (sub ? '/' + sub : ''); };
  return { ...st, go };
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const project = useApp((s) => s.project)!;
  const patch = useApp((s) => s.patchProject);
  const addSection = useApp((s) => s.addSection);
  const removeSection = useApp((s) => s.removeSection);
  const moveSection = useApp((s) => s.moveSection);
  const patchSection = useApp((s) => s.patchSection);
  const applyTypes = useApp((s) => s.applyStructureTypes);
  const [name, setName] = useState(project.name);
  useEffect(() => { setName(project.name); }, [project.name, open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-body">
        <div className="panel-head"><h2>{t.settings.title}</h2><button className="icon-btn" onClick={onClose} aria-label={t.common.close}><Icon name="close" size={16} /></button></div>
        <div className="field">
          <label htmlFor="s-name">{t.setup.name}</label>
          <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== project.name && patch({ name: name.trim() })} maxLength={80} />
        </div>
        <div className="field"><span className="label">{t.setup.genre}</span>
          <ChipGroup label={t.setup.genre} value={project.genre} options={GENRES} onChange={(genre) => patch({ genre })} labels={t.genres} />
        </div>
        <div className="field"><span className="label">{t.setup.emotion}</span>
          <ChipGroup label={t.setup.emotion} value={project.emotion} options={[...CHRISTIAN_EMOTIONS, ...EMOTIONS.filter((e) => !CHRISTIAN_EMOTIONS.includes(e))]} onChange={(emotion) => patch({ emotion })} labels={t.emotions} />
        </div>
        <MeterFields sig={project.timeSig} bpm={project.bpm} onSig={(timeSig) => patch({ timeSig })} onBpm={(bpm) => patch({ bpm })} />
        <p className="hint">{t.settings.meterWarn}</p>
        <h3 className="sub-h">{t.setup.structureTitle}</h3>
        <QuickForm bpm={project.bpm} genre={project.genre} onApply={applyTypes} />
        <StructureEditor
          items={project.sections.map((s) => ({ id: s.id, type: s.type, bars: s.bars }))}
          onAdd={addSection} onRemove={removeSection} onMove={moveSection}
          onBars={(id, bars) => patchSection(id, { bars })} onType={(id, type) => patchSection(id, { type })}
        />
        <div className="dialog-actions"><button className="btn btn-primary" onClick={onClose}>{t.common.done}</button></div>
      </div>
    </dialog>
  );
}

function GeneratedView({ real }: { real: Section }) {
  const project = useApp((s) => s.project)!;
  const startOverride = useApp((s) => s.startOverride);
  const src = real.sourceSectionId ? project.sections.find((x) => x.id === real.sourceSectionId) : undefined;
  const srcHasTake = !!src && src.takes.length > 0;
  if (!src) {
    return (
      <div className="stack">
      <section className="panel">
        <Empty
          title={t.studio.placeholderTitle} body={t.studio.placeholderBody}
          action={<button className="btn btn-ghost" onClick={() => startOverride(real.id)}>{t.studio.recordOwn}</button>}
        />
      </section>
      <ArrangePanel />
      </div>
    );
  }
  return (
    <div className="stack">
      <section className="panel">
        <p className="lede">{srcHasTake ? t.studio.copyBody(src.label) : t.studio.copyMissing(src.label)}</p>
        <div className="big-actions">
          <button className="btn btn-primary" onClick={() => pickSection(src.id)}>{t.studio.openSource(src.label)}</button>
          <button className="btn btn-ghost" onClick={() => startOverride(real.id)}>{t.studio.recordOwn}</button>
        </div>
        <p className="hint">{t.studio.recordOwnHint}</p>
      </section>
      {srcHasTake && <section className="panel"><PianoRoll editable={false} height={300} chordLane /></section>}
      {src.harmony && <section className="panel"><div className="panel-head"><h2>{t.chords.title}</h2></div><ChordStrip section={src} readOnly /></section>}
      <ArrangePanel />
    </div>
  );
}

function SectionRail() {
  const project = useApp((s) => s.project)!;
  const sectionId = useApp((s) => s.sectionId);
  return (
    <nav className="rail" aria-label={t.studio.sections}>
      <ol>
        {project.sections.map((s) => {
          const role = sectionRole(s);
          const src = effectiveSection(project, s);
          const tk = src.takes.find((x) => x.id === src.activeTakeId);
          const status = tk?.analysis ? 'analyzed' : tk?.cleanAudioId ? 'cleaned' : tk ? 'recorded' : 'empty';
          const srcLabel = role === 'copy' ? project.sections.find((x) => x.id === s.sourceSectionId)?.label ?? '' : '';
          const sub = role === 'source' ? t.studio.status[status] : role === 'copy' && !s.takes.length ? t.studio.fromSource(srcLabel) : role === 'copy' ? t.studio.ownBadge : s.takes.length ? t.studio.ownBadge : t.studio.placeholder;
          return (
            <li key={s.id}>
              <button className={`rail-item ${s.id === sectionId ? 'on' : ''}`} style={{ ['--glass' as string]: SECTION_COLOR[s.type] }} onClick={() => pickSection(s.id)} aria-current={s.id === sectionId ? 'true' : undefined}>
                <span className="rail-glass" aria-hidden="true" />
                <span className="rail-text">
                  <span className="rail-label">{s.label}</span>
                  <span className="rail-sub">{s.bars} {t.setup.barsUnit} · {sub}</span>
                  {role === 'source' && !tk && <span className="rail-badge">{t.studio.recordHere}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const STEPS = ['record', 'clean', 'analyze', 'correct'] as const;
type Step = (typeof STEPS)[number] | 'chords';

function stepDone(step: Step, take: Take | null, section?: Section): boolean {
  if (!take) return false;
  if (step === 'record') return true;
  if (step === 'clean') return !!take.cleanAudioId;
  if (step === 'chords') return !!section?.harmony;
  return !!take.analysis;
}

function SimpleFlow({ section, take, part }: { section: Section; take: Take | null; part: 'voice' | 'chords' }) {
  const firstOpen: Step = part === 'chords' ? 'chords' : STEPS.find((s) => !stepDone(s, take, section)) ?? 'correct';
  const [picked, setPicked] = useState<Step | null>(null);
  useEffect(() => { setPicked(null); }, [section.id, take?.id]);
  const step = part === 'chords' ? 'chords' : picked ?? firstOpen;
  const busy = useApp((s) => (take ? s.busy[take.id] : undefined));
  const clean = useApp((s) => s.runClean);
  const analyze = useApp((s) => s.runAnalyze);
  const runAll = useApp((s) => s.runAll);

  return (
    <div className="simple">
      {part === 'voice' && <ol className="stepper" aria-label={t.simple.steps}>
        {STEPS.map((s, i) => {
          const done = stepDone(s, take, section);
          const locked = i > 0 && !take;
          return (
            <li key={s}>
              <button className={`step ${step === s ? 'on' : ''} ${done ? 'done' : ''}`} disabled={locked} onClick={() => setPicked(s)} aria-current={step === s ? 'step' : undefined}>
                <span className="step-n" aria-hidden="true">{done && step !== s ? <Icon name="check" size={14} /> : i + 1}</span>
                <span>{t.steps[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>}

      <div className="step-body">
        {step === 'record' && (
          <div className="two-col">
            <RecordPanel section={section} />
            <TakesPanel section={section} />
          </div>
        )}
        {step === 'clean' && (
          <section className="panel big-step">
            <h2>{t.simple.cleanTitle}</h2>
            <p className="lede">{t.simple.cleanBody}</p>
            {busy ? <Progress label={busy.label} /> : (
              <div className="big-actions">
                <button className="btn btn-primary btn-lg" onClick={() => take && void clean(section.id, take.id)}><Icon name="wand" size={18} />{take?.cleanAudioId ? t.proc.redo : t.steps.clean}</button>
                {take?.cleanAudioId && <button className="btn btn-ghost btn-lg" onClick={() => setPicked('analyze')}>{t.simple.next}</button>}
              </div>
            )}
            <AiCleanButtons sectionId={section.id} take={take} />
            {take?.cleanAudioId && <p className="hint ok-line"><Icon name="check" size={14} />{t.simple.cleanDone}</p>}
            <TakesPanel section={section} />
          </section>
        )}
        {step === 'analyze' && (
          <section className="panel big-step">
            <h2>{t.simple.analyzeTitle}</h2>
            <p className="lede">{t.simple.analyzeBody}</p>
            {busy ? <Progress label={busy.label} /> : (
              <div className="big-actions">
                <button className="btn btn-primary btn-lg" onClick={() => take && void analyze(section.id, take.id)}><Icon name="wand" size={18} />{take?.analysis ? t.proc.redo : t.steps.analyze}</button>
                {!take?.cleanAudioId && take && <button className="btn btn-ghost btn-lg" onClick={() => void runAll(section.id, take.id)}>{t.proc.all}</button>}
              </div>
            )}
            <PitchEngineToggle />
            <AnalysisSummary take={take} />
            {take?.analysis && <div className="roll-wrap"><PianoRoll editable={false} height={300} /></div>}
            <KeyPanel take={take} />
          </section>
        )}
        {step === 'correct' && (
          <div className="two-col two-col-wide">
            <div className="stack">
              <section className="panel">
                <div className="panel-head"><h2>{t.simple.correctTitle}</h2></div>
                <p className="lede">{t.simple.correctBody}</p>
                <div className="roll-wrap"><PianoRoll editable={false} height={300} /></div>
              </section>
              <ExportPanel section={section} />
            </div>
            <div className="stack">
              <CorrectionPanel section={section} take={take} />
              <KeyPanel take={take} />
            </div>
          </div>
        )}
        {step === 'chords' && (
          <div className="stack">
            <ChordPanel section={section} hasMelody={!!take && take.notesCorrected.length > 0} />
            <section className="panel">
              <div className="panel-head"><h2>{t.roll.title}</h2></div>
              <div className="roll-wrap"><PianoRoll editable={false} height={320} chordLane /></div>
            </section>
            <ExportPanel section={section} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProFlow({ section, take, part }: { section: Section; take: Take | null; part: 'voice' | 'chords' }) {
  const [chordSel, setChordSel] = useState<{ idx: number; x: number; y: number } | null>(null);
  return (
    <div className="pro">
      <section className="panel panel-roll" aria-label={t.roll.title}>
        <PianoRoll editable={part === 'voice'} height={420} chordLane={part === 'chords'} selectedChord={chordSel?.idx ?? null} onChordClick={(idx, at) => setChordSel({ idx, ...at })} />
        {chordSel && section.harmony && <ChordPopover section={section} idx={chordSel.idx} anchor={chordSel} onClose={() => setChordSel(null)} />}
      </section>
      {part === 'chords' && <><ChordPanel section={section} hasMelody={!!take && take.notesCorrected.length > 0} /><ExportPanel section={section} /></>}
      {part === 'voice' && <div className="pro-grid">
        <div className="stack"><RecordPanel section={section} /><TakesPanel section={section} /></div>
        <div className="stack">
          <ProcessPanel section={section} take={take} />
          <AiCleanButtons sectionId={section.id} take={take} />
          <section className="panel" aria-label={t.analysis.title}>
            <div className="panel-head"><h2>{t.analysis.title}</h2></div>
            {take?.analysis ? <AnalysisSummary take={take} /> : <p className="empty-line">{t.corr.needAnalysis}</p>}
          </section>
          <ExportPanel section={section} />
        </div>
        <div className="stack"><CorrectionPanel section={section} take={take} /><KeyPanel take={take} /></div>
      </div>}
    </div>
  );
}

function MixTab({ pro }: { pro: boolean }) {
  const project = useApp((s) => s.project)!;
  return (
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2>{t.tabs.mixTitle}</h2></div><MixerBody pro={pro} /></section>
      <FxPanel />
      <p className="hint">{t.tabs.eqNote}</p>
      <div className="flags" data-testid="flags-list">
        <span className="label">{t.player.flagsTitle}</span>
        {(project.flags ?? []).length === 0 ? <span className="hint">{t.player.flagsNone}</span> : (project.flags ?? []).map((f) => (
          <div key={f.id} className="flag-row">
            <span>{Math.floor(f.at / 60)}:{String(Math.floor(f.at % 60)).padStart(2, '0')}</span>
            <span className="hint">{f.near.map((n) => n.track + ' ' + n.midi).join(', ') || '—'}</span>
            <button className="icon-btn" aria-label="×" onClick={() => useApp.getState().removeFlag(f.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Studio() {
  const project = useApp((s) => s.project);
  const ready = useApp((s) => s.ready);
  const real = useApp(selectedSection);
  const eff = useApp(currentSection);
  const overrides = useApp((s) => s.overrides);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const saveState = useApp((s) => s.saveState);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const [settings, setSettings] = useState(false);
  const nav = useTabHash(project?.id);
  const view: Tab = nav.tab;
  const [help, setHelp] = useState(false);
  const [meterOpen, setMeterOpen] = useState(false);
  const [recAssistOpen, setRecAssistOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const aiSt = useAiStatus();
  const viewRef = useRef<Tab>('voce');
  viewRef.current = view;
  const role = real ? sectionRole(real) : 'source';
  const editor = !!real && (role === 'source' || real.takes.length > 0 || !!overrides[real.id]);
  const sec = editor ? real : eff;
  const take = activeTake(sec);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio' && (el as HTMLInputElement).type !== 'range'
        || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
      if (typing) return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setHelp(true); return; }
      if (viewRef.current !== 'voce' && (e.key.toLowerCase() === 'r' || e.key.toLowerCase() === 'p') && !e.ctrlKey && !e.metaKey && !e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { usePlayer.getState().stop(); }
      else if (e.key === 'Home' && !e.ctrlKey && !e.metaKey && el.getAttribute('role') !== 'slider') { e.preventDefault(); usePlayer.getState().seek(0); }
      else if (e.key === ' ' && el.tagName !== 'BUTTON') { e.preventDefault(); void usePlayer.getState().toggle(); }
      else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const rec = useRec.getState();
        if (rec.status === 'paused') rec.resumeRecording();
        else if (rec.status === 'recording' || rec.status === 'countin') rec.pauseRecording();
      }
      else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const rec = useRec.getState();
        const s = useApp.getState().sectionId;
        if (rec.status === 'countin' || rec.status === 'recording' || rec.status === 'paused') rec.stopRecording();
        else if (rec.status === 'ready' && s) {
          const st = useApp.getState();
          const cur = st.project?.sections.find((x) => x.id === s);
          if (cur && (!cur.generated || cur.takes.length || st.overrides[cur.id])) void rec.record(s);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // leaving the studio: stop audio and release microphone
  useEffect(() => () => { engine.stop(); useRec.getState().closeMic(); }, []);

  if (!project) {
    return <div className="page" aria-busy="true"><div className="skeleton-list" aria-label={t.common.loading}><div className="skeleton" /><div className="skeleton" /></div></div>;
  }
  if (!ready) return null;

  return (
    <div className="studio">
      <div className="studio-head">
        <div className="studio-title">
          <a className="back" href="#/"><Icon name="back" size={16} />{t.nav.projects}</a>
          <h1>{project.name}</h1>
          <p className="chips-line">
            <span>{t.genres[project.genre]}</span><span>{t.emotions[project.emotion]}</span>
            <span className="num">{timeSigId(project.timeSig).replace(/[ab]$/, '')} · {project.bpm} BPM</span>
            <span className={project.key ? 'key-chip' : 'muted'}>{project.key ? keyName(project.key) : t.key.none}</span>
          </p>
          <p className="guide">{project.sections.some((s) => !s.generated && !s.takes.length) ? t.studio.guide : t.studio.guideDone}</p>
        </div>
        <div className="studio-tools">
          <span className={`save save-${saveState}`} role="status">{saveState === 'saved' ? t.common.saved : saveState === 'saving' ? t.common.saving : t.common.saveError}</span>
          <div className="head-tools">
            <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label={t.common.undo} title="Ctrl+Z"><Icon name="undo" size={17} /></button>
            <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label={t.common.redo} title="Ctrl+Y"><Icon name="redo" size={17} /></button>
            <button className="icon-btn" onClick={() => setSettings(true)} aria-label={t.settings.open} title={t.settings.open}><Icon name="settings" size={17} /></button>
          </div>
          <div className="seg seg-mode" role="group" aria-label={t.studio.mode}>
            <button className={mode === 'simplu' ? 'on' : ''} aria-pressed={mode === 'simplu'} onClick={() => setMode('simplu')}>{t.studio.simple}</button>
            <button className={mode === 'pro' ? 'on' : ''} aria-pressed={mode === 'pro'} onClick={() => setMode('pro')}>{t.studio.pro}</button>
          </div>
        </div>
      </div>

      <nav className="view-nav" aria-label={t.views.nav}>
        <div className="view-tabs" role="tablist">
          {TABS.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => nav.go(v)}>{t.tabs[v]}</button>
          ))}
        </div>
        {aiSt?.state === 'ready' && <button className="btn btn-quiet btn-sm" data-testid="assistant-btn" onClick={() => setAssistOpen(true)}><Icon name="wand" size={14} />{t.ai.assistant}</button>}
        <button className="btn btn-quiet btn-sm" data-testid="rec-assist-btn" onClick={() => setRecAssistOpen(true)}><Icon name="mic" size={14} />{t.recAssist.title}</button>
        <button className="btn btn-quiet btn-sm" onClick={() => setMeterOpen(true)}><Icon name="metro" size={14} />{t.tempo.title}</button>
        <button className="icon-btn" onClick={() => setHelp(true)} aria-label={t.help.open} title={t.help.open}><Icon name="help" size={17} /></button>
      </nav>

      <p className="guide tab-guide" data-testid="tab-guide">{t.tabs.guide[view]}</p>
      {SUBS[view].length > 0 && (
        <div className="seg seg-sub" role="group" aria-label={t.tabs.projectNav}>
          {SUBS[view].map((sb) => {
            const lab = view === 'voce' ? t.tabs.voceSub[sb as 'flow' | 'clean' | 'autotune' | 'report' | 'practice' | 'final'] : t.tabs.exportSub[sb as 'export' | 'minus' | 'sheet'];
            const hasMinus = project.sections.some((x) => x.harmony);
            const off = view === 'voce' && sb === 'final' && !hasMinus;
            return <button key={sb} className={nav.sub === sb ? 'on' : ''} aria-pressed={nav.sub === sb} disabled={off} title={off ? t.tabs.finalHint : undefined} onClick={() => nav.go(view, sb)}>{lab}</button>;
          })}
        </div>
      )}
      {view === 'aranjament' || view === 'mix' || view === 'export' || (view === 'voce' && nav.sub !== 'flow') ? (
        <div className="view-body" key={view + nav.sub} role="tabpanel">
          {view === 'voce' && nav.sub === 'clean' && <CleanView />}
          {view === 'voce' && nav.sub === 'report' && <VoiceReportView />}
          {view === 'voce' && nav.sub === 'final' && <FinalView />}
          {view === 'aranjament' && <><ArrangePanel /><AiVariantNote /></>}
          {view === 'voce' && nav.sub === 'autotune' && <AutotuneView />}
          {view === 'voce' && nav.sub === 'practice' && <TrainerView />}
          {view === 'mix' && <MixTab pro={mode === 'pro'} />}
          {view === 'export' && nav.sub === 'minus' && <MinusView />}
          {view === 'export' && nav.sub === 'sheet' && <SheetView />}
          {view === 'export' && nav.sub === 'export' && <ExportView onSheet={() => nav.go('export', 'sheet')} />}
        </div>
      ) : project.sections.length === 0 ? (
        <Empty title={t.studio.noSectionsTitle} body={t.studio.noSectionsBody} action={<button className="btn btn-primary" onClick={() => setSettings(true)}>{t.studio.noSectionsCta}</button>} />
      ) : (
        <div className="studio-body">
          <SectionRail />
          <div className="workspace" key={real?.id}>
            {real && sec && (
              <>
                <div className="section-head" style={{ ['--glass' as string]: SECTION_COLOR[real.type] }}>
                  <span className="section-swatch" aria-hidden="true" />
                  <h2>{real.label}</h2>
                  <span className="section-meta">{t.sectionTypes[real.type]} · {real.bars} {t.setup.barsUnit}</span>
                  <span className={`role-badge role-${role}`}>
                    {role === 'source' ? t.studio.roleSource : role === 'copy' ? (real.takes.length ? t.studio.ownBadge : t.studio.roleCopy(project.sections.find((x) => x.id === real.sourceSectionId)?.label ?? '')) : real.takes.length ? t.studio.ownBadge : t.studio.rolePlaceholder}
                  </span>
                  <label className="inline-type">
                    <span className="sr-only">{t.setup.sectionType}</span>
                    <select value={sec.type} onChange={(e) => useApp.getState().patchSection(real.id, { type: e.target.value as Section['type'] })}>
                      {SECTION_TYPES.map((s) => <option key={s} value={s}>{t.sectionTypes[s]}</option>)}
                    </select>
                  </label>
                </div>
                {!editor ? <GeneratedView real={real} /> : (
                  <>
                    {role !== 'source' && !real.takes.length && (
                      <p className="notice notice-row">{t.studio.recordOwnHint}
                        <button className="btn btn-quiet btn-sm" onClick={() => useApp.getState().endOverride(real.id)}>{t.studio.giveUpOwn}</button>
                      </p>
                    )}
                    {mode === 'simplu' ? <SimpleFlow section={sec} take={take} part={view === 'acorduri' ? 'chords' : 'voice'} /> : <ProFlow section={sec} take={take} part={view === 'acorduri' ? 'chords' : 'voice'} />}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <Transport pro={mode === 'pro'} hideMixer={view === 'mix'} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
      <AssistantDialog open={assistOpen} onClose={() => setAssistOpen(false)} />
      <RecAssistant open={recAssistOpen} onClose={() => setRecAssistOpen(false)} />
      <MeterAssistant open={meterOpen} onClose={() => setMeterOpen(false)} />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <Onboarding />
    </div>
  );
}
