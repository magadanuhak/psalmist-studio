import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { sheetXml } from '../store/sheet';
import { fileBase } from '../store/exportSong';
import { downloadBlob } from '../music/wav';
import { t } from '../i18n/ro';
import { Empty, Progress } from './common';
import { Icon } from './icons';

/** In-app sheet view (OpenSheetMusicDisplay, BSD-3) drawn from the generated MusicXML; prints to A4 / PDF. */
export function SheetView() {
  const project = useApp((s) => s.project)!;
  const xml = useMemo(() => sheetXml(project), [project]);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!xml || !host.current) return;
    let dead = false;
    setState('loading');
    (async () => {
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (dead || !host.current) return;
        host.current.innerHTML = '';
        const osmd = new OpenSheetMusicDisplay(host.current, { autoResize: true, backend: 'svg', drawTitle: true, drawPartNames: false, drawingParameters: 'compacttight' });
        await osmd.load(xml);
        if (dead) return;
        osmd.render();
        setState('ready');
      } catch (e) {
        console.error('[psalmist] sheet render failed', e);
        if (!dead) setState('error');
      }
    })();
    return () => { dead = true; };
  }, [xml]);

  if (!xml) return <section className="panel"><Empty title={t.sheet.emptyTitle} body={t.sheet.emptyBody} /></section>;
  return (
    <div className="stack sheet-view">
      <section className="panel no-print">
        <div className="panel-head"><h2>{t.sheet.title}</h2></div>
        <p className="lede">{t.sheet.lede}</p>
        <div className="big-actions">
          <button className="btn btn-primary" disabled={state !== 'ready'} onClick={() => window.print()}><Icon name="export" size={16} />{t.sheet.print}</button>
          <button className="btn btn-ghost" onClick={() => downloadBlob(xml, `${fileBase(project)}.musicxml`, 'application/vnd.recordare.musicxml+xml')}>{t.sheet.xml}</button>
        </div>
      </section>
      <section className="sheet-paper" aria-label={t.sheet.title} aria-busy={state === 'loading'}>
        {state === 'loading' && <Progress label={t.sheet.loading} />}
        {state === 'error' && <p className="form-error" role="alert">{t.sheet.error}</p>}
        <div ref={host} className="sheet-host" />
      </section>
    </div>
  );
}
