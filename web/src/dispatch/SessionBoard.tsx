// 세션 보드 inside the Atelier shell (#731), as a card dashboard on the home's dash primitives (#879): no header or tab
// row and no 프로젝트 card (one project per server, #778; the scope still comes from the address). Left: 세션 and
// 타임라인; right: 사용량 and 작업 보드. `#board=usage` and `#board=branches` open their full screen in one card;
// `#board=timeline` opens the dashboard at the 타임라인 card.
// Rendered by App.tsx for `section.kind === 'board'` (the /dispatch address redirects there).
// Loaded lazily so the editor bundle does not carry it. Numbers and names only: no transcript text is read here.
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/PageHeader';
import { projectsApi, type DispatchSettings, type ProjectInfo } from '../api';
import { boardHash, plainClick, type BoardExtra, type BoardTab } from '../projectNav';
import { Card, DashColumn, DashGrid, EmptyState } from '../home/dash';
import { boardRows } from '../lib/usageCardRows';
import { useUsage } from '../lib/usage';
import { OffNote, useDispatchStatus } from '../settings/DispatchOff';
import { guardValue, type SectionId } from '../settings/model';
import { elapsed } from '../../../shared/dispatch/attention.ts';
import { AlertWatcher } from './AlertWatcher';
import { AlwaysOnView } from './AlwaysOnView';
import { BranchesPage } from './BranchesView';
import { AttentionStrip, SummaryLine, useNow } from './AttentionStrip';
import { CreateSessionDialog } from './CreateSessionDialog';
import { boardGroups, type BoardGroup } from './lib/boardGroups.ts';
import { knownFolders, scopePending, type Scope } from './lib/folder.ts';
import { fmtK, fmtUsd, isOpen, pct, STATE, stateOf, TONE_TEXT, totalTok, until } from './lib/format.ts';
import { stateStart } from './lib/order.ts';
import { nowLine } from './lib/turn.ts';
import { Meter, ModelTag, STATE_ICON } from './parts';
import { ScopeProvider, useScope, useScoped } from './scope';
import { openAgentLive, useAgentLiveTarget } from '../live/store';
import { shownAccount, useAccountLabels } from '../accountLabels';
import { TimelineCard } from './TimelineCard';
import { TaskBoardCard } from './TaskBoard';
import { UsagePage } from './UsagePage';
import { api, connect, useDispatch } from './store';
import { usePrTracking, useStatusLine } from './usePrTracking';
import type { Session } from './types';
import { askConfirm } from '../appDialog';
import { useIssues, usePrTracking as usePrTrackingOn } from '../home/projectFeeds';
import { issueTitles, taskSummary, type TaskSummary } from '../home/taskSummary';
import { TaskSummaryLine } from '../home/TaskSummaryLine';

