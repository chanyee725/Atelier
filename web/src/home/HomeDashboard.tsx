// 개요 tab of 홈 (E545 #685, redesigned in E550 #706): the workspace at a glance on one quiet surface that fills the
// window height. Recent documents come first (the usual reason to open the app is to get back to work), grouped by
// when they changed; projects sit in a rail beside them, and each project row shows who is in it right now with the
// same cursor tags as the canvas. Below 860px of pane width the two stack (recent, then projects). The full file list
// stays one tab away (전체 파일 / 최근 / 프로젝트별). Metadata only; nothing here is stored.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { FilePlus2, FileText, Plus } from 'lucide-react';
import type { ProjectInfo, ProjectsResponse, RecentFile } from '../api';
import { Button } from '../components/ui/button';
import { Kbd } from '../components/ui/kbd';
import { cn } from '../lib/utils';
import { AgentTag } from './AgentPanel';
import { agentsIn, isBusy, type AgentPresence } from './agents';
import { StatusDot } from './dash';
import { allDocs, badgeOf, flatFiles, locationOf, relativeTime, runningIn, type DashTab } from './model';
import { useAgents } from './useAgents';

type Props = {
  data: ProjectsResponse;
  running: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onProject: (id: string) => void;
  onCreateIn: (project: string) => void;
  /** New document at the top level (the 문서 D quick-create). */
  onCreate: () => void;
  onTab: (tab: DashTab) => void;
};

const RECENT_SHOWN = 12;
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

export function HomeDashboard({ data, running, onOpen, onProject, onCreateIn, onCreate, onTab }: Props) {
  const now = useNow();
  const { agents } = useAgents();
  const list = Array.isArray(agents) ? agents : [];
  return (
    // The pane, not the window, decides the split (the sidebar takes part of the window).
    <div className="@container flex grow flex-col">
      <div className="grid grow content-start gap-4 p-4 @min-[860px]:content-stretch @min-[860px]:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] @min-[860px]:gap-5 @min-[860px]:p-5">
        <RecentPanel data={data} now={now} onOpen={onOpen} onCreate={onCreate} onTab={onTab} />
        <ProjectsPanel data={data} agents={list} running={running} now={now} onProject={onProject} onCreateIn={onCreateIn} onTab={onTab} />
      </div>
    </div>
  );
}

/**
 * One titled column. On a wide pane it runs to the bottom of the window, so a short workspace has no empty band
 * under the content; on a narrow one it is as tall as its rows and the page scrolls.
 */
function Panel({ id, title, count, action, children, className }: { id: string; title: string; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId} data-card={id} className={cn('flex min-w-0 flex-col overflow-clip rounded-lg border bg-card text-card-foreground', className)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <h2 id={headId} className="m-0 flex items-baseline gap-2 text-[13px] font-semibold">
          {title}
          {count !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action && <div className="ml-auto flex items-center">{action}</div>}
      </header>
      {children}
    </section>
  );
}

const MoreLink = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onClick}>
    {children}
  </Button>
);

/** Local-calendar buckets for the recent list: the group heads say when, so each row only needs its own time. */
function bucketOf(ms: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(ms)) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return '이번 주';
  return '그 전';
}

