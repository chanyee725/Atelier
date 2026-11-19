// Card dashboard (#686, #793): one grid of compact cards for the project, no document list (the sidebar's 문서 tree
// has the documents). Left: the work in progress, sessions running now and the open GitHub issues as the unit of work
// (#776, #784, #785; issues page to the rows that fit, #800). The sessions card is as tall as its cards and the issues
// card is a fixed 8 rows a page. Right: 사용량 설정 (limits per provider; usage itself is in the sidebar) and PR과 머지,
// whose long list scrolls inside its card; no 최근 문서 card (the sidebar has the documents) and no branch card (branch
// status is the sidebar's 브랜치 row, the board's 브랜치 tab). All live: agents by the event
// stream, sessions by session events, branches, PRs and usage by polling while the page is visible.
// At a narrow main pane (under 880px) the halves stack, work first. Live sessions show as small cards (#799).
import { useMemo } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FileText, LoaderCircle, RotateCw } from 'lucide-react';
import type { ProjectInfo } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { Card, CardGrid, DashColumn, DashGrid, EmptyState } from './dash';
import { cn } from '../lib/utils';
import { AgentTag, RoleBadge } from './AgentPanel';
import { openAgentLive } from '../live/store';
import { agentStateLabel, agentsIn, fileStem, isBusy, isEditingDiagram, needsLook, type AgentPresence } from './agents';
import { allDocs, relativeTime } from './model';
import { useAgents } from './useAgents';
import { IssuesCard, openPrBranches } from './IssuesCard';
import { PrsCard } from './WorkCards';
import { UsageSettingsCard } from './UsageSettingsCard';
import { useIssues, usePrTracking, usePrs, useBranches, useProjectSessions, useSessionBranches } from './projectFeeds';

type Props = {
  project: ProjectInfo;
  onOpen: (path: string) => void;
  /** '' = the whole board (the whole-project dashboard); `tab` picks a board tab (default 세션). */
  onBoard: (folder: string, tab?: 'usage') => void;
};

export function ProjectDashboard({ project, onOpen, onBoard }: Props) {
  const { agents: live, retry } = useAgents();
  const agents = useMemo(() => (Array.isArray(live) ? agentsIn(live, project.path) : live), [live, project.path]);
  const titles = useMemo(() => new Map(allDocs([project], []).map((x) => [x.doc.path, x.doc.title])), [project]);
  const sessions = useProjectSessions(project.path);
  const { open } = useSessionBranches(sessions);
  const tracking = usePrTracking();
  const issues = useIssues(tracking);
  const prBranches = useMemo(() => openPrBranches(issues), [issues]);
  const branches = useBranches([...open.map((s) => s.branch), ...prBranches].join(','));
  const prs = usePrs(prBranches, tracking);

  return (
    <DashGrid ratio="3fr 2fr">
      <DashColumn label="진행 중인 작업" className="*:last:grow-0">
        <SessionsCard agents={agents} onRetry={retry} titleOf={(f) => titles.get(f)} onOpen={onOpen} folder={project.path} onBoard={onBoard} />
        <IssuesCard issues={issues} sessions={sessions} branches={branches} prs={prs} />
      </DashColumn>
      <DashColumn label="현황" className="*:last:grow-0">
        <UsageSettingsCard />
        <PrsCard issues={issues} prs={prs} />
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

function SessionsCard({ agents, onRetry, titleOf, onOpen, folder, onBoard }: { agents: AgentPresence[] | 'off' | 'failed' | null; onRetry: () => void; titleOf: (f: string) => string | undefined; onOpen: (p: string) => void; folder: string; onBoard: (folder: string) => void }) {
  const list = Array.isArray(agents) ? agents : [];
  // As tall as its cards (no share of the column): the issues card below takes the spare height (#784, #793).
  const empty = Array.isArray(agents) && list.length === 0;
  return (
    <Card id="sessions" title="실행 중인 세션" count={list.length} flush actions={<BoardLink folder={folder} onBoard={onBoard} />}>
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
      ) : empty ? null : (
        <CardGrid label="실행 중인 세션">
          {list.map((a) => (
            <SessionCard key={a.sid} agent={a} title={a.file ? titleOf(a.file) ?? fileStem(a.file) : null} onOpen={onOpen} />
          ))}
        </CardGrid>
      )}
    </Card>
  );
}

