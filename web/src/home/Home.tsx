// 대시보드 and project home: data loading and the header. The page is a card dashboard only (#793): no view tabs, no
// create bar and no search box. Files are found with `/` or Ctrl/⌘+K, which open the command menu over the page.
// Layout B of docs/design/dispatch-integration/6-app-shell-projects.md §3.1.
import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Folder, Menu, Plus, Workflow } from 'lucide-react';
import { projectsApi, type ProjectInfo, type ProjectsResponse } from '../api';
import { Button } from '../components/ui/button';
import { SidebarTrigger } from '../components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ProjectSessions } from './ProjectSessions';
import { RunsBlock } from './ProjectRuns';
import { ProjectDashboard } from './ProjectDashboard';
import { PageHeader } from '../components/PageHeader';
import { plansByArea, pollWhileVisible, relativeTime, runningIn, wholeProject } from './model';
import { isFindKey } from './dashboardRows';
import { PlanAreas } from './PlanList';
import { RecentPage } from './RecentPage';

export type CreateKind = 'doc' | 'canvas' | 'plan' | 'template';
export type HomeProps = {
  /** The one project this server belongs to (#778): the dashboard is its home. */
  projectName: string | null;
  /** null = dashboard; a top folder's path = that folder's home. */
  project: string | null;
  /** Bumps when the workspace changed, to refetch. */
  version: unknown;
  onProject: (id: string | null) => void;
  onOpen: (path: string) => void;
  onCreate: (kind: CreateKind, project: string | null) => void;
  /** Opens the 세션 보드 in the shell, scoped to a project folder (#731), on its 세션 tab or `tab`. */
  onBoard: (folder: string, tab?: 'usage') => void;
  /** Opens a session on the 세션 보드 (the dashboard's 세션 요청 rows, #880). */
  onSession?: (id: string) => void;
  /** Opens the file finder (the command menu on its 문서 section) for `/` (#793). */
  onFind: () => void;
  /** Narrow screen: the sidebar is a drawer, so the header carries its button. */
  narrow?: boolean;
  /** The 알림함 bell, alone on the right of the header (#786, #793). */
  bell?: React.ReactNode;
  /** Show the 최근 page (#889) instead of the dashboard. */
  recent?: boolean;
  /** Opens the 보관함 dialog, from the 최근 page's 보관함 card. */
  onArchive?: () => void;
};


function useProjects(version: unknown) {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    projectsApi
      .projects()
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [version]);
  return { data, failed };
}

/**
 * Files with a run going now. Refetched with the list and every 10s while the page is visible (a run starting does
 * not change the tree); a hidden page stops polling and catches up as soon as it shows again.
 */
const RUNNING_POLL_MS = 10_000;
function useRunning(version: unknown) {
  const [files, setFiles] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let live = true;
    const load = () =>
      void projectsApi
        .running()
        .then((f) => live && setFiles((old) => (old.size === f.length && f.every((x) => old.has(x)) ? old : new Set(f))))
        .catch(() => {});
    const stop = pollWhileVisible(load, RUNNING_POLL_MS);
    return () => {
      live = false;
      stop();
    };
  }, [version]);
  return files;
}

/** `/` opens the file finder while no text field, editor, menu or dialog has focus. */
function useFindKey(onFind: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // A native modal <dialog> (settings) has no role attribute but owns the keyboard.
      if (!isFindKey(e) || document.querySelector('dialog:modal')) return;
      e.preventDefault();
      onFind();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onFind]);
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-2 py-10 text-center text-sm text-muted-foreground">{children}</p>;

export function Home(props: HomeProps) {
  const { data, failed } = useProjects(props.version);
  const running = useRunning(props.version);
  const project = props.project ? data?.projects.find((p) => p.id === props.project) ?? null : null;
  useFindKey(props.onFind);

  if (failed) return <Empty>목록을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.</Empty>;
  if (!data) return <Empty>불러오는 중이에요</Empty>;
  if (props.project && !project) return (
    <Empty>
      이 프로젝트를 찾지 못했어요.{' '}
      <Button variant="link" className="h-auto p-0" onClick={() => props.onProject(null)}>대시보드로 가기</Button>
    </Empty>
  );
  if (props.recent && !props.project) return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto">
      <RecentPage data={data} version={props.version} narrow={props.narrow} bell={props.bell} onOpen={props.onOpen} onNewDoc={() => props.onCreate('doc', null)} onArchive={props.onArchive} />
    </main>
  );
  return (
    <main className="flex min-h-0 flex-1 scroll-pt-[39px] flex-col overflow-auto" data-screen={project ? 'project' : 'dashboard'}>
      {project ? (
        <ProjectHome {...props} data={data} info={project} running={running} />
      ) : (
        <Dashboard {...props} data={data} running={running} />
      )}
    </main>
  );
}

type Shared = Omit<HomeProps, "project"> & { data: ProjectsResponse; running: ReadonlySet<string> };

