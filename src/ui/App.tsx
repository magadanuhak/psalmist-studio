import { useEffect, useState } from 'react';
import { useApp } from '../store/store';
import { t } from '../i18n/ro';
import { Brand } from './icons';
import { Toasts } from './common';
import { ProjectsScreen } from './ProjectsScreen';
import { ProjectForm } from './ProjectForm';
import { Studio } from './Studio';
import { About } from './About';
import { AiChip } from './AiUI';

type Route =
  | { name: 'projects' } | { name: 'new' } | { name: 'about' } | { name: 'studio'; id: string };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h === 'new') return { name: 'new' };
  if (h === 'about') return { name: 'about' };
  const m = /^p\/([^/]+)(?:\/.*)?$/.exec(h);
  if (m) return { name: 'studio', id: m[1] };
  return { name: 'projects' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const openProject = useApp((s) => s.openProject);
  const closeProject = useApp((s) => s.closeProject);
  const project = useApp((s) => s.project);

  useEffect(() => { void init(); }, [init]);
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (route.name === 'studio' && ready) void openProject(route.id);
    else if (route.name !== 'studio' && project) closeProject();
  }, [route.name, route.name === 'studio' ? route.id : '', ready, openProject, closeProject]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // warn about unfinished work only when a take is being processed
    const onUnload = (e: BeforeUnloadEvent) => { if (Object.keys(useApp.getState().busy).length) e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const inStudio = route.name === 'studio';
  return (
    <div className="app">
      <a className="skip" href="#main">{t.common.skip}</a>
      <header className="topbar">
        <a className="brand" href="#/" aria-label={t.app.name}>
          <Brand />
          <span className="brand-name">{t.app.name}</span>
        </a>
        <nav className="topnav" aria-label={t.app.nav}>
          <a href="#/" aria-current={route.name === 'projects' ? 'page' : undefined}>{t.nav.projects}</a>
          <a href="#/about" aria-current={route.name === 'about' ? 'page' : undefined}>{t.nav.about}</a>
          <AiChip />
        </nav>
      </header>
      <main id="main" className={inStudio ? 'main main-studio' : 'main'} key={route.name}>
        {route.name === 'projects' && <ProjectsScreen />}
        {route.name === 'new' && <ProjectForm />}
        {route.name === 'about' && <About />}
        {route.name === 'studio' && <Studio />}
      </main>
      <Toasts />
    </div>
  );
}
