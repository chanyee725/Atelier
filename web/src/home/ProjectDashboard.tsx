// Project dashboard (#686): a 5:5 split under the project head. Left: the project's documents (titles, last changed,
// which agent holds each) with new document / canvas actions. Right: the work in progress: sessions running now,
// and the open GitHub issues as the unit of work (#776; branches and PRs are details of an issue). All live: agents by
// the event stream, sessions by session events, branches and PRs by polling while the page is visible.
// At a narrow main pane (under 880px) the halves stack, documents first.
// The work column splits its height 5:5 (sessions, issues) and lays each card's items out 3 to a row (#720).
import { useMemo } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FilePlus2, FileText, PenTool, Plus, RotateCw } from 'lucide-react';
import type { ProjectInfo } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { cn } from '../lib/utils';
import { Card, CardGrid, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
import { AgentTag } from './AgentPanel';
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
  onCreate: (kind: 'doc' | 'canvas', project: string) => void;
  onDelete: (path: string, title: string) => void;
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
              <Button variant="ghost" size="sm" onClick={() => onCreate('canvas', project.id)}>
                <PenTool aria-hidden /> 새 캔버스
              </Button>
              <Button variant="outline" size="sm" onClick={() => onCreate('doc', project.id)}>
                <Plus aria-hidden /> 새 문서
              </Button>
            </>
          }
        >
          {project.docs.length === 0 ? (
            <EmptyState
              action={
                <Button size="sm" onClick={() => onCreate('doc', project.id)}>
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
        <IssuesCard issues={issues} sessions={sessions} branches={branches} prs={prs} />
      </DashColumn>
    </DashGrid>
  );
}

/** Opens the in-shell 세션 보드 for this project; a real link so a new tab also works (#731). */
function BoardLink({ folder, onBoard }: { folder: string; onBoard: (folder: string) => void }) {
  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
      <a href={`/${boardHash({ tab: 'sessions', folder })}`} onClick={(e) => (plainClick(e) ? (e.preventDefault(), onBoard(folder)) : undefined)}>
        세션 보드 <ArrowRight aria-hidden />
      </a>
    </Button>
  );
}

function SessionsCard({ agents, onRetry, titleOf, onOpen, folder, onBoard }: { agents: AgentPresence[] | 'off' | 'failed' | null; onRetry: () => void; titleOf: (f: string) => string | undefined; onOpen: (p: string) => void; folder: string; onBoard: (folder: string) => void }) {
  const list = Array.isArray(agents) ? agents : [];
  const busy = list.filter(isBusy).length;
  return (
    <Card id="sessions" grow={5} title="실행 중인 세션" count={list.length} hint={busy > 0 ? `${busy}명이 지금 작업 중이에요` : undefined} flush actions={<BoardLink folder={folder} onBoard={onBoard} />}>
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
      ) : list.length === 0 ? (
        <EmptyState>지금 이 프로젝트에서 일하는 세션이 없어요. 계획 문서에서 시작하기를 누르면 여기에 보여요.</EmptyState>
      ) : (
        <CardGrid label="실행 중인 세션">
          {list.map((a) => (
            <SessionRow key={a.sid} agent={a} title={a.file ? titleOf(a.file) ?? fileStem(a.file) : null} onOpen={onOpen} />
          ))}
        </CardGrid>
      )}
    </Card>
  );
}

function SessionRow({ agent: a, title, onOpen }: { agent: AgentPresence; title: string | null; onOpen: (p: string) => void }) {
  const busy = isBusy(a);
  return (
    <li data-agent={a.sid} className="grid min-w-0 content-start gap-1 rounded-md border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <AgentTag agent={a} size="sm" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">{a.outside ? '외부 API' : a.roleName || a.role}</span>
      </div>
      <span className={cn('text-xs', busy ? 'text-foreground' : 'text-muted-foreground')}>
        <StatusDot tone={busy ? 'ok' : needsLook(a) ? 'warn' : 'idle'} pulse={busy}>
          {agentStateLabel(a)}
        </StatusDot>
      </span>
      {(a.modelLabel || a.model) && (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <ProviderIcon provider={a.provider} className="size-3.5 shrink-0" />
          <span className="truncate">{a.modelLabel || a.model}</span>
        </span>
      )}
      {a.file && title ? (
        <button type="button" onClick={() => onOpen(a.file!)} className="inline-flex min-w-0 items-center gap-1 justify-self-start rounded-sm text-xs text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="sr-only">잡고 있는 파일 </span>
          <span className="truncate">{title}</span>
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">잡고 있는 파일 없음</span>
      )}
    </li>
  );
}
