// Project dashboard (#686): a 5:5 split under the project head. Left: the project's documents (titles, last changed,
// which agent holds each) with new document / canvas actions. Right: the work in progress: sessions running now,
// their branches against develop, and the PRs of those branches with review, CI and conflicts. All live: agents by
// the event stream, sessions by session events, branches and PRs by polling while the page is visible.
// At a narrow main pane (under 880px) the halves stack, documents first.
// The work column splits its height 5:3:2 (sessions, branches, PRs) and lays each card's items out 3 to a row (#720).
import { useMemo } from 'react';
import { boardHash, plainClick } from '../projectNav';
import { ArrowRight, FilePlus2, FileText, GitBranch, GitPullRequest, PenTool, Plus, RotateCw } from 'lucide-react';
import type { ProjectInfo } from '../api';
import { Button } from '../components/ui/button';
import { ProviderIcon } from '../ProviderIcon';
import { STATE, stateOf } from '../dispatch/lib/format.ts';
import { cn } from '../lib/utils';
import { Card, CardGrid, CardTile, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
import { AgentTag } from './AgentPanel';
import { agentStateLabel, agentsIn, fileStem, holdersByFile, isBusy, needsLook, type AgentPresence } from './agents';
import { ColumnHead, DocList } from './DocList';
import { allDocs, filterDocs, relativeTime } from './model';
import { useAgents } from './useAgents';
import { PrIssueSessions } from './IssueSessionList';
import { fromSessions, issueOf } from './issueSessions';
import { useAccountLabels } from '../accountLabels';
import { usePrTracking, usePrs, useBranches, useProjectSessions, useSessionBranches, type Branches, type Feed, type PrAnswer } from './projectFeeds';
import type { Session } from '../../../shared/dispatch/types.ts';

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
  const { open, withBranch, prBranches } = useSessionBranches(sessions);
  const branches = useBranches(open.map((s) => s.branch).join(','));
  const tracking = usePrTracking();
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
        <BranchesCard sessions={sessions} open={open} branches={branches} />
        <PrsCard sessions={withBranch} branches={prBranches} prs={prs} tracking={tracking} />
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

/** "3 앞 · 1 뒤" against the base, with a full sentence for screen readers. */
function AheadBehind({ ahead, behind, base }: { ahead: number; behind: number; base: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono tabular-nums">
      <span className="sr-only">{`${base}보다 커밋 ${ahead}개 앞, ${behind}개 뒤`}</span>
      <span aria-hidden className={ahead > 0 ? 'text-foreground' : undefined} title={`${base}보다 ${ahead}개 앞`}>↑{ahead}</span>
      <span aria-hidden className={behind > 0 ? 'text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]' : undefined} title={`${base}보다 ${behind}개 뒤`}>↓{behind}</span>
    </span>
  );
}

function BranchesCard({ sessions, open, branches }: { sessions: Feed<Session[]>; open: Session[]; branches: Feed<Branches> }) {
  const base = branches && branches !== 'failed' ? branches.base : 'develop';
  return (
    <Card id="branches" grow={3} title="브랜치 작업" count={open.length} hint={`${base} 기준`} flush>
      {sessions === null ? (
        <EmptyState>불러오는 중이에요</EmptyState>
      ) : sessions === 'failed' ? (
        <EmptyState>세션을 불러오지 못했어요.</EmptyState>
      ) : open.length === 0 ? (
        <EmptyState>열린 세션 브랜치가 없어요.</EmptyState>
      ) : (
        <CardGrid label="세션 브랜치">
          {open.map((s) => {
            const tip = branches && branches !== 'failed' ? branches.tips.get(s.branch!) : undefined;
            return (
              <CardTile
                key={s.id}
                data={s.branch!}
                icon={<GitBranch />}
                title={<span className="font-mono text-[13px]" title={s.branch!}>{s.branch}</span>}
                sub={`${s.name} · ${s.roleName}${s.worktree ? ' · 워크트리' : ''}`}
                meta={tip ? <AheadBehind ahead={tip.ahead} behind={tip.behind} base={base} /> : branches === null ? '…' : '정보 없음'}
              />
            );
          })}
        </CardGrid>
      )}
    </Card>
  );
}

const PR_STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  open: { label: '열림', tone: 'idle' },
  merged: { label: '머지됨', tone: 'ok' },
  closed: { label: '닫힘', tone: 'bad' },
};
const CI: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' } | null> = {
  success: { label: 'CI 통과', tone: 'ok' },
  failure: { label: 'CI 실패', tone: 'bad' },
  pending: { label: 'CI 진행 중', tone: 'warn' },
  none: null,
};
const REVIEW: Record<string, string> = { approved: '승인됨', changes: '수정 요청', required: '리뷰 대기' };

