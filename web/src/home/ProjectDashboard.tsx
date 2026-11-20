// Card dashboard (#686, #793): one grid of compact cards for the project, no document list (the sidebar's 문서 tree
// has the documents). Left: the work in progress, sessions running now and the open GitHub issues as the unit of work
// (#776, #784, #785). Right: 세션 요청 (what sessions asked a person for, #880; it took 사용량 설정's place, the
// sidebar shows model usage) and a tabbed card, PR과 머지 / 사용량 (#819); no 최근
// 문서 card (the sidebar has the documents) and no branch card (branch status is the sidebar's 브랜치 row, the board's
// 브랜치 tab). All live: agents by the event stream, sessions by session events, branches, PRs and usage by polling
// while the page is visible.
// `fill` (#819, the home 대시보드): side by side, both columns end at the pane's bottom edge. 실행 중인 세션 takes 2 parts
// and 이슈 3 parts of the left column (each list scrolls inside; issues page to the rows that fit, the pager on the
// card's bottom edge); the tabbed card takes what 세션 요청 leaves. At a narrow main pane (under 880px) the halves
// stack, work first, and the page scrolls as before. 진행 중인 이슈 (#898) sits between them (as tall as its rows, capped) and only shows
// while an issue has an open session or PR. Live sessions show as small cards, 4 a row (#799, #875).
import { useMemo, type ReactNode } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FileText, RotateCw } from 'lucide-react';
import type { ProjectInfo } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { Card, DashColumn, DashGrid, EmptyState } from './dash';
import { cn } from '../lib/utils';
import { AgentTag, RoleBadge } from './AgentPanel';
import { openAgentLive } from '../live/store';
import { agentStateLabel, agentsIn, fileStem, isBusy, isEditingDiagram, needsLook, type AgentPresence } from './agents';
import { allDocs, relativeTime } from './model';
import { useAgents } from './useAgents';
import { IssuesCard, openPrBranches } from './IssuesCard';
import { PrsCard } from './WorkCards';
import { WorkTabsCard } from './WorkTabsCard';
import { SessionRequestsCard } from './SessionRequestsCard';
import { useIssues, usePrTracking, usePrs, useBranches, useProjectState, useSessionBranches } from './projectFeeds';
import { ActiveIssuesCard } from './ActiveIssuesCard';
import { issueTitles, taskSummary, type TaskSummary } from './taskSummary';
import { TaskSummaryLine } from './TaskSummaryLine';

type Props = {
  project: ProjectInfo;
  onOpen: (path: string) => void;
  /** '' = the whole board (the whole-project dashboard); `tab` picks a board tab (default 세션). */
  onBoard: (folder: string, tab?: 'usage') => void;
  /** Fill the pane to its bottom edge (#819); the parent must be a flex column of fixed height (the home <main>). */
  fill?: boolean;
  /** Opens a session on the 세션 보드 (a 세션 요청 row, #880). */
  onSession?: (id: string) => void;
};

export function ProjectDashboard({ project, onOpen, onBoard, fill, onSession }: Props) {
  const { agents: live, retry } = useAgents();
  const agents = useMemo(() => (Array.isArray(live) ? agentsIn(live, project.path) : live), [live, project.path]);
  const titles = useMemo(() => new Map(allDocs([project], []).map((x) => [x.doc.path, x.doc.title])), [project]);
  const { sessions, tasks } = useProjectState(project.path);
  const { open } = useSessionBranches(sessions);
  const tracking = usePrTracking();
  const issues = useIssues(tracking);
  const prBranches = useMemo(() => openPrBranches(issues), [issues]);
  const branches = useBranches([...open.map((s) => s.branch), ...prBranches].join(','));
  const prs = usePrs(prBranches, tracking);
  // What each session works on (#912): issue title, board task, branch, or the lead's own summary.
  const summaries = useMemo(() => {
    const titleOf = issueTitles(issues && issues !== 'failed' && issues.ok ? issues.issues : null);
    const list = Array.isArray(sessions) ? sessions : [];
    return new Map(list.map((s) => [s.id, taskSummary(s, titleOf, tasks)]));
  }, [sessions, tasks, issues]);

  return (
    <DashGrid ratio="3fr 2fr" fill={fill}>
      <DashColumn label="진행 중인 작업" fill={fill}>
        <SessionsCard agents={agents} summaryOf={(sid) => summaries.get(sid) ?? null} onRetry={retry} titleOf={(f) => titles.get(f)} onOpen={onOpen} folder={project.path} onBoard={onBoard} />
        <ActiveIssuesCard issues={issues} sessions={sessions} tasks={tasks} prs={prs} />
        <IssuesCard issues={issues} sessions={sessions} branches={branches} prs={prs} fill={fill ? 3 : undefined} />
      </DashColumn>
      <DashColumn label="현황" fill={fill}>
        <SessionRequestsCard sessions={sessions} folder={project.path} onOpen={onOpen} onSession={onSession} />
        {fill ? <WorkTabsCard issues={issues} prs={prs} onBoard={onBoard} /> : <PrsCard issues={issues} prs={prs} />}
      </DashColumn>
    </DashGrid>
  );
}

