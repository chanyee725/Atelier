// Project dashboard (#686): a 5:5 split under the project head. Left: the project's documents (titles, last changed,
// which agent holds each) with new document / canvas actions. Right: the work in progress: sessions running now,
// and the open GitHub issues as the unit of work (#776; branches and PRs are details of an issue). All live: agents by
// the event stream, sessions by session events, branches and PRs by polling while the page is visible.
// At a narrow main pane (under 880px) the halves stack, documents first.
// The work column splits its height 5:5 (sessions, issues); both list one dense row per item (#784, #785), and an
// empty sessions card shrinks to its header.
import { useMemo } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FilePlus2, FileText, LoaderCircle, PenTool, Plus, RotateCw } from 'lucide-react';
import type { ProjectInfo } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { Card, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
import { AgentTag } from './AgentPanel';
import { openAgentLive } from '../live/store';
import { agentStateLabel, agentsIn, fileStem, holdersByFile, isBusy, needsLook, type AgentPresence } from './agents';
import { ColumnHead, DocList } from './DocList';
import { allDocs, filterDocs } from './model';
import { useAgents } from './useAgents';
import { IssuesCard, openPrBranches } from './IssuesCard';
import { useIssues, usePrTracking, usePrs, useBranches, useProjectSessions, useSessionBranches } from './projectFeeds';

type Props = {
  project: ProjectInfo;
  query: string;
  running: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  /** null = the workspace root (the whole-project dashboard, #778). */
  onCreate: (kind: 'doc' | 'canvas', project: string | null) => void;
  onDelete: (path: string, title: string) => void;
  /** '' = the whole board (the whole-project dashboard). */
  onBoard: (folder: string) => void;
};

export function ProjectDashboard({ project, query, running, collapsed, onToggle, onOpen, onCreate, onDelete, onBoard }: Props) {
  const { agents: live, retry } = useAgents();
  const agents = useMemo(() => (Array.isArray(live) ? agentsIn(live, project.path) : live), [live, project.path]);
  const holders = useMemo(() => holdersByFile(Array.isArray(agents) ? agents : []), [agents]);
  const titles = useMemo(() => new Map(allDocs([project], []).map((x) => [x.doc.path, x.doc.title])), [project]);
  const sessions = useProjectSessions(project.path);
  const { open } = useSessionBranches(sessions);
  const tracking = usePrTracking();
  const issues = useIssues(tracking);
  const prBranches = useMemo(() => openPrBranches(issues), [issues]);
  const branches = useBranches([...open.map((s) => s.branch), ...prBranches].join(','));
  const prs = usePrs(prBranches, tracking);
  const docs = filterDocs(project.docs, query);

  return (
    <DashGrid>
      <DashColumn label="문서">
        <Card
          id="docs"
          title="문서"
          count={project.docCount}
          flush
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => onCreate('canvas', project.id || null)}>
                <PenTool aria-hidden /> 새 캔버스
              </Button>
              <Button variant="outline" size="sm" onClick={() => onCreate('doc', project.id || null)}>
                <Plus aria-hidden /> 새 문서
              </Button>
            </>
          }
        >
          {project.docs.length === 0 ? (
            <EmptyState
              action={
                <Button size="sm" onClick={() => onCreate('doc', project.id || null)}>
                  <FilePlus2 aria-hidden /> 첫 문서 만들기
                </Button>
              }
            >
              이 프로젝트에는 아직 문서가 없어요.
            </EmptyState>
          ) : docs.length === 0 ? (
            <EmptyState>맞는 문서가 없어요</EmptyState>
          ) : (
            <>
              <ColumnHead showCreated={false} />
              <DocList docs={docs} collapsed={collapsed} label={`${project.name} 문서`} running={running} holders={holders} showCreated={false} onOpen={onOpen} onToggle={onToggle} onDelete={onDelete} />
            </>
          )}
        </Card>
      </DashColumn>

      <DashColumn label="진행 중인 작업">
        <SessionsCard agents={agents} onRetry={retry} titleOf={(f) => titles.get(f)} onOpen={onOpen} folder={project.path} onBoard={onBoard} />
        <IssuesCard issues={issues} sessions={sessions} branches={branches} prs={prs} filterKey={query} />
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
