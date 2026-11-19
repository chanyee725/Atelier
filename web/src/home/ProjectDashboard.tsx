// Card dashboard (#686, #793): one grid of compact cards for the project, no document list (the sidebar's 문서 tree
// has the documents). Left: the work in progress, sessions running now and the open GitHub issues as the unit of work
// (#776, #784, #785; issues page to the rows that fit, #800). Right: 사용량, 브랜치, PR과 머지 and 최근 문서, whose long
// lists scroll inside their card so the page keeps one screen. All live: agents by the event stream, sessions by
// session events, branches, PRs and usage by polling while the page is visible.
// At a narrow main pane (under 880px) the halves stack, work first.
import { useMemo } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FileText, LoaderCircle, RotateCw } from 'lucide-react';
import type { ProjectInfo, RecentFile } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { Card, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
import { AgentTag } from './AgentPanel';
import { openAgentLive } from '../live/store';
import { agentStateLabel, agentsIn, fileStem, isBusy, needsLook, type AgentPresence } from './agents';
import { allDocs } from './model';
import { useAgents } from './useAgents';
import { IssuesCard, openPrBranches } from './IssuesCard';
import { BranchesCard, PrsCard, RecentDocsCard, UsageCard } from './WorkCards';
import { useIssues, usePrTracking, usePrs, useBranches, useProjectSessions, useSessionBranches } from './projectFeeds';

/** Rows of the 최근 문서 card. */
const RECENT_DOCS = 12;

type Props = {
  project: ProjectInfo;
  /** Every document of the dashboard's scope, newest change first; the card shows the first few. */
  recent: readonly RecentFile[];
  onOpen: (path: string) => void;
  /** '' = the whole board (the whole-project dashboard); `tab` picks a board tab (default 세션). */
  onBoard: (folder: string, tab?: 'usage') => void;
};

export function ProjectDashboard({ project, recent, onOpen, onBoard }: Props) {
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
      <DashColumn label="진행 중인 작업">
        <SessionsCard agents={agents} onRetry={retry} titleOf={(f) => titles.get(f)} onOpen={onOpen} folder={project.path} onBoard={onBoard} />
        <IssuesCard issues={issues} sessions={sessions} branches={branches} prs={prs} />
      </DashColumn>
      <DashColumn label="현황">
        <UsageCard onBoard={onBoard} />
        <BranchesCard branches={branches} grow={1} />
        <PrsCard issues={issues} prs={prs} grow={1} />
        <RecentDocsCard files={recent.slice(0, RECENT_DOCS)} onOpen={onOpen} grow={1} />
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
  // Nothing live: just the header line, so the empty box does not take half the column (#784).
  const empty = Array.isArray(agents) && list.length === 0;
  return (
    <Card id="sessions" grow={empty ? undefined : 5} title="실행 중인 세션" count={list.length} flush actions={<BoardLink folder={folder} onBoard={onBoard} />}>
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
        <ul aria-label="실행 중인 세션" className="m-0 list-none divide-y p-0">
          {list.map((a) => (
            <SessionRow key={a.sid} agent={a} title={a.file ? titleOf(a.file) ?? fileStem(a.file) : null} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One live session per row (#785): name tag, role and model, the step or file it is on, and a spinner only while it
 * is working (running or starting). An idle session shows nothing extra; one that needs a person gets an amber dot.
 */
function SessionRow({ agent: a, title, onOpen }: { agent: AgentPresence; title: string | null; onOpen: (p: string) => void }) {
  const busy = isBusy(a);
  const look = !busy && needsLook(a);
  const model = a.modelLabel || a.model;
  return (
    <li data-agent={a.sid} data-busy={busy || undefined} className="flex h-9 min-w-0 items-center gap-2 pr-3 text-xs hover:bg-accent/40">
      {/* The row's left part opens the session's live view, the same one a 세션 보드 card opens (#728, #785). */}
      <button
        type="button"
        data-agent-live={a.sid}
        title={`${a.name} 진행상황 보기`}
        onClick={(e) => openAgentLive(a.sid, { trigger: e.currentTarget, from: 'board' })}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-3 text-left focus-visible:bg-accent focus-visible:outline-none"
      >
        <AgentTag agent={a} size="sm" className="-mt-1 max-w-[9rem]" />
        <span className="min-w-0 shrink truncate text-muted-foreground">{a.outside ? '외부 API' : a.roleName || a.role}</span>
        {model && (
          <span className="inline-flex min-w-0 shrink items-center gap-1 text-muted-foreground" title={model}>
            <ProviderIcon provider={a.provider} className="size-3 shrink-0" />
            <span className="truncate">{model}</span>
          </span>
        )}
        {a.step && <span className="ml-auto min-w-0 truncate text-foreground" title={a.step}>{a.step}</span>}
      </button>
      <span className="flex max-w-[45%] min-w-0 items-center gap-2">
        {!a.step && a.file && title ? (
          <button type="button" onClick={() => onOpen(a.file!)} className="inline-flex min-w-0 items-center gap-1 rounded-sm text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="sr-only">잡고 있는 파일 </span>
            <span className="truncate">{title}</span>
          </button>
        ) : null}
        {busy ? (
          <span className="inline-flex shrink-0 items-center" title={agentStateLabel(a)}>
            <LoaderCircle aria-hidden className="size-3.5 text-ok motion-safe:animate-spin" />
            <span className="sr-only">{agentStateLabel(a)}</span>
          </span>
        ) : look ? (
          <StatusDot tone="warn">
            <span className="text-muted-foreground">{agentStateLabel(a)}</span>
          </StatusDot>
        ) : (
          <span className="sr-only">{agentStateLabel(a)}</span>
        )}
      </span>
    </li>
  );
}
