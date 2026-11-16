// The /dispatch screen: opens the event stream and shows the session board (cards or timeline), the usage screen
// or the always-on screen, picked by the URL hash (#timeline, #usage, #tv), with the session sheet on top.
// Loaded lazily from main.tsx so the editor bundle does not carry it.
import { useEffect, useMemo, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { cn } from '../lib/utils';
import { useTheme } from '../theme';
import { AlwaysOnView } from './AlwaysOnView';
import { hashOf, viewOf, type View } from './lib/usage.ts';
import { folderOf, hashWith, knownFolders, type Scope } from './lib/folder.ts';
import { ProjectRail } from './ProjectRail';
import { ScopeProvider } from './scope';
import { projectsApi, type ProjectInfo } from '../api';
import { SessionSheet } from './SessionSheet';
import { SessionsPage } from './SessionsPage';
import { SessionTimeline } from './SessionTimeline';
import { PrTrackingToggle } from './PrTrackingToggle';
import { TaskBoardButton } from './TaskBoard';
import { UsagePage } from './UsagePage';
import { connect, useDispatch } from './store';

export { connect };

const NAV: { view: View; label: string }[] = [
  { view: 'sessions', label: '세션' },
  { view: 'timeline', label: '타임라인' },
  { view: 'usage', label: '사용량' },
];

/** The hash-picked view and project scope, following back/forward and links. */
function useRoute(): [View, Scope, (v: View, scope?: Scope) => void] {
  const read = () => [viewOf(location.hash), folderOf(location.hash)] as const;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (v: View, scope: Scope = route[1]) => {
    const h = hashWith(hashOf(v).slice(1), scope);
    if (h) location.hash = h;
    else history.pushState(null, '', location.pathname + location.search);
    setRoute([v, scope]);
  };
  return [route[0], route[1], go];
}

type ListState = 'loading' | 'ready' | 'failed';

/** Projects of the workspace for the rail, with whether the first answer is in. A failed refresh keeps the last list. */
function useProjectList(): [ProjectInfo[], ListState] {
  const [list, setList] = useState<ProjectInfo[]>([]);
  const [state, setState] = useState<ListState>('loading');
  useEffect(() => {
    let live = true;
    const load = () => void projectsApi.projects().then(
      d => { if (live) { setList(d.projects); setState('ready'); } },
      () => { if (live) setState(s => (s === 'ready' ? s : 'failed')); },
    );
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return [list, state];
}

export default function DispatchApp() {
  useTheme();
  const ready = useDispatch(s => s.ready);
  const online = useDispatch(s => s.online);
  const unavailable = useDispatch(s => s.unavailable);
  const [open, setOpen] = useState<string | null>(null);
  const [view, scope, go] = useRoute();
  const [projects, listState] = useProjectList();
  const known = useMemo(() => knownFolders(projects.map(p => p.path), scope, listState === 'ready'), [projects, scope, listState]);
  const names = useMemo(() => new Map(projects.map(p => [p.path, p.name])), [projects]);
  const ctx = useMemo(() => ({ scope, known, names }), [scope, known, names]);
  useEffect(() => connect(), []);

  const offline = ready && !online && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>;
  const sheet = <SessionSheet id={open} onClose={() => setOpen(null)} />;

  if (view === 'tv' && ready && !unavailable) {
    return (
      <>
        {offline}
        {/* Opening a tile leaves the always-on screen, so Esc in the sheet never also closes the wall view. */}
        <AlwaysOnView onExit={() => go('sessions')} onOpen={id => { go('sessions'); setOpen(id); }} />
        {sheet}
      </>
    );
  }

  return (
    <ScopeProvider value={ctx}>
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-1.5 max-md:px-4">
        <nav aria-label="세션 화면" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {NAV.map(n => (
            <a
              key={n.view}
              href={hashWith(hashOf(n.view).slice(1), scope) || location.pathname}
              aria-current={view === n.view ? 'page' : undefined}
              onClick={e => { e.preventDefault(); go(n.view); }}
              className={cn(
                'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                view === n.view && 'bg-muted text-foreground hover:bg-muted',
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <PrTrackingToggle />
          <a
            href="#tv"
            onClick={e => { e.preventDefault(); go('tv'); }}
            title="벽 화면처럼 크게 띄워 둬요"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Monitor aria-hidden className="size-3.5" />
            <span className="max-sm:sr-only">상시 화면</span>
          </a>
        </div>
      </header>
      {offline}
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        {!unavailable && ready && <ProjectRail projects={projects} state={listState} scope={scope} view={hashOf(view).slice(1)} onPick={sc => go(view, sc)} />}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {listState === 'failed' && !unavailable && ready && <p role="status" className="m-0 border-b px-6 py-2 text-sm text-muted-foreground">프로젝트 목록을 불러오지 못했어요. 잠시 뒤에 다시 시도해요.</p>}
        {unavailable ? (
          <p className="p-6 text-sm text-muted-foreground">이 서버에서는 세션 화면을 쓸 수 없어요.</p>
        ) : !ready ? (
          <p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>
        ) : scope !== undefined && listState === 'loading' ? (
          <p className="p-6 text-sm text-muted-foreground">프로젝트 목록을 불러오는 중이에요…</p>
        ) : scope === null && listState === 'failed' ? (
          // Without the project list every session would look 미분류 (#522); the notice above says why.
          <p className="p-6 text-sm text-muted-foreground">프로젝트 목록이 없어서 미분류를 가려낼 수 없어요.</p>
        ) : view === 'usage' ? (
          <UsagePage />
        ) : view === 'timeline' ? (
          <SessionTimeline onOpen={setOpen} />
        ) : (
          <SessionsPage onOpen={setOpen} onUsage={() => go('usage')} actions={<TaskBoardButton />} />
        )}
      </main>
      </div>
      {sheet}
    </div>
    </ScopeProvider>
  );
}
