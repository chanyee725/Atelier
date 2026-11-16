// 개요 tab of the 모든 파일 home (E545, #685): the workspace at a glance: projects (each card shows who is in it right
// now, with the same cursor tags as the canvas) and recent documents. Usage, repo, agents-at-work and activity cards
// were dropped on the user's request (#696). The full file list stays one tab away (전체 / 최근 / 프로젝트별).
// Built on the shared dashboard primitives in ./dash (#686). Metadata only; nothing here is stored.
import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import type { ProjectInfo, ProjectsResponse } from '../api';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { AgentTag } from './AgentPanel';
import { agentsIn, isBusy, type AgentPresence } from './agents';
import { Card, CardList, CardRow, DashColumn, DashGrid, EmptyState, StatusDot } from './dash';
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
  return (
    <DashGrid ratio="minmax(0,1fr)">
      <DashColumn label="프로젝트와 문서">
        <ProjectsCard data={data} agents={list} running={running} now={now} onProject={onProject} onCreateIn={onCreateIn} onTab={onTab} />
        <RecentCard data={data} now={now} onOpen={onOpen} onTab={onTab} />
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