function Dashboard({ data, ...p }: Shared) {
  // The dashboard is the whole project's (#778): every document, session and agent of this server.
  const whole = useMemo(() => wholeProject(data, p.projectName ?? '이 프로젝트'), [data, p.projectName]);
  return (
    <>
      <PageHeader title="대시보드" narrow={p.narrow} bell={p.bell} />
      <ProjectDashboard project={whole} onOpen={p.onOpen} onBoard={p.onBoard} onSession={p.onSession} fill approvals />
    </>
  );
}

type PTab = 'docs' | 'plans' | 'sessions' | 'overview';

/** Project head (layout B): icon badge, title, description, then 문서 수 · 실행 중 · 폴더. */
function ProjectHeader({ project, running }: { project: ProjectInfo; running: number }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex items-start gap-4 border-b px-4 pt-6 pb-4 max-sm:pt-4">
      <span aria-hidden className="grid size-[39px] shrink-0 place-items-center rounded-xl bg-muted text-[17px] font-bold text-foreground">
        {project.icon}
      </span>
      <div className="min-w-0">
        <h1 id={titleId} className="m-0 truncate text-[22px] leading-[30px] font-semibold">{project.name}</h1>
        {project.description && <p className="mt-1 mb-0 text-sm text-muted-foreground">{project.description}</p>}
        <ul aria-label="프로젝트 정보" className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted-foreground">
          <li className="inline-flex items-center gap-1.5 tabular-nums">
            <FileText aria-hidden className="size-[15px]" />
            문서 {project.docCount}개
          </li>
          <li className="inline-flex items-center gap-1.5">
            {running > 0 ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-ok" />
                <span className="text-foreground">파이프라인 {running}개 실행 중</span>
              </>
            ) : (
              <>
                <Workflow aria-hidden className="size-[15px]" />
                실행 중인 파이프라인 없음
              </>
            )}
          </li>
          <li className="inline-flex min-w-0 items-center gap-1.5">
            <Folder aria-hidden className="size-[15px]" />
            <span className="truncate font-mono">{project.path}/</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function ProjectHome({ info: project, ...p }: Shared & { info: ProjectInfo }) {
  const [tab, setTab] = useState<PTab>('docs');
  const plans = useMemo(() => plansByArea([project], []), [project]);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PTab)} className="shrink-0 grow gap-0">
      <header className="flex min-h-12 flex-wrap items-center gap-3 border-b px-4 py-2">
        {p.narrow && (
          <SidebarTrigger aria-label="메뉴 열기">
            <Menu className="size-[17px]" />
          </SidebarTrigger>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="대시보드로 돌아가기" onClick={() => p.onProject(null)}>
          <ArrowLeft />
        </Button>
        <p className="m-0 flex min-w-0 items-center gap-1.5 text-sm">
          <span className="text-muted-foreground max-sm:hidden">프로젝트</span>
          <span aria-hidden className="text-muted-foreground max-sm:hidden">/</span>
          <span className="truncate font-medium">{project.name}</span>
        </p>
        <TabsList aria-label="프로젝트 보기">
          <TabsTrigger value="docs">대시보드</TabsTrigger>
          <TabsTrigger value="plans">파이프라인</TabsTrigger>
          <TabsTrigger value="sessions">세션</TabsTrigger>
          <TabsTrigger value="overview">개요</TabsTrigger>
        </TabsList>
        <Button size="sm" className="ml-auto" onClick={() => p.onCreate('doc', project.id)}>
          <Plus /> 새 문서
        </Button>
        {p.bell}
      </header>
      <ProjectHeader project={project} running={runningIn(project, p.running)} />
      <div className="flex grow flex-col pb-3">
        <TabsContent value="docs" className="flex flex-col">
          <ProjectDashboard project={project} onOpen={p.onOpen} onBoard={p.onBoard} onSession={p.onSession} />
        </TabsContent>
        <TabsContent value="plans">
          <div className="flex flex-col gap-3 px-2 pt-3">
            <PlanAreas areas={plans} query="" onOpen={p.onOpen} empty="이 영역에는 아직 계획이 없어요." />
            <RunsBlock folder={project.path} onOpen={p.onOpen} />
          </div>
        </TabsContent>
        <TabsContent value="sessions">
          <ProjectSessions folder={project.path} onOpen={p.onOpen} onBoard={p.onBoard} />
        </TabsContent>
        <TabsContent value="overview">
          <dl className="m-0 grid max-w-xl grid-cols-[6rem_1fr] gap-x-4 gap-y-2 px-2 text-sm">
            <dt className="text-muted-foreground">설명</dt>
            <dd className="m-0">{project.description || '설명이 없어요'}</dd>
            <dt className="text-muted-foreground">문서</dt>
            <dd className="m-0">{project.docCount}개</dd>
            <dt className="text-muted-foreground">폴더</dt>
            <dd className="m-0 font-mono text-[13px]">{project.path}/</dd>
            <dt className="text-muted-foreground">고친 때</dt>
            <dd className="m-0">{relativeTime(project.modifiedAt)}</dd>
          </dl>
        </TabsContent>
      </div>
    </Tabs>
  );
}