/**
 * One live session per card (#785, #793): name and run state on top, role badge and model below, then the step it is on
 * and the file it holds. Both lines are split left and right so the card's width is used evenly. The pointer tag (the
 * live cursor's look) shows only while the session edits a diagram (isEditingDiagram); otherwise the name is plain.
 * The card's top part opens the session's live view; the file line opens the document. In a narrow card the state
 * keeps only its icon (under 11rem) and the model moves under the role (under 12rem).
 */
function SessionCard({ agent: a, title, onOpen }: { agent: AgentPresence; title: string | null; onOpen: (p: string) => void }) {
  const busy = isBusy(a);
  const look = !busy && needsLook(a);
  const editing = isEditingDiagram(a);
  const model = a.modelLabel || a.model;
  const state = agentStateLabel(a);
  // Third line: the plan step when there is one, else what it does now (the cursor status, e.g. 다이어그램 작성 중…).
  // The run state is already on the top line, so it is not repeated here.
  const detail = a.step || a.statusLabel || null;
  return (
    <li
      data-agent={a.sid}
      data-busy={busy || undefined}
      data-editing={editing || undefined}
      className="@container/session flex min-w-0 flex-col rounded-md border bg-card text-xs transition-colors hover:bg-accent/40"
    >
      {/* The same live view a 세션 보드 card opens (#728, #785). */}
      <button
        type="button"
        data-agent-live={a.sid}
        title={`${a.name} 진행상황 보기`}
        onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'board' })}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start items-center gap-x-3 gap-y-1.5 rounded-md px-3 pt-2.5 pb-2 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {editing ? (
          <AgentTag agent={a} size="sm" className="-mt-1 min-w-0" />
        ) : (
          <span data-agent-name className="min-w-0 truncate text-[13px] leading-5 font-medium text-foreground">{a.name}</span>
        )}
        <span data-agent-state className={cn('inline-flex items-center gap-1.5 justify-self-end whitespace-nowrap', busy ? 'text-foreground' : 'text-muted-foreground')} title={state}>
          {busy ? (
            <LoaderCircle aria-hidden className="size-3.5 shrink-0 text-ok motion-safe:animate-spin" />
          ) : (
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', look ? 'bg-warn' : 'bg-idle')} />
          )}
          <span className="sr-only @min-[11rem]/session:not-sr-only">{state}</span>
        </span>
        <RoleBadge agent={a} className="justify-self-start" />
        {model ? (
          <span className="col-span-2 inline-flex min-w-0 items-center gap-1 justify-self-start text-muted-foreground @min-[12rem]/session:col-span-1 @min-[12rem]/session:justify-self-end" title={model}>
            <ProviderIcon provider={a.provider} className="size-3 shrink-0" />
            <span className="truncate">{model}</span>
          </span>
        ) : null}
        {detail ? (
          <span className={cn('col-span-2 min-w-0 truncate', a.step ? 'text-foreground' : 'text-muted-foreground')} title={detail}>{detail}</span>
        ) : null}
      </button>
      {/* The file line only when it holds one: no "파일 없음" filler on every idle card (#793). */}
      {a.file && title ? (
        <span className="mt-auto flex min-w-0 items-center gap-3 border-t border-border/60 px-3 py-1.5">
          <button type="button" onClick={() => onOpen(a.file!)} className="inline-flex min-w-0 items-center gap-1 rounded-sm text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="sr-only">잡고 있는 파일 </span>
            <span className="truncate">{title}</span>
          </button>
          {a.at ? <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{relativeTime(a.at)}</span> : null}
        </span>
      ) : null}
    </li>
  );
}