function groupByDay(files: RecentFile[], now: number) {
  const groups: { label: string; files: RecentFile[] }[] = [];
  for (const f of files) {
    const label = bucketOf(f.modifiedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.files.push(f);
    else groups.push({ label, files: [f] });
  }
  return groups;
}

function RecentPanel({ data, now, onOpen, onCreate, onTab }: { data: ProjectsResponse; now: number } & Pick<Props, 'onOpen' | 'onCreate' | 'onTab'>) {
  const all = useMemo(() => flatFiles(data.projects, data.unfiled), [data]);
  const files = all.slice(0, RECENT_SHOWN);
  const groups = groupByDay(files, now);
  return (
    <Panel id="recent" title="최근 문서" action={all.length > 0 && <MoreLink onClick={() => onTab('recent')}>모두 보기</MoreLink>}>
      {files.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-6">
          <p className="m-0 text-sm">아직 문서가 없어요</p>
          <p className="m-0 mb-1 max-w-[34ch] text-[13px] text-muted-foreground">첫 문서를 만들면 여기에 최근에 고친 순서로 모여요.</p>
          <Button size="sm" variant="outline" onClick={onCreate}>
            <FilePlus2 /> 새 문서 <Kbd>D</Kbd>
          </Button>
        </div>
      ) : (
        <div className="grow pb-2">
          {groups.map((g) => (
            <RecentGroup key={g.label} label={g.label} files={g.files} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function RecentGroup({ label, files, now, onOpen }: { label: string; files: RecentFile[]; now: number; onOpen: (path: string) => void }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId}>
      <h3 id={headId} className="m-0 px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ul aria-label={`${label} 고친 문서`} className="m-0 list-none p-0 px-1.5">
        {files.map((f) => (
          <li key={f.path} data-row={f.path}>
            <button type="button" onClick={() => onOpen(f.path)} className="flex h-9 w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{f.title}</span>
              <span className="hidden max-w-[40%] shrink truncate text-xs text-muted-foreground @min-[520px]:inline">{locationOf(f)}</span>
              <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{relativeTime(f.modifiedAt, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The newest edit anywhere in the project (its own modifiedAt when it has no documents). */
const lastChange = (p: ProjectInfo) => allDocs([p], []).reduce((m, x) => Math.max(m, x.doc.modifiedAt), p.modifiedAt || 0);

function ProjectsPanel({ data, agents, running, now, onProject, onCreateIn, onTab }: { data: ProjectsResponse; agents: AgentPresence[]; running: ReadonlySet<string>; now: number } & Pick<Props, 'onProject' | 'onCreateIn' | 'onTab'>) {
  const projects = useMemo(() => [...data.projects].sort((a, b) => lastChange(b) - lastChange(a)), [data.projects]);
  return (
    <Panel id="projects" title="프로젝트" count={projects.length} action={projects.length > 0 && <MoreLink onClick={() => onTab('projects')}>문서 목록</MoreLink>}>
      {projects.length === 0 ? (
        <div className="flex flex-col gap-2 px-4 py-6">
          <p className="m-0 text-sm">아직 프로젝트가 없어요</p>
          <p className="m-0 text-[13px] text-muted-foreground">작업 공간에 폴더를 만들면 프로젝트가 돼요. 사이드바의 프로젝트 옆 +로 만들 수 있어요.</p>
        </div>
      ) : (
        <ul aria-label="프로젝트" className="m-0 flex grow list-none flex-col gap-1 p-1.5">
          {projects.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectRow project={p} agents={agentsIn(agents, p.path)} runs={runningIn(p, running)} now={now} onOpen={() => onProject(p.id)} onCreate={() => onCreateIn(p.id)} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One project: the name is the row's link, stretched over the whole row (card.md "clickable cards with independent
 * actions"); 새 문서 stays its own button above the overlay. A project with an agent at work gets a green rule on its
 * leading edge, the one accent on the page: that is what someone opening 홈 wants to spot first.
 */
function ProjectRow({ project: p, agents, runs, now, onOpen, onCreate }: { project: ProjectInfo; agents: AgentPresence[]; runs: number; now: number; onOpen: () => void; onCreate: () => void }) {
  const busy = agents.filter(isBusy).length;
  const changed = lastChange(p);
  return (
    <article
      data-project-card={p.id}
      data-busy={busy > 0 || undefined}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-md py-2.5 pr-2 pl-3 transition-colors',
        'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:content-[""]',
        busy > 0 ? 'before:bg-ok' : 'before:bg-transparent',
        'has-[[data-card-link]:hover]:bg-accent/60',
        'has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/50',
      )}
    >
      <header className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-bold">
          {badgeOf(p)}
        </span>
        <h3 className="m-0 min-w-0 flex-1 text-sm font-medium">
          <button type="button" data-card-link onClick={onOpen} className="block w-full truncate text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none">
            {p.name}
          </button>
        </h3>
        <Button variant="ghost" size="icon-sm" className="relative z-[1] opacity-60 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`${p.name}에 새 문서`} title="새 문서" onClick={onCreate}>
          <Plus />
        </Button>
      </header>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 pl-[34px] text-xs text-muted-foreground tabular-nums">
        <span>문서 {p.docCount}개</span>
        <span>{changed ? `${relativeTime(changed, now)} 고침` : '고친 적 없음'}</span>
        {runs > 0 && <StatusDot tone="ok">파이프라인 {runs}개 실행 중</StatusDot>}
      </p>
      {agents.length > 0 && (
        <div className="flex min-h-[22px] items-center gap-1.5 pl-[34px]" role="group" aria-label={`에이전트 ${agents.length}명, 작업 중 ${busy}명`}>
          {agents.slice(0, TAGS_SHOWN).map((a) => (
            <AgentTag key={a.sid} agent={a} size="sm" className={isBusy(a) ? undefined : 'opacity-60'} />
          ))}
          {agents.length > TAGS_SHOWN && <span className="text-xs text-muted-foreground tabular-nums">+{agents.length - TAGS_SHOWN}</span>}
        </div>
      )}
    </article>
  );
}
