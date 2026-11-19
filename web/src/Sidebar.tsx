// App sidebar, layout B (design doc 6 §2.1, §3.1): the project's name with search and new-file icons, the views
// (대시보드 A, 최근 R, 보관함 B) and the 세션 보드 link, then 문서: this one project's folders and documents with their nested
// sub-documents (#778), one row per model with its connection status (SidebarModels.tsx) and settings.
// Built from the shadcn Sidebar (components/ui/sidebar.tsx).
import { freshClass } from './freshPaths';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronRight, Clock, File, FolderClosed, FolderInput, GitBranch, House, LayoutGrid, MoreHorizontal, Pencil, Search, SquarePen, Trash2 } from 'lucide-react';
import type { DocNode, PipelineMark, Project, ProjectsView } from './api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { Kbd } from './components/ui/kbd';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from './components/ui/sidebar';
import { FOCUS_RING } from './lib/focus';
import { cn } from './lib/utils';
import { openPathsFor, type Section } from './projectNav';
import { SettingsEntry } from './settings/SettingsEntry';
import { SidebarModels } from './SidebarModels';
import { WorkingAgents } from './activity/WorkingAgents';
import { ThemeSwitch } from './ThemeSwitch';
import { ProjectName } from './ProjectName';
import type { Theme, ThemePref } from './theme';
import { displayName, titlesOf } from './docTitles';
import { moveDestinations, moveItemOf, moveTarget, type MoveDestination, type MoveItem } from './sidebarMove';

type Props = {
  /** The project's name, shown top-left (#778); null while it loads. */
  project: string | null;
  view: ProjectsView | null;
  section: Section;
  /** The open document's path while the document screen is shown. */
  current: string | null;
  onSection: (s: Section) => void;
  onOpen: (path: string) => void;
  onNewFile: () => void;
  onRename: (n: DocNode | Project) => void;
  onDelete: (n: DocNode | Project) => void;
  /** Move a document (with its sub-documents) or group into folder `dir`; resolves true when it moved. */
  onMove: (item: MoveItem, dir: string) => Promise<boolean>;
  onArchive: () => void;
  onCommands: () => void;
  /** The theme switch at the bottom: the chosen theme, its setter, and the system's scheme (shown on 시스템). */
  themePref: ThemePref;
  onThemePref: (t: ThemePref) => void;
  systemTheme: Theme;
};

const ICON_BUTTON = 'flex size-[30px] shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground max-md:size-11 [&>svg]:size-[17px] ' + FOCUS_RING;

// 새 파일 is the one raised control in the header: white with a hairline in light, a lighter square in dark and
// 모니터링 (on --background it read as a hole in the sidebar). Hover keeps the fill and only brightens the icon.
const NEW_FILE_BUTTON =
  'border border-sidebar-border bg-background text-sidebar-foreground/80 shadow-xs hover:bg-background dark:bg-sidebar-accent dark:shadow-none dark:hover:bg-sidebar-accent';

// The document or group being dragged (dataTransfer cannot be read during dragover, so keep it here).
let dragging: MoveItem | null = null;
const DRAG_TYPE = 'application/x-drawing-node';

/** Props that make a row draggable (documents and groups). */
function dragProps(item: MoveItem) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      dragging = item;
      e.dataTransfer.setData(DRAG_TYPE, item.path);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      dragging = null;
    },
  };
}

/** A project or group row that takes drops; `over` lights it while a drag that can land here is above it. */
function useDropTarget(dest: MoveDestination, move: Mover) {
  const [over, setOver] = useState(false);
  const can = () => !!dragging && moveTarget(dragging, dest.path) !== null;
  return {
    'data-drop': over ? 'over' : undefined,
    // A row never lets a drag bubble further: a refused drop moves nothing (never to the root).
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation();
      if (!can()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const d = dragging;
      dragging = null;
      if (d && moveTarget(d, dest.path) !== null) void move(d, dest);
    },
  };
}
/** A document row: never a drop target, and a drop on it does not fall through to anything else. */
const refuseDrop = {
  onDragOver: (e: React.DragEvent) => e.stopPropagation(),
  onDrop: (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = null;
  },
};

