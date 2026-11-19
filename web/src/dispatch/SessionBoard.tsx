// 세션 보드 inside the Drawing shell (#731, docs/design/session-board-in-shell.md): header with scope, tabs, 새 세션 and
// a ⋯ menu; sessions grouped by project beside a usage column; timeline and usage tabs reuse the old /dispatch screens.
// Rendered by App.tsx for `section.kind === 'board'` and, without the sidebar, by dispatch/index.tsx in project mode.
// Loaded lazily so the editor bundle does not carry it. Numbers and names only: no transcript text is read here.
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { NativeSelect } from '../components/ui/native-select';
import { cn } from '../lib/utils';
import { projectsApi, type DispatchSettings, type ProjectInfo } from '../api';
import { boardHash, type BoardExtra, type BoardTab } from '../projectNav';
import { cardRows } from '../SidebarUsageCard';
import { OffNote, useDispatchStatus } from '../settings/DispatchOff';
import { guardValue, usageGroups, type SectionId, type UsageEntry } from '../settings/model';
import { elapsed } from '../../../shared/dispatch/attention.ts';
import { AlertWatcher } from './AlertWatcher';
import { AlwaysOnView } from './AlwaysOnView';
import { AttentionStrip, SummaryLine, useNow } from './AttentionStrip';
import { CreateSessionDialog } from './CreateSessionDialog';
import { boardGroups, type BoardGroup } from './lib/boardGroups.ts';
import { knownFolders, UNFILED, type Scope } from './lib/folder.ts';
import { fmtK, fmtUsd, isOpen, pct, STATE, stateOf, TONE_TEXT, totalTok, until } from './lib/format.ts';
import { stateStart } from './lib/order.ts';
import { nowLine } from './lib/turn.ts';
import { Meter, ModelTag, STATE_ICON } from './parts';
import { ScopeProvider, useScope, useScoped } from './scope';
import { SessionSheet } from './SessionSheet';
import { SessionTimeline } from './SessionTimeline';
import { TaskBoardButton } from './TaskBoard';
import { UsagePage } from './UsagePage';
import { api, connect, useDispatch } from './store';
import { usePrTracking, useStatusLine } from './usePrTracking';
import type { Session } from './types';

const SettingsDialog = lazy(() => import('../settings/SettingsDialog'));

const TABS: { tab: BoardTab; label: string }[] = [
  { tab: 'sessions', label: '세션' },
  { tab: 'timeline', label: '타임라인' },
  { tab: 'usage', label: '사용량' },
];

type ListState = 'loading' | 'ready' | 'failed';

