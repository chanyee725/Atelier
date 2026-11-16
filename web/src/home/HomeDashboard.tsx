// 개요 tab of the 모든 파일 home (E545, #685): the workspace at a glance. Left: projects (each card shows who is in it
// right now, with the same cursor tags as the canvas), recent documents and the activity feed. Right: agents at work,
// repo status and usage per provider. The full file list stays one tab away (전체 / 최근 / 프로젝트별).
// Built on the shared dashboard primitives in ./dash (#686). Metadata only; nothing here is stored.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, FileText, GitBranch, GitPullRequest, Plus } from 'lucide-react';
import type { ProjectInfo, ProjectsResponse } from '../api';
import { Button } from '../components/ui/button';
import { Meter } from '../dispatch/parts';
import { pct, until } from '../dispatch/lib/format.ts';
import { cn } from '../lib/utils';
import { ProviderIcon } from '../ProviderIcon';
import { SettingsModal } from '../settings/SettingsEntry';
import { feedOf } from '../activity/activity';
import { useActivityLog } from '../activity/store';
import { AgentTag } from './AgentPanel';
import { agentMeta, agentStateLabel, agentsIn, fileStem, isBusy, needsLook, type AgentPresence } from './agents';
import { Card, CardList, CardRow, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
import { useRepoStatus, useUsage, type RepoStatus } from './homeDashboardData';
import { allDocs, badgeOf, flatFiles, locationOf, relativeTime, runningIn, type DashTab } from './model';
import { useAgents } from './useAgents';

type Props = {
  data: ProjectsResponse;
  running: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onProject: (id: string) => void;
  onCreateIn: (project: string) => void;
  onTab: (tab: DashTab) => void;
};

const RECENT_SHOWN = 6;
const FEED_SHOWN = 8;
const AGENTS_SHOWN = 6;
const TAGS_SHOWN = 3;

/** Re-renders every minute so "3분 전" keeps counting. */
function useNow(ms = 60_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const MoreLink = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onClick}>
    {children}
  </Button>
);

export function HomeDashboard({ data, running, onOpen, onProject, onCreateIn, onTab }: Props) {
  const now = useNow();
  const { agents } = useAgents();
  const list = Array.isArray(agents) ? agents : [];
  const titles = useMemo(() => new Map(allDocs(data.projects, data.unfiled).map((x) => [x.doc.path, x.doc.title])), [data]);
  const titleOf = (f: string) => titles.get(f) ?? fileStem(f);
  return (
    <DashGrid ratio="minmax(0,1.55fr) minmax(0,1fr)">
      <DashColumn label="프로젝트와 문서">
        <ProjectsCard data={data} agents={list} running={running} now={now} onProject={onProject} onCreateIn={onCreateIn} onTab={onTab} />
        <RecentCard data={data} now={now} onOpen={onOpen} onTab={onTab} />
        <FeedCard now={now} onOpen={onOpen} />
      </DashColumn>
      <DashColumn label="에이전트와 저장소">
        <AgentsCard agents={agents} titleOf={titleOf} onOpen={onOpen} />
        <RepoCard />
        <UsageCard />
      </DashColumn>
    </DashGrid>
  );
}

/** The newest edit anywhere in the project (its own modifiedAt when it has no documents). */
const lastChange = (p: ProjectInfo) => allDocs([p], []).reduce((m, x) => Math.max(m, x.doc.modifiedAt), p.modifiedAt || 0);