type Mover = (item: MoveItem, dest: MoveDestination) => Promise<void>;

/** 옮기기 submenu: the keyboard and screen-reader way to do what a drag does. */
function MoveMenu({ item, view, move }: { item: MoveItem; view: ProjectsView | null; move: Mover }) {
  const dests = moveDestinations(view, item);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="size-4" /> 옮기기
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-72">
        {dests.length ? (
          dests.map((d) => (
            <DropdownMenuItem key={d.path} onSelect={() => void move(item, d)}>
              <span className="truncate">{d.label}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>옮길 곳이 없어요</DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function RowMenu({ label, node, p, move }: { label: string; node: DocNode | Project; p: Props; move?: Mover }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover aria-label={`${label} 메뉴`} className="right-1">
          <MoreHorizontal />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        <DropdownMenuItem onSelect={() => p.onRename(node)}>
          <Pencil className="size-4" /> 이름 바꾸기
        </DropdownMenuItem>
        {move && !('docs' in node) && <MoveMenu item={moveItemOf(node)} view={p.view} move={move} />}
        <DropdownMenuItem onSelect={() => p.onDelete(node)}>
          <Trash2 className="size-4" /> 지우기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** depth -1: a top-level row of 문서 (no indent, its icon lines up with the views above). */
type RowsProps = { depth: number; open: Set<string>; toggle: (path: string) => void; p: Props; move: Mover };

function DocRows({ nodes, ...rest }: RowsProps & { nodes: DocNode[] }) {
  return (
    <>
      {nodes.map((n) => (
        <DocRow key={n.path} n={n} {...rest} />
      ))}
    </>
  );
}

// Right-hand slots, from the edge: ⋯ menu, chevron (fixed width), then the count. The row's text stops before
// them: 56px on wide screens (24px actions), 92px below md where both actions are 44px touch targets.
const ROW_SLOTS = 'pr-14 max-md:pr-[92px]';
const COUNT = 'min-w-5 text-right';

const DROP_ROW = 'data-[drop=over]:bg-accent data-[drop=over]:text-foreground data-[drop=over]:outline-2 data-[drop=over]:outline-ring forced-colors:data-[drop=over]:outline-[Highlight]';

function DocRow({ n, depth, open, toggle, p, move }: RowsProps & { n: DocNode }) {
  const label = n.type === 'doc' ? displayName(n) : n.name;
  const drop = useDropTarget({ path: n.path, label }, move);
  const has = n.children.length > 0;
  const expanded = has && open.has(n.path);
  const active = n.type === 'doc' && p.current === n.path;
  // Indent: 9px + icon column (22px) + 15px per level (doc 6 prototype), within the row's own 8px padding.
  const pad = depth < 0 ? undefined : { paddingLeft: 9 + 22 + depth * 15 };
  return (
    <SidebarMenuItem className={freshClass(n.path)}>
      <SidebarMenuButton
        style={pad}
        data-move-path={n.path}
        aria-current={active ? 'page' : undefined}
        aria-expanded={n.type === 'group' ? expanded : undefined}
        className={cn(ROW_SLOTS, depth >= 0 && 'font-normal text-muted-foreground hover:text-foreground', 'aria-[current=page]:font-medium', DROP_ROW)}
        {...dragProps(moveItemOf(n))}
        {...(n.type === 'group' ? drop : refuseDrop)}
        onClick={() => (n.type === 'doc' ? p.onOpen(n.path) : toggle(n.path))}
      >
        {n.type === 'doc' ? <File className="size-[15px]! text-muted-foreground" aria-hidden /> : <FolderClosed className="size-[15px]! text-muted-foreground" aria-hidden />}
        <span className="truncate">{label}</span>
        {n.type === 'doc' && n.pipeline && <PipelineBadge state={n.pipeline.state} />}
        {has && !expanded && <SidebarMenuBadge className={COUNT} aria-label={`하위 ${n.count}개`}>{n.count}</SidebarMenuBadge>}
      </SidebarMenuButton>
      {/* Feature folders (groups) get the chevron too, so area -> feature -> document reads as one tree (#782). */}
      {has && (
        <SidebarMenuAction aria-label={`${label} ${n.type === 'doc' ? '하위 문서 ' : ''}${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} className="right-7 max-md:right-11" onClick={() => toggle(n.path)}>
          <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
        </SidebarMenuAction>
      )}
      <RowMenu label={label} node={n} p={p} move={move} />
      {expanded && (
        <SidebarMenuSub>
          <DocRows nodes={n.children} depth={depth + 1} open={open} toggle={toggle} p={p} move={move} />
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

// Pipeline file marks. Text stays in the foreground colour; only the running dot is green (state is never colour alone).
const PIPELINE_MARKS: Record<PipelineMark['state'], { glyph: string; text: string; dot?: string }> = {
  plan: { glyph: '◐', text: '계획' },
  running: { glyph: '●', text: '실행 중', dot: 'var(--ok)' },
  paused: { glyph: '⏸', text: '멈춤' },
  done: { glyph: '✓', text: '완료' },
};

function PipelineBadge({ state }: { state: PipelineMark['state'] }) {
  const m = PIPELINE_MARKS[state] ?? PIPELINE_MARKS.plan;
  // The row's right padding (ROW_SLOTS) keeps it clear of the row actions.
  return (
    <span role="img" aria-label={`파이프라인: ${m.text}`} title={`파이프라인 ${m.text}`} className="ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-1 text-[11px] leading-4 text-foreground">
      <span aria-hidden style={m.dot ? { color: m.dot } : undefined} className={m.dot ? undefined : 'text-muted-foreground'}>
        {m.glyph}
      </span>
      <span aria-hidden>{m.text}</span>
    </span>
  );
}

/** A top-level folder of the project's documents (a workspace top folder; its .project.json name wins). */
function FolderRow({ pr, open, toggle, p, move }: Omit<RowsProps, 'depth'> & { pr: Project }) {
  const expanded = open.has(pr.path);
  const drop = useDropTarget({ path: pr.path, label: pr.name }, move);
  return (
    <SidebarMenuItem className={freshClass(pr.path)}>
      <SidebarMenuButton data-move-path={pr.path} aria-expanded={expanded} className={cn(ROW_SLOTS, DROP_ROW)} {...drop} onClick={() => toggle(pr.path)}>
        <FolderClosed aria-hidden />
        <span className="truncate">{pr.name}</span>
        {!expanded && pr.count > 0 && <SidebarMenuBadge className={COUNT} aria-label={`문서 ${pr.count}개`}>{pr.count}</SidebarMenuBadge>}
      </SidebarMenuButton>
      <SidebarMenuAction aria-label={`${pr.name} ${expanded ? '접기' : '펼치기'}`} aria-expanded={expanded} className="right-7 max-md:right-11" onClick={() => toggle(pr.path)}>
        <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
      </SidebarMenuAction>
      <RowMenu label={pr.name} node={pr} p={p} />
      {expanded && (
        <SidebarMenuSub>
          {pr.docs.length ? <DocRows nodes={pr.docs} depth={0} open={open} toggle={toggle} p={p} move={move} /> : <li className="py-1 pl-[31px] text-xs text-muted-foreground">아직 문서가 없어요.</li>}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

export function Sidebar(p: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // The open document's project and parents unfold when it changes (the user can fold them again).
  useEffect(() => {
    const need = openPathsFor(p.view, p.current);
    if (need.length) setOpen((o) => (need.every((x) => o.has(x)) ? o : new Set([...o, ...need])));
  }, [p.view, p.current]);
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  // After a move: one polite announcement (cleared first, set a moment later so the focus change does not
  // swallow it), the destination unfolds, and focus goes to the moved row once the new list arrives.
  const [said, setSaid] = useState('');
  const sayTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(sayTimer.current), []);
  useEffect(() => {
    if (!focusPath || !p.view) return;
    const el = document.querySelector<HTMLElement>(`[data-move-path="${CSS.escape(focusPath)}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
    setFocusPath(null);
  }, [focusPath, p.view, open]);
  const move: Mover = async (item, dest) => {
    const to = moveTarget(item, dest.path);
    if (!to || !(await p.onMove(item, dest.path))) return;
    setOpen((o) => new Set([...o, dest.path, ...openPathsFor(p.view, dest.path)]));
    setFocusPath(to);
    setSaid('');
    clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setSaid(`${item.label}을(를) ${dest.label}(으)로 옮겼어요.`), 500);
  };
  const views = [
    { id: 'all', label: '대시보드', icon: House, key: 'A', run: () => p.onSection({ kind: 'all' }) },
    { id: 'recent', label: '최근', icon: Clock, key: 'R', run: () => p.onSection({ kind: 'recent' }) },
    { id: 'archive', label: '보관함', icon: Archive, key: 'B', run: p.onArchive },
  ] as const;
  const folders = p.view?.projects ?? [];
  const loose = p.view?.loose ?? [];
  const titles = useMemo(() => titlesOf(p.view), [p.view]);
  return (
    <SidebarRoot label="사이드바">
      <SidebarHeader className="flex-row items-center gap-1 pt-[9px]">
        <ProjectName name={p.project} />
        <button type="button" className={ICON_BUTTON} aria-label="찾기 (Ctrl K)" title="찾기 (Ctrl K)" onClick={p.onCommands}>
          <Search />
        </button>
        <button type="button" className={cn(ICON_BUTTON, NEW_FILE_BUTTON)} aria-label="새 파일 (N)" title="새 파일 (N)" onClick={p.onNewFile}>
          <SquarePen />
        </button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {views.map((v) => (
            <SidebarMenuItem key={v.id}>
              <SidebarMenuButton aria-current={p.section.kind === v.id ? 'page' : undefined} onClick={v.run} data-nav={v.id} className="group/row">
                <v.icon aria-hidden />
                <span className="truncate">{v.label}</span>
                <Kbd className="ml-auto opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 max-md:hidden">{v.key}</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            {/* The board is a section of the shell (#731); this server holds one project, so it shows all its sessions (#778). */}
            <SidebarMenuButton
              aria-current={p.section.kind === 'board' && p.section.tab !== 'branches' ? 'page' : undefined}
              onClick={() => p.onSection(p.section.kind === 'board' && p.section.tab !== 'branches' ? p.section : { kind: 'board', tab: 'sessions' })}
              data-nav="board"
              className="group/row"
            >
              <LayoutGrid aria-hidden />
              <span className="truncate">세션 보드</span>
              <Kbd className="ml-auto opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 max-md:hidden">S</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {/* Branch status on its own row under the board (#793): every work branch, with or without an issue (#792, #810). */}
            <SidebarMenuButton
              aria-current={p.section.kind === 'board' && p.section.tab === 'branches' ? 'page' : undefined}
              onClick={() => p.onSection({ kind: 'board', tab: 'branches' })}
              data-nav="branches"
            >
              <GitBranch aria-hidden />
              <span className="truncate">브랜치</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkingAgents current={p.current} onOpen={p.onOpen} titleOf={(path) => titles.get(path) ?? null} />
        <SidebarGroup className="mt-3">
          <SidebarGroupLabel>문서</SidebarGroupLabel>
          {folders.length === 0 && loose.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{p.view ? '아직 문서가 없어요.' : '불러오는 중이에요…'}</p>
          ) : (
            <SidebarMenu>
              {folders.map((pr) => (
                <FolderRow key={pr.path} pr={pr} open={open} toggle={toggle} p={p} move={move} />
              ))}
              <DocRows nodes={loose} depth={-1} open={open} toggle={toggle} p={p} move={move} />
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <SidebarFooter>
        <SidebarModels />
        <SidebarMenu className="mt-3">
          <SidebarMenuItem>
            <SettingsEntry />
          </SidebarMenuItem>
        </SidebarMenu>
        <ThemeSwitch pref={p.themePref} onPref={p.onThemePref} system={p.systemTheme} />
      </SidebarFooter>
    </SidebarRoot>
  );
}