/** Opens the in-shell 세션 보드 for this project; a real link so a new tab also works (#731). */
function BoardLink({ folder, onBoard }: { folder: string; onBoard: (folder: string) => void }) {
  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
      <a href={`/${boardHash({ tab: 'sessions', folder: folder || undefined })}`} onClick={(e) => (plainClick(e) ? (e.preventDefault(), onBoard(folder)) : undefined)}>
        세션 보드 <ArrowRight aria-hidden />
      </a>
    </Button>
  );
}

function SessionsCard({ agents, summaryOf, onRetry, titleOf, onOpen, folder, onBoard, fill }: { agents: AgentPresence[] | 'off' | 'failed' | null; summaryOf: (sid: string) => TaskSummary | null; onRetry: () => void; titleOf: (f: string) => string | undefined; onOpen: (p: string) => void; folder: string; onBoard: (folder: string) => void; fill?: number }) {
  const list = Array.isArray(agents) ? agents : [];
  // Filled (#819): a fixed share of the column, its cards scroll inside. Otherwise as tall as its cards (#784, #793).
  const empty = Array.isArray(agents) && list.length === 0;
  // The dashboard's one standout (#889 refresh): how many sessions are working right now, as a large number.
  const working = list.filter(isBusy).length;
  const actions = (
    <>
      {working > 0 && (
        <span data-working className="mr-1 inline-flex items-baseline gap-1">
          <span className="text-xl leading-none font-semibold tracking-title tabular-nums">{working}</span>
          <span className="text-xs text-muted-foreground">개가 지금 작업 중이에요</span>
        </span>
      )}
      <BoardLink folder={folder} onBoard={onBoard} />
    </>
  );
  return (
    <Card id="sessions" title="실행 중인 세션" count={list.length} flush fill={fill} actions={actions}>
      {agents === null ? (
        <EmptyState>불러오는 중이에요</EmptyState>
      ) : agents === 'failed' ? (
        <EmptyState
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden /> 다시 시도
            </Button>
          }
        >
          세션 목록을 불러오지 못했어요.
        </EmptyState>
      ) : agents === 'off' ? (
        <EmptyState>이 서버는 세션 목록을 보내지 않아요.</EmptyState>
      ) : empty ? (
        fill === undefined ? null : (
          <EmptyState className="@min-[880px]:flex-1 @min-[880px]:items-center @min-[880px]:justify-center">지금 실행 중인 세션이 없어요.</EmptyState>
        )
      ) : (
        <SessionGrid label="실행 중인 세션">
          {list.map((a) => (
            <SessionCard key={a.sid} agent={a} summary={summaryOf(a.sid)} title={a.file ? titleOf(a.file) ?? fileStem(a.file) : null} onOpen={onOpen} />
          ))}
        </SessionGrid>
      )}
    </Card>
  );
}

/**
 * Session cards in rows of 4 (#875): 4 a row when the card is wide enough (the home 대시보드 at 1660px), else 2,
 * else 1. CSS grid on the card's own width (a container query), so the columns follow the pane, not the window.
 * Breakpoints keep each card at about 180px or more: name and state text stay on one line (#819).
 */
function SessionGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="@container/sessions">
      <ul aria-label={label} data-session-grid className="m-0 grid list-none grid-cols-1 content-start gap-2 p-2 @min-[24rem]/sessions:grid-cols-2 @min-[47.5rem]/sessions:grid-cols-4">
        {children}
      </ul>
    </div>
  );
}

/**
 * One live session per card (#785, #793, #889): name, role badge and run state (dot + word) on top; right under it what
 * the session works on (#912, when any source says); then a line with the plan step or what it does now (else a quiet idle/working note); a track that sweeps while it works; then model
 * left and time right. The pointer tag (the live cursor's look) shows only while the session edits a diagram
 * (isEditingDiagram); otherwise the name is plain. The card's body opens the session's live view; the file it holds
 * is its own link under the body (shown once, there).
 */
function SessionCard({ agent: a, summary, title, onOpen }: { agent: AgentPresence; summary: TaskSummary | null; title: string | null; onOpen: (p: string) => void }) {
  const busy = isBusy(a);
  const look = !busy && needsLook(a);
  const editing = isEditingDiagram(a);
  const model = a.modelLabel || a.model;
  const state = agentStateLabel(a);
  // Second line (refresh mock, #889): the plan step, else what it does now, else the file it holds.
  const detail = a.step || a.statusLabel || null;
  // Only the dot carries the working colour: 12px text-ok misses contrast on the light theme.
  const tone = busy ? 'text-foreground' : look ? 'text-warn' : 'text-muted-foreground';
  const dotTone = busy ? 'bg-ok' : look ? 'bg-warn' : 'bg-muted-foreground';
  return (
    <li
      data-agent={a.sid}
      data-busy={busy || undefined}
      data-editing={editing || undefined}
      className="flex min-w-0 flex-col rounded-card bg-background text-xs transition-colors hover:bg-accent/60"
    >
      {/* The same live view a 세션 보드 card opens (#728, #785). */}
      <button
        type="button"
        data-agent-live={a.sid}
        title={`${a.name} 진행상황 보기`}
        onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'board' })}
        className="press flex min-w-0 flex-col gap-2 rounded-card p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {editing ? (
              <AgentTag agent={a} size="sm" className="-mt-1 min-w-0" />
            ) : (
              <span data-agent-name className="min-w-0 truncate text-[15px] leading-5 font-semibold tracking-[-0.01em] text-foreground">{a.name}</span>
            )}
            <RoleBadge agent={a} className="shrink-0" />
            <span data-agent-state className={cn('ml-auto inline-flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap', tone)} title={state}>
              <span aria-hidden className={cn('session-dot size-1.5 shrink-0 rounded-full', dotTone, busy && 'is-on', !busy && !look && 'opacity-60')} />
              {state}
            </span>
          </span>
          {summary ? <TaskSummaryLine summary={summary} /> : null}
        </span>
        <span className={cn('min-w-0 truncate', detail ? 'text-foreground/80' : 'text-muted-foreground')} title={detail ?? undefined}>
          {detail ?? (busy ? '작업 중이에요' : '다음 지시를 기다려요')}
        </span>
        {/* Working: a sliver sweeps the track (the one moving thing on the dashboard); idle: a quiet line. */}
        <span aria-hidden className={cn('session-track', busy && 'is-on')} />
        <span className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground tabular-nums">
          {model ? (
            <span className="inline-flex min-w-0 items-center gap-1" title={model}>
              <ProviderIcon provider={a.provider} className="size-3 shrink-0" />
              <span className="truncate">{model}</span>
            </span>
          ) : <span />}
          {a.at ? <span className="shrink-0 whitespace-nowrap">{relativeTime(a.at)}</span> : null}
        </span>
      </button>
      {/* The file it holds, as its own link under the card body (#793). */}
      {a.file && title ? (
        <span className="flex min-w-0 items-center border-t px-3 py-1.5">
          <button type="button" onClick={() => onOpen(a.file!)} className="inline-flex min-w-0 items-center gap-1 rounded-sm text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="sr-only">잡고 있는 파일 </span>
            <span className="truncate">{title}</span>
          </button>
        </span>
      ) : null}
    </li>
  );
}