const SettingsDialog = lazy(() => import('../settings/SettingsDialog'));

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
  /** The 알림함 bell (#786), at the right end of the page header. */
  bell?: ReactNode;
  /** Narrow window: the header shows the sidebar trigger. */
  narrow?: boolean;
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
  const pending = scopePending(scope, listState);
  const ctx = useMemo(() => ({ scope, known, names, pending }), [scope, known, names, pending]);
  useEffect(() => connect(), []);

  // The one place a session opens (design §4): its live progress view (#728). The sheet (chat, stop) is reached from there.
  const openSession = (id: string, from?: HTMLElement | null) => openAgentLive(id, { trigger: from ?? undefined, from: 'board' });
  const open = useAgentLiveTarget();
  const liveRef = useRef(open);
  liveRef.current = open;
  const openRef = useRef(openSession);
  openRef.current = openSession;
  useEffect(() => {
    if (p.openRequest && liveRef.current !== p.openRequest.id) openRef.current(p.openRequest.id, null);
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

  if (tv && ready && !unavailable) {
    return (
      <div className="fixed inset-0 z-40 overflow-auto bg-background">
        {/* Opening a tile leaves the always-on screen, so Esc in the sheet never also closes the wall view. */}
        <AlwaysOnView onExit={() => setTv(false)} onOpen={(id) => { setTv(false); openSession(id, null); }} />
      </div>
    );
  }

  const offline = ready && !online && !unavailable;
  const disabled = !ready || unavailable;
  const detail = p.tab === 'usage' || p.tab === 'branches' ? p.tab : null;
  return (
    <ScopeProvider value={ctx}>
      <div data-session-board className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {offline && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>}
        {/* Same header as 대시보드 (2026-11-20); the 브랜치/사용량 views name themselves. */}
        {!detail && (
          <PageHeader
            title="세션 보드"
            narrow={p.narrow}
            bell={p.bell}
            actions={
              <>
                <NewSessionButton disabled={disabled} onCreate={() => setCreating(true)} />
                <BoardMenu onTv={() => setTv(true)} onSettings={() => setSettings('general')} onBranches={() => p.onRoute('branches', scope)} disabled={disabled} />
              </>
            }
          />
        )}
        <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto', offline && 'opacity-60')}>
          {/* The live region stays mounted so the notice is read when it appears. */}
          <div role="status">
            {listState === 'failed' && !unavailable && ready && (
              <p className="m-0 border-b px-4 py-2 text-sm text-muted-foreground">프로젝트 목록을 불러오지 못했어요. 작업 폴더 이름으로 묶어서 보여 줘요.</p>
            )}
          </div>
          {unavailable ? (
            <OffNote status={offStatus} className="m-4" />
          ) : !ready ? (
            <Skeleton />
          ) : detail ? (
            <DetailView tab={detail} scope={scope} onRoute={p.onRoute} bell={p.bell} narrow={p.narrow} />
          ) : (
            <DashGrid ratio="minmax(0,1fr) minmax(16rem,22rem)">
              {/* No 프로젝트 card: this server holds one project (#778). Left: 세션 and 타임라인; right: 사용량 and 작업 보드,
                  whose last card takes the spare height so neither column leaves an empty band (#879). */}
              <DashColumn label="세션">
                <SessionsCard
                  open={open}
                  onOpen={openSession}
                  onUsage={() => p.onRoute('usage', scope)}
                  onCreate={() => setCreating(true)}
                  byCwd={listState === 'failed'}
                />
                <TimelineCard projectId={scope} onOpen={(id) => openSession(id)} focus={p.tab === 'timeline'} />
              </DashColumn>
              {/* Sticky on a wide pane: 사용량 and 작업 보드 stay in view while 세션 and 타임라인 scroll. */}
              <DashColumn label="현황" className="@min-[880px]:sticky @min-[880px]:top-4 @min-[880px]:max-h-[calc(100dvh-2rem)] @min-[880px]:self-start">
                <UsageCard onSettings={setSettings} onMore={() => p.onRoute('usage', scope)} />
                <TaskBoardCard fill />
              </DashColumn>
            </DashGrid>
          )}
        </main>
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

function NewSessionButton({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  const connected = useDispatch((s) => Object.values(s.providers ?? {}).some((x) => x?.connected));
  return (
    <Button size="sm" variant="outline" disabled={disabled || !connected} title={connected ? undefined : '연결된 모델이 없어요'} onClick={onCreate}>
      <Plus aria-hidden />
      <span className="max-sm:sr-only">새 세션</span>
    </Button>
  );
}

/** A link to a board address that routes in place on a plain click (a new tab still gets the address). */
function BoardLink({ tab, folder, onRoute, className, children, ...rest }: { tab: BoardTab; folder: Scope; onRoute: BoardProps['onRoute']; className?: string; children: ReactNode } & Omit<React.ComponentProps<'a'>, 'href' | 'onClick'>) {
  return (
    <a
      {...rest}
      href={boardHash({ tab, folder })}
      onClick={(e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        onRoute(tab, folder);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/** `#board=usage` / `#board=branches`: that screen in one full-width card, with the way back to the dashboard. */
function DetailView({ tab, scope, onRoute, bell, narrow }: { tab: 'usage' | 'branches'; scope: Scope; onRoute: BoardProps['onRoute']; bell?: ReactNode; narrow?: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageHeader
        title={tab === 'usage' ? '사용량' : '브랜치'}
        narrow={narrow}
        bell={bell}
        actions={
          <Button size="sm" variant="ghost" asChild>
            <BoardLink tab="sessions" folder={scope} onRoute={onRoute}>
              <ArrowLeft aria-hidden />
              세션 보드
            </BoardLink>
          </Button>
        }
      />
      <div data-card={tab} className="min-w-0">{tab === 'usage' ? <UsagePage /> : <BranchesPage />}</div>
    </div>
  );
}

/** ⋯ menu: 끝난 세션 정리, 모든 세션 정리 (asks first), PR·CI 추적, 브랜치, 상시 화면, 설정. */
function BoardMenu({ onTv, onSettings, onBranches, disabled }: { onTv: () => void; onSettings: () => void; onBranches: () => void; disabled: boolean }) {
  const sessions = useDispatch((s) => s.sessions);
  const doneCount = sessions.filter((s) => !isOpen(s)).length;
  const { note, status } = useStatusLine();
  const { pr, toggle, broken } = usePrTracking(status, '');
  const [said, setSaid] = useState('');
  const clear = async (all: boolean) => {
    if (all && !(await askConfirm({ title: `세션 ${sessions.length}개를 모두 정리할까요?`, body: '실행 중인 세션도 멈춰요.', ok: '모두 정리', danger: true }))) return;
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
          <DropdownMenuItem disabled={!sessions.length} className="text-destructive focus:text-destructive" onSelect={() => void clear(true)}>
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
          <DropdownMenuItem onSelect={onBranches}>브랜치</DropdownMenuItem>
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
    <div role="status" aria-busy="true" aria-label="불러오는 중이에요" className="flex flex-col gap-6 p-4">
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

/** 세션 card: the summary and what needs a person, then the picked project's sessions grouped by project. */
function SessionsCard({
  open,
  onOpen,
  onUsage,
  onCreate,
  byCwd,
  actions,
}: {
  open: string | null;
  onOpen: (id: string, from?: HTMLElement | null) => void;
  onUsage: () => void;
  onCreate: () => void;
  byCwd: boolean;
  actions?: ReactNode;
}) {
  const { sessions, scope, pending } = useScoped();
  const { known, names } = useScope();
  const all = useDispatch((s) => s.sessions);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  // What each session works on (#912): issue title (the issue feed, while PR tracking is on), board task, branch, or the
  // lead's own summary.
  const tasks = useDispatch((s) => s.tasks);
  const issues = useIssues(usePrTrackingOn());
  const summaries = useMemo(() => {
    const titleOf = issueTitles(issues && issues !== 'failed' && issues.ok ? issues.issues : null);
    return new Map(sessions.map((s) => [s.id, taskSummary(s, titleOf, tasks)]));
  }, [sessions, tasks, issues]);
  const now = useNow(20_000);
  const groups = useMemo(() => boardGroups(sessions, { known, names, stateOf, byCwd }), [sessions, known, names, byCwd]);
  return (
    <Card id="sessions" title="세션" count={pending ? undefined : sessions.filter(isOpen).length} actions={actions}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <SummaryLine />
          <AttentionStrip onOpen={(id) => onOpen(id)} onUsage={onUsage} />
        </div>
        {pending ? null : sessions.length === 0 ? (
          <EmptyState
            className="px-0 py-2"
            action={
              <Button size="sm" variant="outline" onClick={onCreate}>
                <Plus aria-hidden />새 세션
              </Button>
            }
          >
            실행 중인 세션이 없어요. 새 세션을 만들면 여기에 보여요.
          </EmptyState>
        ) : (
          // The query container wraps the grid: an element can't answer its own container query, so the columns
          // were never set on the grid itself and every row stacked into one column.
          <div className="@container/list">
            <div className="grid gap-y-5 @min-[560px]/list:grid-cols-[1.25rem_minmax(4rem,max-content)_minmax(4rem,max-content)_minmax(0,max-content)_minmax(0,1fr)_max-content_1rem] @min-[560px]/list:gap-x-3">
              {groups.map((g) => (
                <Group key={g.key ?? '\0'} g={g} scoped={scope !== undefined} open={open} now={now} byId={byId} summaries={summaries} onOpen={onOpen} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

const SUBGRID = '@min-[560px]/list:col-span-full @min-[560px]/list:grid @min-[560px]/list:grid-cols-subgrid';

function Group({
  g,
  scoped,
  open,
  now,
  byId,
  summaries,
  onOpen,
}: {
  g: BoardGroup<Session>;
  scoped: boolean;
  open: string | null;
  now: number;
  byId: Map<string, Session>;
  summaries: Map<string, TaskSummary | null>;
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
            aria-label={`${g.label} 세션`}
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:size-9"
          >
            {collapsed ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
          </button>
        )}
      </div>
      <div id={body} className={cn('flex min-w-0 flex-col gap-1.5', SUBGRID, '@min-[560px]/list:gap-y-1.5')}>
        {shown.map((s) => (
          <Row key={s.id} s={s} parent={s.parent ? byId.get(s.parent) : undefined} summary={summaries.get(s.id) ?? null} now={now} expanded={open === s.id} onOpen={onOpen} />
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

function Row({ s, parent, summary, now, expanded, onOpen }: { s: Session; parent?: Session; summary: TaskSummary | null; now: number; expanded: boolean; onOpen: (id: string, from?: HTMLElement | null) => void }) {
  const state = stateOf(s);
  const meta = STATE[state] ?? STATE.resting;
  const Icon = STATE_ICON[state];
  const since = elapsed(stateStart(s, state), now);
  const flag = state === 'waiting' || state === 'stuck' || !!s.stall;
  const failed = state === 'failed';
  // The label the session started under when the server records one (#747), else the provider's current label.
  const labels = useAccountLabels();
  const account = shownAccount(s.provider, s.accountLabel, labels);
  const wide = '@min-[560px]/list:col-auto @min-[560px]/list:row-auto';
  return (
    <button
      type="button"
      data-session={s.id}
      data-session-live={s.id}
      aria-expanded={expanded}
      onClick={(e) => onOpen(s.id, e.currentTarget)}
      title={parent ? `${parent.name}이(가) 만든 세션` : undefined}
      className={cn(
        'grid min-h-11 min-w-0 grid-cols-[1.25rem_auto_minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-0.5 rounded-card border-l-2 border-transparent bg-background px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        '@min-[560px]/list:col-span-full @min-[560px]/list:grid-cols-subgrid @min-[560px]/list:gap-x-3 @min-[560px]/list:py-0',
        flag && 'border-warn bg-warn/5',
        failed && 'border-destructive bg-destructive/5',
        expanded && 'bg-sunken',
      )}
    >
      <Icon aria-hidden className={cn('size-4 shrink-0', TONE_TEXT[meta.tone])} strokeWidth={meta.tone === 'warn' || meta.tone === 'bad' ? 2.5 : 2} />
      <span className="min-w-0 truncate font-semibold">
        {s.name}
        <span className="sr-only"> {meta.label}</span>
      </span>
      <span data-role-chip className="inline-flex h-5 min-w-0 items-center gap-1.5 justify-self-start rounded-[4px] px-1.5 text-xs text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--role-${s.role}, var(--idle))` }} />
        <span className="truncate">{s.roleName || s.role}</span>
      </span>
      <span className="col-span-3 col-start-2 row-start-2 flex min-w-0 items-center gap-2 @min-[560px]/list:contents">
        <ModelTag provider={s.provider} label={`${s.modelLabel}${s.effort ? ` ${s.effort}` : ''}`} account={account} className="max-w-56 shrink-0" />
        {/* What it works on (#912) above what it does now; one line each. */}
        <span className="flex min-w-0 flex-1 flex-col">
          {summary ? <TaskSummaryLine summary={summary} /> : null}
          <span className={cn('min-w-0 truncate text-muted-foreground', (flag || failed) && 'text-foreground', summary && 'text-xs')}>{stepText(s, now)}</span>
        </span>
      </span>
      <span className={cn('col-start-4 row-start-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums', wide)} title="이 상태가 된 뒤 지난 시간">
        {flag || failed ? `${meta.label} · ` : ''}
        {since ? `${since}째` : '방금'}
      </span>
      <ChevronRight aria-hidden className={cn('col-start-5 row-start-1 size-4 text-muted-foreground', wide)} />
    </button>
  );
}

/** 사용량 card: each connected provider's limits, the open sessions' totals and the guard; 자세히 opens #board=usage. */
function UsageCard({ onSettings, onMore, className }: { onSettings: (s: SectionId) => void; onMore: () => void; className?: string }) {
  // Per-provider windows from /api/limits, the same read as the sidebar card; the store's `limits` is only the flat
  // Claude guard shape, so reading groups from it left Claude's 5시간 and 주간 at '—' (#897).
  const usage = useUsage();
  const providers = useDispatch((s) => s.providers);
  const settings = useDispatch((s) => s.settings);
  const sessions = useDispatch((s) => s.sessions);
  const groups = Array.isArray(usage) ? usage : [];
  const off = Object.entries(providers ?? {}).filter(([, x]) => !x?.connected);
  const live = sessions.filter(isOpen);
  const s = settings as unknown as DispatchSettings;
  const guardOn = !!settings?.guard?.enabled;
  const now = Date.now();
  return (
    <Card
      id="usage"
      title="사용량"
      className={className}
      actions={
        <Button size="sm" variant="ghost" onClick={onMore}>
          자세히
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {usage === null ? (
          <p className="m-0 text-xs text-muted-foreground">불러오는 중이에요…</p>
        ) : usage === 'failed' ? (
          <p className="m-0 text-xs text-muted-foreground">사용량을 불러오지 못했어요.</p>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="m-0">연결된 모델이 없어요</p>
            <Button size="sm" variant="outline" onClick={() => onSettings('providers')}>
              모델 연결
            </Button>
          </div>
        ) : (
          groups.map((g) => {
            const rows = boardRows(g, s);
            return (
              <div key={g.id} data-usage={g.id} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
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
          <div key={id} className="flex items-center gap-2 border-t pt-2 text-xs">
            <span className="font-medium">{x?.name || id}</span>
            <span className="text-muted-foreground">연결 안 됨</span>
            <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => onSettings('providers')}>
              연결
            </Button>
          </div>
        ))}
        <p className="m-0 border-t pt-3 text-xs text-muted-foreground tabular-nums">
          실행 중 {live.length} · 토큰 {fmtK(live.reduce((a, x) => a + totalTok(x.usage), 0))} · {fmtUsd(live.reduce((a, x) => a + (x.cost ?? 0), 0))}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {guardOn && settings?.guard
              ? `가드: 5시간 ${guardValue('five', s)}% · 주간 ${guardValue('seven', s)}%에서 새 세션을 멈춰요`
              : '가드가 꺼져 있어요'}
          </span>
          <button type="button" onClick={() => onSettings('limits')} className="inline-flex min-h-6 items-center rounded-sm text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            가드 바꾸기 ›
          </button>
        </div>
      </div>
    </Card>
  );
}