/** Projects of the workspace, with whether the first answer is in. A failed refresh keeps the last list. */
function useProjectList(): [ProjectInfo[], ListState] {
  const [list, setList] = useState<ProjectInfo[]>([]);
  const [state, setState] = useState<ListState>('loading');
  useEffect(() => {
    let live = true;
    const load = () =>
      void projectsApi.projects().then(
        (d) => {
          if (live) {
            setList(d.projects);
            setState('ready');
          }
        },
        () => live && setState((s) => (s === 'ready' ? s : 'failed')),
      );
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return [list, state];
}

export type BoardProps = {
  tab: BoardTab;
  /** undefined = 전체 프로젝트, null = 미분류, else a project folder path. */
  folder?: string | null;
  onRoute: (tab: BoardTab, folder: string | null | undefined) => void;
  /** A session to open, from a toast outside the board; `n` makes each request new. */
  openRequest?: { id: string; n: number } | null;
  /** 상시 화면 or 설정 asked for by the address (old /dispatch#tv, #settings); handled once, then `onExtraDone`. */
  extra?: BoardExtra | null;
  onExtraDone?: () => void;
};

export default function SessionBoard(p: BoardProps) {
  const ready = useDispatch((s) => s.ready);
  const online = useDispatch((s) => s.online);
  const unavailable = useDispatch((s) => s.unavailable);
  const offStatus = useDispatchStatus();
  const [projects, listState] = useProjectList();
  const scope: Scope = p.folder;
  const known = useMemo(() => knownFolders(projects.map((x) => x.path), scope, listState === 'ready'), [projects, scope, listState]);
  const names = useMemo(() => new Map(projects.map((x) => [x.path, x.name])), [projects]);
  const ctx = useMemo(() => ({ scope, known, names }), [scope, known, names]);
  useEffect(() => connect(), []);

  // The one place a session opens (design §4). Until the agent live view (#728, PR #749) lands this is the session
  // sheet; then this line becomes `openAgentLive(id, { trigger })`.
  const [open, setOpen] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openSession = (id: string, from?: HTMLElement | null) => {
    trigger.current = from ?? (document.activeElement as HTMLElement | null);
    setOpen(id);
  };
  const closeSession = () => {
    setOpen(null);
    const t = trigger.current;
    trigger.current = null;
    if (t?.isConnected) requestAnimationFrame(() => t.focus());
  };
  const openRef = useRef(openSession);
  openRef.current = openSession;
  useEffect(() => {
    if (p.openRequest) openRef.current(p.openRequest.id, null);
  }, [p.openRequest]);

  const [tv, setTv] = useState(false);
  const [settings, setSettings] = useState<SectionId | null>(null);
  const [creating, setCreating] = useState(false);
  const done = useRef(p.onExtraDone);
  done.current = p.onExtraDone;
  useEffect(() => {
    if (!p.extra) return;
    if (p.extra === 'tv') setTv(true);
    else setSettings('general');
    done.current?.();
  }, [p.extra]);

  const sheet = <SessionSheet id={open} onClose={closeSession} />;
  if (tv && ready && !unavailable) {
    return (
      <div className="fixed inset-0 z-40 overflow-auto bg-background">
        {/* Opening a tile leaves the always-on screen, so Esc in the sheet never also closes the wall view. */}
        <AlwaysOnView onExit={() => setTv(false)} onOpen={(id) => { setTv(false); openSession(id, null); }} />
        {sheet}
      </div>
    );
  }

  const offline = ready && !online && !unavailable;
  return (
    <ScopeProvider value={ctx}>
      <div data-board className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <BoardHeader
          tab={p.tab}
          scope={scope}
          projects={projects}
          onRoute={p.onRoute}
          onCreate={() => setCreating(true)}
          onTv={() => setTv(true)}
          onSettings={setSettings}
          disabled={!ready || unavailable}
        />
        {offline && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>}
        <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto', offline && 'opacity-60')}>
          {listState === 'failed' && !unavailable && ready && (
            <p role="status" className="m-0 border-b px-6 py-2 text-sm text-muted-foreground max-md:px-4">
              프로젝트 목록을 불러오지 못했어요. 작업 폴더 이름으로 묶어서 보여 줘요.
            </p>
          )}
          {unavailable ? (
            <OffNote status={offStatus} className="m-6" />
          ) : !ready ? (
            <Skeleton />
          ) : p.tab === 'usage' ? (
            <UsagePage />
          ) : p.tab === 'timeline' ? (
            <SessionTimeline onOpen={(id) => openSession(id)} />
          ) : (
            <SessionsBody
              open={open}
              onOpen={openSession}
              onUsage={() => p.onRoute('usage', scope)}
              onCreate={() => setCreating(true)}
              onSettings={setSettings}
              byCwd={listState === 'failed'}
            />
          )}
        </main>
        {sheet}
        {creating && <CreateSessionDialog folder={typeof scope === 'string' ? scope : undefined} onClose={() => setCreating(false)} />}
        {settings && (
          <Suspense fallback={null}>
            <SettingsDialog section={settings} onClose={() => setSettings(null)} />
          </Suspense>
        )}
        <AlertWatcher onOpen={(id) => openSession(id, null)} />
      </div>
    </ScopeProvider>
  );
}

const TAB_LINK =
  'relative inline-flex h-12 shrink-0 items-center px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-foreground';

function BoardHeader(p: {
  tab: BoardTab;
  scope: Scope;
  projects: ProjectInfo[];
  onRoute: BoardProps['onRoute'];
  onCreate: () => void;
  onTv: () => void;
  onSettings: (s: SectionId) => void;
  disabled: boolean;
}) {
  const connected = useDispatch((s) => Object.values(s.providers ?? {}).some((x) => x?.connected));
  const scopeId = useId();
  // '' = 전체, '\0' = 미분류 (a folder path is never empty or a NUL).
  const value = p.scope === undefined ? '' : p.scope === null ? '\0' : p.scope;
  const pick = (v: string) => p.onRoute(p.tab, v === '' ? undefined : v === '\0' ? null : v);
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 border-b px-6 max-md:px-4 max-sm:gap-x-2 max-sm:px-3">
      <h1 className="m-0 shrink-0 text-[15px] font-semibold">세션 보드</h1>
      <label htmlFor={scopeId} className="sr-only">
        프로젝트
      </label>
      <NativeSelect id={scopeId} value={value} onChange={(e) => pick(e.target.value)} className="max-w-48 text-[13px] max-sm:max-w-32">
        <option value="">전체 프로젝트</option>
        {p.projects.map((x) => (
          <option key={x.path} value={x.path}>
            {x.name}
          </option>
        ))}
        {typeof p.scope === 'string' && !p.projects.some((x) => x.path === p.scope) && <option value={p.scope}>{p.scope}</option>}
        <option value={'\0'}>{UNFILED}</option>
      </NativeSelect>
      <nav aria-label="세션 보드 화면" className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] max-md:order-last max-md:-mx-2 max-md:w-full">
        {TABS.map((t) => (
          <a
            key={t.tab}
            href={boardHash({ tab: t.tab, folder: p.scope })}
            aria-current={p.tab === t.tab ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              p.onRoute(t.tab, p.scope);
            }}
            className={cn(TAB_LINK, 'max-md:h-10')}
          >
            {t.label}
          </a>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2 py-2">
        <Button size="sm" variant="outline" disabled={p.disabled || !connected} title={connected ? undefined : '연결된 모델이 없어요'} onClick={p.onCreate}>
          <Plus aria-hidden />
          <span className="max-sm:sr-only">새 세션</span>
        </Button>
        <TaskBoardButton />
        <BoardMenu onTv={p.onTv} onSettings={() => p.onSettings('general')} disabled={p.disabled} />
      </div>
    </header>
  );
}

/** ⋯ menu: 끝난 세션 정리, 모든 세션 정리 (asks first), PR·CI 추적, 상시 화면, 설정. */
function BoardMenu({ onTv, onSettings, disabled }: { onTv: () => void; onSettings: () => void; disabled: boolean }) {
  const sessions = useDispatch((s) => s.sessions);
  const doneCount = sessions.filter((s) => !isOpen(s)).length;
  const { note, status } = useStatusLine();
  const { pr, toggle, broken } = usePrTracking(status, '');
  const [said, setSaid] = useState('');
  const clear = async (all: boolean) => {
    if (all && !window.confirm(`세션 ${sessions.length}개를 모두 정리할까요? 실행 중인 세션도 멈춰요.`)) return;
    try {
      const r = await api<{ removed?: number }>('POST', all ? '/api/sessions/clear' : '/api/sessions/clear-done');
      setSaid(`세션 ${r?.removed ?? 0}개를 정리했어요.`);
    } catch {
      setSaid('정리하지 못했어요. 잠시 뒤에 다시 해 주세요.');
    }
  };
  const prNote = [broken, note].filter(Boolean).join(' ');
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="더 보기" title="더 보기" disabled={disabled}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem disabled={!doneCount} onSelect={() => void clear(false)}>
            끝난 세션 정리{doneCount ? ` (${doneCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!sessions.length} variant="destructive" onSelect={() => void clear(true)}>
            모든 세션 정리
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={pr === true}
            disabled={pr === null || pr === 'unsupported'}
            title={pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : prNote || '이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요.'}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={toggle}
          >
            PR·CI 추적
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem onSelect={onTv}>상시 화면</DropdownMenuItem>
          <DropdownMenuItem onSelect={onSettings}>설정</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {said || prNote}
      </span>
    </>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="불러오는 중이에요" className="flex flex-col gap-6 p-6 max-md:p-4">
      {[0, 1].map((g) => (
        <div key={g} className="flex flex-col gap-2">
          <div className="h-4 w-32 rounded bg-muted motion-safe:animate-pulse" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="h-11 rounded-lg bg-muted/60 motion-safe:animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionsBody({
  open,
  onOpen,
  onUsage,
  onCreate,
  onSettings,
  byCwd,
}: {
  open: string | null;
  onOpen: (id: string, from?: HTMLElement | null) => void;
  onUsage: () => void;
  onCreate: () => void;
  onSettings: (s: SectionId) => void;
  byCwd: boolean;
}) {
  const { sessions, scope } = useScoped();
  const { known, names } = useScope();
  const all = useDispatch((s) => s.sessions);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const now = useNow(20_000);
  const groups = useMemo(() => boardGroups(sessions, { known, names, stateOf, byCwd }), [sessions, known, names, byCwd]);
  const usageRef = useRef<HTMLElement>(null);
  return (
    <div className="@container/board">
      <div className="mx-auto grid w-full max-w-[1400px] gap-6 p-6 max-md:p-4 @min-[960px]/board:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <SummaryLine />
            <UsageStrip onJump={() => usageRef.current?.scrollIntoView({ block: 'start' })} />
            <AttentionStrip onOpen={(id) => onOpen(id)} onUsage={onUsage} />
          </div>
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
              <p className="m-0 font-medium">실행 중인 세션이 없어요</p>
              <p className="m-0 text-sm text-muted-foreground">새 세션을 만들면 여기에 보여요.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={onCreate}>
                <Plus aria-hidden />새 세션
              </Button>
            </div>
          ) : (
            <div className="@container/list grid gap-y-5 @min-[560px]/list:grid-cols-[1.25rem_minmax(4rem,max-content)_minmax(4rem,max-content)_minmax(0,max-content)_minmax(0,1fr)_max-content_1rem] @min-[560px]/list:gap-x-3">
              {groups.map((g) => (
                <Group key={g.key ?? '\0'} g={g} scoped={scope !== undefined} open={open} now={now} byId={byId} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
        <UsageColumn ref={usageRef} onSettings={onSettings} />
      </div>
    </div>
  );
}

const SUBGRID = '@min-[560px]/list:col-span-full @min-[560px]/list:grid @min-[560px]/list:grid-cols-subgrid';

function Group({
  g,
  scoped,
  open,
  now,
  byId,
  onOpen,
}: {
  g: BoardGroup<Session>;
  scoped: boolean;
  open: string | null;
  now: number;
  byId: Map<string, Session>;
  onOpen: (id: string, from?: HTMLElement | null) => void;
}) {
  const head = useId();
  const body = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const shown = collapsed && !scoped ? [] : [...g.live, ...(showDone ? g.done : [])];
  return (
    <section aria-labelledby={head} className={cn('flex min-w-0 flex-col gap-0.5', SUBGRID)}>
      <div className={cn('flex h-8 min-w-0 items-center gap-2', '@min-[560px]/list:col-span-full')}>
        <h2 id={head} className="m-0 truncate text-[13px] font-semibold">
          {g.label}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          세션 {g.live.length}
          {g.cost != null && ` · ${fmtUsd(g.cost)}`}
        </span>
        {!scoped && (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={body}
            aria-label={`${g.label} ${collapsed ? '펼치기' : '접기'}`}
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:size-9"
          >
            {collapsed ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
          </button>
        )}
      </div>
      <div id={body} className={cn('flex min-w-0 flex-col gap-0.5', SUBGRID, '@min-[560px]/list:gap-y-0.5')}>
        {shown.map((s) => (
          <Row key={s.id} s={s} parent={s.parent ? byId.get(s.parent) : undefined} now={now} expanded={open === s.id} onOpen={onOpen} />
        ))}
        {!(collapsed && !scoped) && g.done.length > 0 && (
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
            className="h-8 self-start rounded-md px-2 text-left text-xs text-muted-foreground tabular-nums hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @min-[560px]/list:col-span-full @min-[560px]/list:justify-self-start"
          >
            {showDone ? '끝난 세션 숨기기' : `끝난 세션 ${g.done.length}개 보기`}
          </button>
        )}
      </div>
    </section>
  );
}

/** What the session is on: why it needs a person, else the current activity, else —. */
function stepText(s: Session, now: number): ReactNode {
  const st = stateOf(s);
  if ((st === 'waiting' || st === 'stuck' || st === 'failed') && s.attention?.reason) return s.attention.reason;
  if (s.stall) return s.stall.reason;
  const a = nowLine(s);
  if (a) {
    const e = elapsed(a.since, now);
    return `지금 ${a.label}${e ? ` · ${e}째` : ''}`;
  }
  return s.status === 'running' || s.status === 'starting' ? '지금 생각 중' : '—';
}

function Row({ s, parent, now, expanded, onOpen }: { s: Session; parent?: Session; now: number; expanded: boolean; onOpen: (id: string, from?: HTMLElement | null) => void }) {
  const state = stateOf(s);
  const meta = STATE[state] ?? STATE.resting;
  const Icon = STATE_ICON[state];
  const since = elapsed(stateStart(s, state), now);
  const flag = state === 'waiting' || state === 'stuck' || !!s.stall;
  const failed = state === 'failed';
  const wide = '@min-[560px]/list:col-auto @min-[560px]/list:row-auto';
  return (
    <button
      type="button"
      data-session={s.id}
      aria-expanded={expanded}
      onClick={(e) => onOpen(s.id, e.currentTarget)}
      title={parent ? `${parent.name}이(가) 만든 세션` : undefined}
      className={cn(
        'grid min-h-11 min-w-0 grid-cols-[1.25rem_auto_minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-0.5 rounded-lg border-l-2 border-transparent px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        '@min-[560px]/list:col-span-full @min-[560px]/list:grid-cols-subgrid @min-[560px]/list:gap-x-3 @min-[560px]/list:py-0',
        flag && 'border-warn bg-warn/5',
        failed && 'border-destructive bg-destructive/5',
        expanded && 'bg-muted',
      )}
    >
      <Icon aria-hidden className={cn('size-4 shrink-0', TONE_TEXT[meta.tone])} strokeWidth={meta.tone === 'warn' || meta.tone === 'bad' ? 2.5 : 2} />
      <span className="min-w-0 truncate font-semibold">
        {s.name}
        <span className="sr-only"> {meta.label}</span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--role-${s.role}, var(--idle))` }} />
        <span className="truncate">{s.roleName || s.role}</span>
      </span>
      <span className="col-span-3 col-start-2 row-start-2 flex min-w-0 items-center gap-2 @min-[560px]/list:contents">
        <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ''}`} className="max-w-56 shrink-0" />
        <span className={cn('min-w-0 truncate text-muted-foreground', (flag || failed) && 'text-foreground')}>{stepText(s, now)}</span>
      </span>
      <span className={cn('col-start-4 row-start-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums', wide)} title="이 상태가 된 뒤 지난 시간">
        {flag || failed ? `${meta.label} · ` : ''}
        {since ? `${since}째` : '방금'}
      </span>
      <ChevronRight aria-hidden className={cn('col-start-5 row-start-1 size-4 text-muted-foreground', wide)} />
    </button>
  );
}

/** Phone: one line of Claude's limits under the summary, jumping to the usage block. */
function UsageStrip({ onJump }: { onJump: () => void }) {
  const limits = useDispatch((s) => s.limits);
  const providers = useDispatch((s) => s.providers);
  const claude = useMemo(() => usageGroups(limits as unknown as Record<string, UsageEntry>, providers ?? {}).find((g) => g.id === 'claude'), [limits, providers]);
  if (!claude?.windows.length) return null;
  const text = claude.windows
    .filter((w) => w.label === '5시간' || w.label === '주간')
    .map((w) => `${w.label} ${pct(w.used)}`)
    .join(' · ');
  return (
    <button
      type="button"
      onClick={onJump}
      className="self-start rounded-md text-left text-xs text-muted-foreground tabular-nums hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @min-[960px]/board:hidden"
    >
      Claude {text} <span className="underline underline-offset-2">사용량 자세히</span>
    </button>
  );
}

function UsageColumn({ ref, onSettings }: { ref: React.Ref<HTMLElement>; onSettings: (s: SectionId) => void }) {
  const limits = useDispatch((s) => s.limits);
  const providers = useDispatch((s) => s.providers);
  const settings = useDispatch((s) => s.settings);
  const sessions = useDispatch((s) => s.sessions);
  const groups = useMemo(() => usageGroups(limits as unknown as Record<string, UsageEntry>, providers ?? {}), [limits, providers]);
  const off = Object.entries(providers ?? {}).filter(([, x]) => !x?.connected);
  const live = sessions.filter(isOpen);
  const s = settings as unknown as DispatchSettings;
  const guardOn = !!settings?.guard?.enabled;
  const head = useId();
  const now = Date.now();
  return (
    <section ref={ref} aria-labelledby={head} className="flex min-w-0 scroll-mt-4 flex-col gap-3">
      <h2 id={head} className="m-0 text-[13px] font-semibold">
        사용량
      </h2>
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-3 text-sm">
          <p className="m-0">연결된 모델이 없어요</p>
          <Button size="sm" variant="outline" onClick={() => onSettings('providers')}>
            모델 연결
          </Button>
        </div>
      ) : (
        groups.map((g) => {
          const rows = g.id === 'claude' || g.id === 'openai' ? cardRows(g.id, g, s) : g.windows.map((w) => ({ label: w.label, used: w.used, reset: w.reset ?? null, limit: null }));
          return (
            <div key={g.id} data-usage={g.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <p className="m-0 text-[13px] font-semibold">{g.name}</p>
              {rows.length === 0 && <p className="m-0 text-xs text-muted-foreground">{g.reached ? '한도에 닿았어요' : '아직 사용량 정보가 없어요'}</p>}
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{r.label}</span>
                  <Meter value={r.used} label={`${g.name} ${r.label}`} />
                  <span className="text-right tabular-nums">{pct(r.used)}</span>
                  {r.reset != null && <span className="col-start-2 col-end-4 text-[11px] text-muted-foreground">초기화까지 {until(r.reset, now)}</span>}
                </div>
              ))}
            </div>
          );
        })
      )}
      {off.map(([id, x]) => (
        <div key={id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <span className="font-medium">{x?.name || id}</span>
          <span className="text-muted-foreground">연결 안 됨</span>
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => onSettings('providers')}>
            연결
          </Button>
        </div>
      ))}
      <p className="m-0 text-xs text-muted-foreground tabular-nums">
        실행 중 {live.length} · 토큰 {fmtK(live.reduce((a, x) => a + totalTok(x.usage), 0))} · {fmtUsd(live.reduce((a, x) => a + (x.cost ?? 0), 0))}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          {guardOn && settings?.guard
            ? `가드: 5시간 ${guardValue('five', s)}% · 주간 ${guardValue('seven', s)}%에서 새 세션 멈춤`
            : '가드가 꺼져 있어요'}
        </span>
        <button type="button" onClick={() => onSettings('limits')} className="rounded-sm text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          가드 바꾸기 ›
        </button>
      </div>
    </section>
  );
}
