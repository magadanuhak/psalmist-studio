import { useState } from 'react';
import { useApp } from '../store/store';
import { t } from '../i18n/ro';
import { SECTION_COLOR } from '../model/presets';
import type { Project } from '../model/types';
import { hasMaterial } from '../model/sections';
import { keyName } from '../music/theory';
import { timeSigId } from '../music/timesig';
import { ConfirmDialog, Empty } from './common';
import { Icon } from './icons';
import type { TapGrid } from '../dsp/tapGrid';
import { FullVocalDialog } from './FullVocalDialog';
import { ImportSongDialog, useAiStatus } from './AiUI';

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Strip({ p }: { p: Project }) {
  if (!p.sections.length) return <div className="strip strip-empty" aria-hidden="true" />;
  return (
    <div className="strip" role="img" aria-label={t.projects.stripLabel(p.sections.filter((s) => !s.generated && s.takes.length).length, p.sections.filter((s) => !s.generated).length)}>
      {p.sections.map((s) => (
        <span key={s.id} className={`strip-seg ${hasMaterial(p, s) ? 'done' : ''}`} style={{ flexGrow: s.bars, ['--glass' as string]: SECTION_COLOR[s.type] }} title={`${s.label}${hasMaterial(p, s) ? '' : ' - ' + t.projects.empty}`} />
      ))}
    </div>
  );
}

export function ProjectsScreen() {
  const ready = useApp((s) => s.ready);
  const projects = useApp((s) => s.projects);
  const del = useApp((s) => s.deleteProject);
  const rename = useApp((s) => s.renameProject);
  const [confirm, setConfirm] = useState<Project | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [fullOpen, setFullOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [fullGrid, setFullGrid] = useState<TapGrid | undefined>();
  const [fullFile, setFullFile] = useState<File | undefined>(undefined);
  const aiSt = useAiStatus();

  if (!ready) {
    return (
      <div className="page" aria-busy="true">
        <div className="page-head"><h1>{t.projects.title}</h1></div>
        <div className="skeleton-list" aria-label={t.common.loading}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>{t.projects.title}</h1>
          <p className="lede">{t.projects.lede}</p>
        </div>
        <div className="head-actions">
          {aiSt?.available.separate && <button className="btn btn-ghost" data-testid="open-import-song" onClick={() => setImportOpen(true)}><Icon name="import" size={16} />{t.ai.importSong}</button>}
          <button className="btn btn-ghost" data-testid="open-full-vocal" onClick={() => setFullOpen(true)}><Icon name="import" size={16} />{t.fullVocal.open}</button>
          {projects.length > 0 && <a className="btn btn-primary" href="#/new"><Icon name="plus" size={16} />{t.projects.new}</a>}
        </div>
      </div>

      {projects.length === 0 ? (
        <Empty
          title={t.projects.emptyTitle}
          body={t.projects.emptyBody}
          action={<a className="btn btn-primary btn-lg" href="#/new"><Icon name="flame" size={18} />{t.projects.emptyCta}</a>}
        />
      ) : (
        <ul className="project-list">
          {projects.map((p) => {
            const takes = p.sections.reduce((n, s) => n + s.takes.length, 0);
            return (
              <li key={p.id} className="project-row">
                <div className="project-main">
                  {editing === p.id ? (
                    <form className="rename" onSubmit={(e) => { e.preventDefault(); void rename(p.id, draft); setEditing(null); }}>
                      <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t.projects.rename} autoFocus maxLength={80}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} />
                      <button className="btn btn-primary" type="submit">{t.common.save}</button>
                      <button className="btn btn-quiet" type="button" onClick={() => setEditing(null)}>{t.common.cancel}</button>
                    </form>
                  ) : (
                    <a className="project-name" href={`#/p/${p.id}`}>{p.name}</a>
                  )}
                  <p className="project-meta">
                    <span>{t.genres[p.genre]}</span><span>{t.emotions[p.emotion]}</span>
                    <span className="num">{timeSigId(p.timeSig).replace(/[ab]$/, '')}</span><span className="num">{p.bpm} BPM</span>
                    {p.key && <span>{keyName(p.key)}</span>}
                  </p>
                  <Strip p={p} />
                  <p className="project-foot">{t.projects.takesCount(takes)} · {t.projects.edited(formatDate(p.updatedAt))}</p>
                </div>
                <div className="project-actions">
                  <a className="btn btn-ghost" href={`#/p/${p.id}`}>{t.projects.open}</a>
                  <button className="icon-btn" onClick={() => { setEditing(p.id); setDraft(p.name); }} aria-label={`${t.projects.rename}: ${p.name}`}><Icon name="edit" size={16} /></button>
                  <button className="icon-btn danger" onClick={() => setConfirm(p)} aria-label={`${t.projects.delete}: ${p.name}`}><Icon name="trash" size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ImportSongDialog open={importOpen} onClose={() => setImportOpen(false)} onVocals={(f, g) => { setFullFile(f); setFullGrid(g); setFullOpen(true); }} />
      <FullVocalDialog open={fullOpen} onClose={() => { setFullOpen(false); setFullFile(undefined); setFullGrid(undefined); }} genre="worship" emotion="inchinare" initialFile={fullFile} initialGrid={fullGrid} />

      <ConfirmDialog
        open={!!confirm}
        title={t.projects.deleteTitle}
        body={confirm ? t.projects.deleteBody(confirm.name) : ''}
        confirmLabel={t.projects.deleteConfirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm) void del(confirm.id); setConfirm(null); }}
      />
    </div>
  );
}