function ProjectsCard({ data, agents, running, now, onProject, onCreateIn, onTab }: { data: ProjectsResponse; agents: AgentPresence[]; running: ReadonlySet<string>; now: number } & Pick<Props, 'onProject' | 'onCreateIn' | 'onTab'>) {
  const projects = useMemo(() => [...data.projects].sort((a, b) => lastChange(b) - lastChange(a)), [data.projects]);
  return (
    <Card id="projects" title="프로젝트" count={projects.length} flush actions={projects.length > 0 && <MoreLink onClick={() => onTab('projects')}>문서 목록</MoreLink>}>
      {projects.length === 0 ? (
        <EmptyState>아직 프로젝트가 없어요. 작업 공간에 폴더를 만들면 프로젝트가 돼요.</EmptyState>
      ) : (
        <ul aria-label="프로젝트" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-3">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectTile project={p} agents={agentsIn(agents, p.path)} runs={runningIn(p, running)} now={now} onOpen={() => onProject(p.id)} onCreate={() => onCreateIn(p.id)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One project: the name is the card's link (stretched over the whole card, card.md "clickable cards with independent
 * actions"); 새 문서 stays its own button above the overlay. The agent tags are the memorable part: who is in there now.
 */
function ProjectTile({ project: p, agents, runs, now, onOpen, onCreate }: { project: ProjectInfo; agents: AgentPresence[]; runs: number; now: number; onOpen: () => void; onCreate: () => void }) {
  const busy = agents.filter(isBusy).length;
  const changed = lastChange(p);
  return (
    <article
      data-project-card={p.id}
      className={cn(
        'group relative flex h-full flex-col gap-3 rounded-md border bg-background p-3 transition-colors',
        'has-[[data-card-link]:hover]:border-foreground/25 has-[[data-card-link]:hover]:bg-accent/40',
        'has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/50',
        busy > 0 && 'border-ok/40',
      )}
    >
      <header className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-[13px] font-bold">
          {badgeOf(p)}
        </span>
        <h3 className="m-0 min-w-0 flex-1 text-sm font-semibold">
          <button type="button" data-card-link onClick={onOpen} className="block w-full truncate text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none">
            {p.name}
          </button>
        </h3>
        <Button variant="ghost" size="icon-sm" className="relative z-[1] -mr-1 opacity-70 group-hover:opacity-100" aria-label={`${p.name}에 새 문서`} title="새 문서" onClick={onCreate}>
          <Plus />
        </Button>
      </header>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span>문서 {p.docCount}개</span>
        <span>{changed ? `${relativeTime(changed, now)} 고침` : '고친 적 없음'}</span>
        {runs > 0 && <StatusDot tone="ok">파이프라인 {runs}개 실행 중</StatusDot>}
      </p>
      <div className="mt-auto flex min-h-[26px] items-end gap-1.5" aria-label={agents.length ? `에이전트 ${agents.length}명, 작업 중 ${busy}명` : undefined} role={agents.length ? 'group' : undefined}>
        {agents.length === 0 ? (
          <span className="text-xs text-muted-foreground">지금 일하는 에이전트 없음</span>
        ) : (
          <>
            {agents.slice(0, TAGS_SHOWN).map((a) => (
              <AgentTag key={a.sid} agent={a} size="sm" className={isBusy(a) ? undefined : 'opacity-60'} />
            ))}
            {agents.length > TAGS_SHOWN && <span className="mb-px text-xs text-muted-foreground tabular-nums">+{agents.length - TAGS_SHOWN}</span>}
          </>
        )}
      </div>
    </article>
  );
}

function RecentCard({ data, now, onOpen, onTab }: { data: ProjectsResponse; now: number } & Pick<Props, 'onOpen' | 'onTab'>) {
  const files = useMemo(() => flatFiles(data.projects, data.unfiled).slice(0, RECENT_SHOWN), [data]);
  return (
    <Card id="recent" title="최근 문서" flush actions={files.length > 0 && <MoreLink onClick={() => onTab('recent')}>모두 보기</MoreLink>}>
      {files.length === 0 ? (
        <EmptyState>아직 문서가 없어요. 위에서 새 문서를 만들어 보세요.</EmptyState>
      ) : (
        <CardList label="최근에 고친 문서">
          {files.map((f) => (
            <CardRow key={f.path} data={f.path} icon={<FileText />} title={f.title} sub={locationOf(f)} meta={relativeTime(f.modifiedAt, now)} onClick={() => onOpen(f.path)} />
          ))}
        </CardList>
      )}
    </Card>
  );
}

function FeedCard({ now, onOpen }: { now: number; onOpen: (path: string) => void }) {
  const log = useActivityLog();
  const items = feedOf(log, now).slice(0, FEED_SHOWN);
  return (
    <Card id="activity" title="활동" flush hint={items.length > 0 ? '에이전트가 문서에서 한 일이에요' : undefined}>
      {items.length === 0 ? (
        <EmptyState>아직 기록이 없어요. 에이전트가 문서를 고치면 여기에 쌓여요.</EmptyState>
      ) : (
        <CardList label="최근 활동">
          {items.map((it) => (
            <CardRow
              key={it.id}
              data={it.id}
              icon={<span className={cn('size-2 rounded-full', it.kind === 'error' ? 'bg-bad' : 'bg-muted-foreground')} style={it.color && it.kind !== 'error' ? { background: it.color } : undefined} />}
              title={it.text}
              meta={it.when}
              onClick={() => onOpen(it.file)}
            />
          ))}
        </CardList>
      )}
    </Card>
  );
}

function AgentsCard({ agents, titleOf, onOpen }: { agents: AgentPresence[] | 'off' | 'failed' | null; titleOf: (f: string) => string; onOpen: (path: string) => void }) {
  // The whole workspace in agentsIn's order: busy first, then file holders, then the most recent.
  const sorted = useMemo(
    () => (Array.isArray(agents) ? [...agents].sort((a, b) => Number(isBusy(b)) - Number(isBusy(a)) || Number(!!b.file) - Number(!!a.file) || (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name)) : []),
    [agents],
  );
  const busy = sorted.filter(isBusy).length;
  return (
    <Card
      id="agents"
      title="지금 작업 중"
      count={sorted.length || undefined}
      flush
      hint={busy > 0 ? `${busy}명이 일하고 있어요` : undefined}
      actions={
        <a href="/dispatch" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground no-underline hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          세션 보드 <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      }
    >
      {agents === null ? (
        <EmptyState>불러오는 중이에요</EmptyState>
      ) : agents === 'failed' || agents === 'off' ? (
        <EmptyState>에이전트 목록을 불러오지 못했어요.</EmptyState>
      ) : sorted.length === 0 ? (
        <EmptyState>지금 일하는 에이전트가 없어요. 계획 문서에서 시작하기를 누르면 여기에 보여요.</EmptyState>
      ) : (
        <CardList label="에이전트">
          {sorted.slice(0, AGENTS_SHOWN).map((a) => (
            <li key={a.sid} data-row={a.sid}>
              <button
                type="button"
                disabled={!a.file}
                onClick={() => a.file && onOpen(a.file)}
                className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 pt-1 pb-2 text-left enabled:hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
              >
                <AgentTag agent={a} size="sm" />
                <span className={cn('mt-[5px] text-xs', isBusy(a) ? 'text-foreground' : 'text-muted-foreground')}>
                  <StatusDot tone={isBusy(a) ? 'ok' : needsLook(a) ? 'warn' : 'idle'}>{agentStateLabel(a)}</StatusDot>
                </span>
                <span className="col-span-2 mt-0.5 truncate pl-3 text-xs text-muted-foreground">
                  {a.file ? titleOf(a.file) : '잡고 있는 파일 없음'}
                  {agentMeta(a) && <span className="text-muted-foreground/70"> — {agentMeta(a)}</span>}
                </span>
              </button>
            </li>
          ))}
          {sorted.length > AGENTS_SHOWN && <li className="px-4 py-2 text-xs text-muted-foreground">나머지 {sorted.length - AGENTS_SHOWN}명은 세션 보드에서 봐요.</li>}
        </CardList>
      )}
    </Card>
  );
}

const PR_STATE: Record<string, { label: string; tone: 'ok' | 'idle' | 'bad' }> = {
  open: { label: '열림', tone: 'ok' },
  merged: { label: '병합됨', tone: 'idle' },
  closed: { label: '닫힘', tone: 'bad' },
};

function RepoCard() {
  const repo = useRepoStatus();
  return (
    <Card id="repo" title="저장소" flush hint={repo && repo !== 'failed' && repo.base ? <span className="inline-flex items-center gap-1"><GitBranch aria-hidden className="size-3" />{repo.base}</span> : undefined}>
      {repo === null ? <EmptyState>불러오는 중이에요</EmptyState> : repo === 'failed' ? <EmptyState>실행 기능이 꺼져 있어서 저장소 상태를 볼 수 없어요.</EmptyState> : <RepoBody repo={repo} />}
    </Card>
  );
}

function RepoBody({ repo }: { repo: RepoStatus }) {
  const prs = repo.prs.slice(0, 5);
  const branches = repo.branches.slice(0, 5);
  return (
    <>
      {repo.tracking === false ? (
        <EmptyState>PR 추적이 꺼져 있어요. 파이프라인 실행 화면에서 켤 수 있어요.</EmptyState>
      ) : prs.length === 0 ? (
        <EmptyState>실행 중인 파이프라인에 열린 PR이 없어요.</EmptyState>
      ) : (
        <CardList label="PR">
          {prs.map((p) => {
            const st = PR_STATE[p.state ?? 'open'] ?? { label: p.state ?? '', tone: 'idle' as const };
            return (
              <CardRow key={p.number} data={`pr-${p.number}`} icon={<GitPullRequest />} title={`#${p.number}`} sub={[p.branch, p.session].filter(Boolean).join(', ')} meta={<StatusDot tone={st.tone}>{st.label}</StatusDot>} />
            );
          })}
        </CardList>
      )}
      {branches.length > 0 && (
        <div className="border-t">
          <h3 className="m-0 px-4 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">작업 중인 브랜치</h3>
          <CardList label="작업 중인 브랜치">
            {branches.map((b) => (
              <CardRow key={b.name} data={`branch-${b.name}`} icon={<GitBranch />} title={<span className="font-mono text-[13px]">{b.name}</span>} meta={b.sessions.length === 1 ? b.sessions[0] : `${b.sessions[0]} 외 ${b.sessions.length - 1}명`} />
            ))}
          </CardList>
        </div>
      )}
    </>
  );
}

function UsageCard() {
  const groups = useUsage();
  const [settings, setSettings] = useState(false);
  return (
    <Card id="usage" title="사용 한도" actions={<MoreLink onClick={() => setSettings(true)}>한도 설정</MoreLink>}>
      {groups === null ? (
        <p className="m-0 text-sm text-muted-foreground">불러오는 중이에요</p>
      ) : groups === 'failed' ? (
        <p className="m-0 text-sm text-muted-foreground">사용량을 불러오지 못했어요.</p>
      ) : groups.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">연결된 모델이 없어요. 설정에서 모델을 연결해 보세요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {groups.map((g) => (
            <li key={g.id} data-provider={g.id} className="flex flex-col gap-1.5">
              <p className="m-0 flex items-center gap-2 text-sm font-medium">
                <ProviderIcon provider={g.id} className="size-4" />
                {g.name}
                {g.plan && <span className="text-xs font-normal text-muted-foreground">{g.plan}</span>}
              </p>
              {g.windows.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {g.windows.map((w) => (
                    <li key={w.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2.75rem] items-center gap-2.5 text-xs">
                      <span className="truncate text-muted-foreground">{w.label}</span>
                      <Meter value={w.used} label={`${g.name} ${w.label} ${pct(w.used)}`} />
                      <span className="text-right tabular-nums" title={w.reset ? `${until(w.reset)} 뒤 초기화` : undefined}>{pct(w.used)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">
                  {g.reached != null ? (g.reached ? `한도에 닿았어요.${g.reset ? ` ${until(g.reset)} 뒤 풀려요.` : ''}` : '한도에 닿지 않았어요.') : '아직 사용량 정보가 없어요. 세션이 돌면 채워져요.'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {settings && <SettingsModal section="limits" onClose={() => setSettings(false)} />}
    </Card>
  );
}