function PrsCard({ sessions, branches, prs, tracking }: { sessions: Session[]; branches: string[]; prs: Feed<ReadonlyMap<string, PrAnswer>>; tracking: boolean | null }) {
  const owner = (b: string) => sessions.find((s) => s.branch === b);
  const labels = useAccountLabels();
  const found = prs && prs !== 'failed' ? branches.flatMap((b) => {
    const a = prs.get(b);
    return a?.ok ? [{ branch: b, pr: a.pr }] : [];
  }) : [];
  // Open PRs first, then merged, then closed; newest number first inside each.
  const order = { open: 0, merged: 1, closed: 2 } as const;
  found.sort((x, y) => order[x.pr.state] - order[y.pr.state] || y.pr.number - x.pr.number);
  const openCount = found.filter((f) => f.pr.state === 'open').length;
  return (
    <Card id="prs" grow={2} title="PR과 머지" count={tracking === false ? undefined : openCount} hint={tracking === false ? undefined : '열린 PR 수, 세션 브랜치 기준'} flush>
      {tracking === false ? (
        <EmptyState>PR·CI 추적이 꺼져 있어요. 세션 보드 위쪽 스위치로 켤 수 있어요.</EmptyState>
      ) : branches.length === 0 ? (
        <EmptyState>브랜치가 있는 세션이 아직 없어요.</EmptyState>
      ) : prs === null || tracking === null ? (
        <EmptyState>GitHub에서 PR을 찾는 중이에요</EmptyState>
      ) : prs === 'failed' ? (
        <EmptyState>PR 상태를 불러오지 못했어요.</EmptyState>
      ) : found.length === 0 ? (
        <EmptyState>{prBlankReason(prs)}</EmptyState>
      ) : (
        <CardGrid label="PR">
          {found.map(({ branch, pr }) => {
            const st = PR_STATE[pr.state];
            const ci = pr.state === 'open' ? CI[pr.ci] : null;
            const s = owner(branch);
            return (
              <CardTile
                key={branch}
                data={`pr-${pr.number}`}
                href={pr.url}
                footer={<PrIssueSessions issue={issueOf(sessions, branch)} fallback={fromSessions(sessions, branch, labels)} version={Math.floor((s?.updatedAt ?? 0) / 60_000)} />}
                icon={<GitPullRequest />}
                title={
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono tabular-nums">#{pr.number}</span>
                    <StatusDot tone={st.tone}>{st.label}</StatusDot>
                    {pr.conflict && <StatusDot tone="bad">충돌</StatusDot>}
                  </span>
                }
                sub={[s ? `${s.name} · ${STATE[stateOf(s)].label}` : null, branch].filter(Boolean).join(' · ')}
                meta={
                  pr.state === 'open' ? (
                    <>
                      {pr.review && <span>{REVIEW[pr.review]}</span>}
                      {ci && <StatusDot tone={ci.tone}>{ci.label}</StatusDot>}
                    </>
                  ) : s ? (
                    relativeTime(s.updatedAt)
                  ) : null
                }
              />
            );
          })}
        </CardGrid>
      )}
    </Card>
  );
}

/** Why no PR shows: gh is missing or logged out says so; otherwise the branches have no PR yet. */
function prBlankReason(prs: ReadonlyMap<string, PrAnswer>): string {
  const reasons = new Set([...prs.values()].flatMap((a) => (a.ok ? [] : [a.reason])));
  if (reasons.has('gh-missing')) return 'gh를 찾지 못해서 PR을 볼 수 없어요.';
  if (reasons.has('not-logged-in')) return 'gh에 로그인하면 PR이 여기에 보여요.';
  if (reasons.has('disabled')) return 'PR·CI 추적이 꺼져 있어요. 세션 보드 위쪽 스위치로 켤 수 있어요.';
  return '세션 브랜치에 열린 PR이 아직 없어요.';
}
