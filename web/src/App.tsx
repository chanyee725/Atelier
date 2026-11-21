import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Block, type DocNode, type DpxFile, type Project, type ProjectsView, type TreeNode } from './api';
import type { CanvasFocus } from './canvas/ExcalidrawCanvas';
import { newBlockId } from './canvas/sync';
import { pipelineTemplate, planPath } from './pipelineTemplate';
import { Sidebar } from './Sidebar';
import { Home, type CreateKind } from './home/Home';
import { folderPrefix } from './home/model';
import { Alert } from './components/ui/alert';
import { Button } from './components/ui/button';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { ActivityAlerts } from './activity/ActivityAlerts';
import { AgentLiveHost } from './live/AgentLivePanel';
import { ChatDock } from './chat/ChatDock';
import { toastAction, toastResult } from './activity/actionToast';
import { Toaster } from './components/ui/sonner';
import type { EntryKind } from './activity/appEvents';
import { asTreeNode, docPlace, newFileDir, paletteScope, subFolderOf, type BoardExtra, type BoardSection, type Crumb, type Section } from './projectNav';
import { SubDocs } from './SubDocs';
import { DocMargin } from './doc/DocMargin';
import { Questions, QUESTIONS_ID } from './doc/Questions';
import { useAskingSteps } from './run/useAskingSteps';
import { openQuestions } from '../../shared/dispatch/discussions.ts';
import { moveTarget, subdocsMove, type MoveItem } from './sidebarMove';
import { isPipelineView, shownView, toCanvas } from './viewMode';
import { createFileSession, type FilePatch } from './fileSession';
import { useSession } from './useSession';
import { noteTree } from './freshPaths';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
import { STORAGE_KEY, defaultShare, loadShare, saveShare } from './splitRatio';
import { RunStrip } from './run/RunStrip';
import { watchRun } from './run/runData';
// The run view (E22) loads when it is first shown.
const RunView = lazy(() => import('./run/RunView'));
// The 플랜 view (#729) too.
const PlanView = lazy(() => import('./run/PlanView'));
// The 세션 보드 (#731) loads only when opened, so the editor bundle does not carry the Dispatch screens.
const SessionBoard = lazy(() => import('./dispatch/SessionBoard'));
import { LazyBoundary } from './LazyBoundary';
import { CHUNK_MESSAGE, isChunkLoadError } from './chunkError';
import { useTheme } from './theme';
import { fileStem } from './fileName';
import { moveErrorText, nameProblem, pathAfterMove, renameInitial, renameTarget } from './movePaths';
import { ExportMenu } from './ExportMenu';
import { DEFAULT_EXPORT, type ExportOptions } from './export/options';
import { HistoryDialog } from './HistoryDialog';
import { TrashDialog } from './TrashDialog';
import { CommandPalette } from './CommandPalette';
import { CommandRegistry, CommandRegistryContext, useCommandSource, type Command } from './commands';
import { displayName } from './docTitles';
import {
  ArrowUpRight, Circle, Clock, Columns2, Copy, CopyPlus, Delete, Diamond, Eraser, File, FilePlus, FileText, Hand, ImageDown, House, FolderClosed,
  Maximize, Minus, Moon, MousePointer2, Move, PanelLeft, PanelRight, Pencil, Redo2, RotateCcw, Scan, Shapes, Square,
  SquareDashedMousePointer, Sun, Trash, Type, Undo2, Workflow, ZoomIn, ZoomOut,
} from 'lucide-react';
import { exportBlock, exportCanvas, exportDocumentPdf, exportMarkdown, type ImageKind } from './export/actions';
import { blockExportTitle } from './export/markdown';
import type { CanvasHandle } from './export/types';
import { COPY_IMAGE_SHORTCUT, IS_MAC } from './platform';
import { PlanStrip } from './run/PlanStrip';
import { askConfirm, askText } from './appDialog';
import { AppDialogHost } from './AppDialogHost';
import { CanvasSlot } from './root/CanvasSlot';
import { DocSlot } from './root/DocSlot';
import { useNarrow } from './root/useNarrow';
import { useHashNavigation } from './root/useHashNavigation';
import { useSaveShortcut, useGlobalShortcuts, useShellShortcuts } from './root/useShortcuts';
import { useStartup } from './root/useStartup';
import { useUnloadGuard } from './root/useUnloadGuard';
import { useWorkspaceEvents } from './root/useWorkspaceEvents';
import { initialBoard, setBoardHash, setHashPath } from './root/hashRoute';

/** A top-level folder is a project (design doc 6 §1). */
const entryKind = (n: TreeNode): EntryKind => (n.type === 'file' ? 'doc' : n.path.includes('/') ? 'folder' : 'project');

type TreeFile = Extract<TreeNode, { type: 'file' }>;
/** Every file in the tree, depth first (folders in tree order). */
const filesOf = (nodes: TreeNode[]): TreeFile[] => nodes.flatMap((n) => (n.type === 'folder' ? filesOf(n.children) : [n]));

export function App() {
  const [theme, toggleTheme, themePref, setThemePref, systemTheme] = useTheme();
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  // The one project this server belongs to (#778): its folder name, shown top-left.
  const [projectName, setProjectName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [projects, setProjects] = useState<ProjectsView | null>(null);
  // What the main panel shows; opening a file switches to the document screen.
  const [section, setSection] = useState<Section>(() => {
    const b = initialBoard();
    return b ? { kind: 'board', tab: b.tab, folder: b.folder } : { kind: 'all' };
  });
  // 상시 화면 / 설정 asked for by a board address (old /dispatch#tv, #settings); the board handles it once.
  const [boardExtra, setBoardExtra] = useState<BoardExtra | null>(() => initialBoard()?.extra ?? null);
  // A session to open on the board, from a toast (`n` makes each request new).
  const [boardOpen, setBoardOpen] = useState<{ id: string; n: number } | null>(null);
  const [wideView, setView] = useState<View>('both');
  // Below md only one pane fits: the split view falls back to the document (design doc 6 §6).
  const baseView = shownView(wideView, narrow);
  // The doc share of the 둘 다 view: what this browser remembered, else the default (#976).
  const [storedShare, setStoredShare] = useState<number | null>(() => loadShare());
  const [error, setError] = useState<string | null>(null);
  // A request from the document to show a diagram block on the canvas; `n` makes each click a new request.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  // A heading link was opened: the document pane scrolls to it.
  const [jump, setJump] = useState<{ id: string; n: number } | null>(null);
  const jumpTo = useCallback((id: string | null) => setJump(id ? { id, n: Date.now() } : null), []);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT);
  const exportOptionsRef = useRef(exportOptions);
  exportOptionsRef.current = exportOptions;
  const [exportSelected, setExportSelected] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteGroup, setPaletteGroup] = useState<Command['group']>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  // Set by the canvas while it is mounted (export, palette commands).
  const canvasHandle = useRef<CanvasHandle | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.tree(), api.projects()]);
      noteTree(t, p.projects ?? p);
      setTree(t);
      setProjects(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했어요');
    }
  }, []);

  // Path this tab is deleting right now (see the SSE handler below).
  const removing = useRef<string | null>(null);
  // The open file and its saving (debounce, retry, conflict) live outside React; App reads only the
  // slices it shows, never blocks, canvas or document.
  const [session] = useState(() => createFileSession({ saveFile: (p, f, keepalive) => api.saveFile(p, f, keepalive), onSaved: () => void refreshTree(), onGone: () => { setHashPath(null); if (!removing.current) setError('열어 둔 파일이 지워졌거나 옮겨졌어요'); void refreshTree(); } }));
  const path = useSession(session, (s) => s.path);
  const hasFile = useSession(session, (s) => !!s.file);
  const title = useSession(session, (s) => s.file?.title ?? '');
  // A pipeline file (it has a plan): its runs show in the strip, the 실행 view and the canvas overlay.
  const hasPlan = useSession(session, (s) => !!s.file?.plan);
  const ratio = storedShare ?? defaultShare(hasPlan);
  const setRatio = useCallback((r: number) => {
    setStoredShare(r);
    saveShare(r);
  }, []);
  const resetRatio = useCallback(() => {
    setStoredShare(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // not remembered anyway
    }
  }, []);
  // Open in-document questions (#738): the agent area's badge, and the blocked steps of the plan.
  const openCount = useSession(session, (s) => openQuestions(s.file?.discussions).length);
  const asking = useAskingSteps(session);
  const toQuestions = useCallback(() => document.getElementById(QUESTIONS_ID)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), []);
  const planCode = useSession(session, (s) => s.file?.blocks.find((b) => b.id === s.file?.plan?.block)?.code);
  const view: View = !hasPlan && isPipelineView(baseView) ? 'doc' : baseView;
  useEffect(() => watchRun(hasPlan ? path : null), [hasPlan, path]);
  const status = useSession(session, (s) => s.status);
  const statusAlert = useSession(session, (s) => s.statusAlert);
  const conflict = useSession(session, (s) => s.conflict);
  const setStatus = session.setStatus;
  const edit = useCallback((patch: FilePatch) => session.edit(patch), [session]);
  const flushForReload = useCallback(() => session.flushForReload(), [session]);

  const load = useCallback(
    (p: string, f: DpxFile) => {
      session.load(p, f);
      setFocus(null);
      setJump(null);
      setHashPath(p);
    },
    [session],
  );

  /** Opens `p`; false when the user cancelled or the file could not be read (the current file stays open). */
  const open = useCallback(
    async (p: string): Promise<boolean> => {
      await session.flush();
      if (session.isDirty() && !(await askConfirm({ title: '저장하지 못한 변경이 있어요', body: '그래도 다른 파일을 열까요? 저장하지 못한 내용은 사라져요.', ok: '그래도 열기', danger: true }))) return false;
      setError(null);
      try {
        load(p, await api.readFile(p));
        setSection({ kind: 'doc' });
        if (narrow) setNavOpen(false);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '파일을 열지 못했어요');
        return false;
      }
    },
    [session, load, narrow],
  );
  const openFile = useCallback((p: string) => void open(p), [open]);

  useStartup({ refreshTree, load, jumpTo, setProjectName, setSection });

  useHashNavigation({ session, open, jumpTo, setSection, setBoardExtra });

  // 409 choices: drop local edits and re-read, or re-send local edits against the server's revision.
  const reload = async () => {
    const p = session.getState().path;
    if (!p) return;
    await session.idle();
    try {
      load(p, await api.readFile(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 불러오지 못했어요');
    }
  };
  const overwrite = () => void session.overwrite();

  // Restore = a normal save of the old version's content. The current state is kept as a version first.
  const restoreVersion = async (id: string): Promise<string | null> => {
    const p = session.getState().path;
    if (!p) return '열린 파일이 없어요';
    await session.flush();
    if (session.isDirty() || session.getState().conflict) return '저장되지 않은 변경이 있어 되돌리지 못했어요';
    try {
      const old = await api.historyVersion(p, id);
      await api.historySnapshot(p);
      const cur = await api.readFile(p);
      await api.saveFile(p, { revision: cur.revision, title: old.title, document: old.document, canvas: old.canvas, blocks: old.blocks, plan: old.plan });
      load(p, await api.readFile(p));
      void refreshTree();
      setStatus('이전 버전으로 되돌렸어요');
      return null;
    } catch (e) {
      return e instanceof ApiError && e.status === 409 ? '다른 곳에서 바뀌었어요. 다시 시도해 주세요' : '되돌리지 못했어요. 잠시 뒤 다시 시도해 주세요';
    }
  };

  useUnloadGuard(session);

  /** `folder` = project path the file goes into; undefined = the project shown (or the open file's), null = workspace root. */
  // `sub`: a sub-document of the open document, in the folder named after it (design doc 6 §1).
  const newFile = async (folder?: string | null, kind: CreateKind = 'doc', sub = false) => {
    const dir = sub && path ? subFolderOf(path) : folder === undefined ? newFileDir(section, projects, path) : (folder ?? '');
    const label = kind === 'plan' ? '새 파이프라인 계획 이름을 입력해 주세요' : '새 파일 이름을 입력해 주세요';
    const name = await askText({
      title: sub ? '새 하위 문서' : kind === 'plan' ? '새 파이프라인 계획' : '새 파일',
      body: sub ? '하위 문서 이름을 입력해 주세요' : dir ? `${label} (${dir} 안에 만들어요)` : label,
      label: '이름',
      ok: '만들기',
      validate: (v) => (fileStem(v) ? null : '이름을 입력해 주세요'),
    });
    const stem = name ? fileStem(name) : '';
    if (!stem) return;
    // A plan goes to <area>/<feature>/계획 like a lead's (#782), titled with the typed name.
    const p = kind === 'plan' ? planPath(dir, stem) : stem.includes('/') ? stem : folderPrefix(dir || null) + stem;
    const title = (kind === 'plan' ? stem.replace(/\/+$/, '') : p).split('/').pop()?.trim() || p;
    await session.flush();
    try {
      // A pipeline plan starts from the pipeline template (E18); other kinds start empty.
      await api.createFile(p, title, kind === 'plan' ? pipelineTemplate(newBlockId()) : undefined);
      toastAction({ type: 'created', kind: kind === 'canvas' ? 'canvas' : 'doc', path: p });
      await refreshTree();
      if (await open(p) && kind === 'canvas') setView('canvas');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? '같은 이름의 파일이 이미 있어요' : e instanceof Error ? e.message : '만들지 못했어요');
    }
  };
  // The open file is gone (deleted or moved away): drop it and its pending save.
  const closeOpenFile = useCallback(() => {
    session.close();
    setHashPath(null);
  }, [session]);

  // Moves started here, by their `from` path: the server's SSE echo of them is not an outside move.
  const ownMoves = useRef(new Set<string>());
  useWorkspaceEvents({ session, load, refreshTree, ownMoves, removing, setError });

  // `title`: a renamed file takes the new name as its title too, because the sidebar shows the title.
  // `sub`: a document's sub-documents folder that moves along in the same request (sidebar drag, 옮기기 menu).
  const move = async (n: TreeNode, to: string, title?: string, sub?: { from: string; to: string }): Promise<boolean> => {
    const from = n.path;
    const echoes = sub ? [from, sub.from] : [from];
    for (const x of echoes) ownMoves.current.add(x);
    setTimeout(() => echoes.forEach((x) => ownMoves.current.delete(x)), 5000);
    let readFailed = false;
    let release = () => {};
    try {
      await session.flush();
      // An edit made while the (possibly slow) move runs must not be saved to the old path. Only the open
      // file (or the folder holding it) needs this: holding for an unrelated move would also skip the save on tab close.
      const open = session.getState().path;
      const under = (dir: string) => !!open && open.startsWith(`${dir}/`);
      if (open && (open === from || (n.type === 'folder' && under(from)) || (sub && under(sub.from)))) release = session.hold();
      const r = await api.move(from, to, n.type, !!sub);
      const now = session.getState().path;
      const next = pathAfterMove(now, from, (r as { path?: string }).path ?? to, n.type) ?? (sub ? pathAfterMove(now, sub.from, sub.to, 'folder') : null);
      if (next) {
        // The revision is re-read: a name that was deleted before makes the server raise it.
        const fresh = await api.readFile(next).catch(() => null);
        if (!fresh) readFailed = true;
        session.rename(next, fresh?.revision);
        setHashPath(next);
      }
      if (title) {
        const dest = (r as { path?: string }).path ?? to;
        if (next) session.edit({ title });
        else {
          const f = await api.readFile(dest);
          await api.saveFile(dest, { ...f, title });
        }
      }
      const dest = (r as { path?: string }).path ?? to;
      const parent = (x: string) => x.slice(0, Math.max(0, x.lastIndexOf('/')));
      toastAction({ type: parent(from) === parent(dest) ? 'renamed' : 'moved', kind: entryKind(n), from, to: dest });
      await refreshTree();
      // The move worked but the new revision is unknown: the next save may ask to choose a version, so say why.
      if (readFailed) setError('옮겼어요. 다만 파일을 다시 읽지 못했어요. 저장이 안 되면 화면을 새로 고쳐 주세요');
      return true;
    } catch (e) {
      for (const x of echoes) ownMoves.current.delete(x);
      setError(moveErrorText(e instanceof ApiError ? e.status : undefined, e instanceof Error ? e.message : ''));
      return false;
    } finally {
      release();
    }
  };
  // Rename from the sidebar. A document's sub-documents folder (`X/` next to `X.dpx.json`) takes the new name too.
  const renameEntry = async (entry: DocNode | Project) => {
    const n = asTreeNode(entry);
    const initial = renameInitial(n);
    const name = await askText({
      title: '이름 바꾸기',
      label: '새 이름',
      initial,
      ok: '바꾸기',
      validate: (v) => (v.trim() === initial ? null : nameProblem(n, v)),
    });
    if (name == null || name.trim() === initial) return;
    const problem = nameProblem(n, name);
    if (problem) return setError(problem);
    const to = renameTarget(n, name);
    if (!to) return;
    // One request for a document: the server checks both targets first, so a taken sub-documents name refuses
    // the whole rename instead of leaving the sub-documents behind. An empty `X/` moves along too.
    const sub = n.type === 'file' ? { from: subFolderOf(n.path), to: subFolderOf(to) } : undefined;
    const ok = await move(n, to, n.type === 'file' ? fileStem(name) : undefined, sub);
    if (ok && section.kind === 'project' && section.path === n.path) setSection({ kind: 'project', path: to });
  };

  // Drag or 옮기기 menu in the sidebar: a document or group into a project or group. Resolves true when it moved.
  const moveEntry = async (item: MoveItem, dir: string): Promise<boolean> => {
    const to = moveTarget(item, dir);
    if (!to) return false;
    const n: TreeNode = item.kind === 'doc' ? { type: 'file', name: item.path.split('/').pop() ?? item.path, path: item.path, title: '', revision: null } : { type: 'folder', name: item.label, path: item.path, children: [] };
    return move(n, to, undefined, subdocsMove(item, to) ?? undefined);
  };

  const remove = async (entry: DocNode | Project) => {
    const n = asTreeNode(entry);
    const label = n.type === 'file' ? n.title || n.name : n.name;
    const subdocs = n.type === 'file' && 'children' in entry && entry.children.length > 0;
    const keep =
      n.type === 'folder'
        ? "안에 있던 파일은 30일 동안 '최근에 지운 파일'에서 하나씩 되살릴 수 있어요. 빈 폴더는 돌아오지 않아요."
        : subdocs
          ? "하위 문서도 함께 지워져요. 30일 동안은 '최근에 지운 파일'에서 하나씩 되살릴 수 있어요."
          : "30일 동안은 '최근에 지운 파일'에서 되살릴 수 있어요.";
    if (!(await askConfirm({ title: `"${label}"을(를) 지울까요?`, body: keep, ok: '지우기', danger: true }))) return;
    removing.current = n.path;
    try {
      // A document's sub-documents folder (`X/`, even an empty one) goes with it, so it never lingers as a group.
      if (n.type === 'file') await api.removeFile(n.path, true);
      else await api.removeFolder(n.path);
      toastAction({ type: 'deleted', kind: entryKind(n), path: n.path });
      const gone = n.type === 'file' ? subFolderOf(n.path) : n.path;
      if (path && (path === n.path || path.startsWith(`${gone}/`))) closeOpenFile();
      if (section.kind === 'project' && section.path === n.path) setSection({ kind: 'all' });
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : '지우지 못했어요');
    } finally {
      removing.current = null;
    }
  };

  const showDoc = view === 'doc' || view === 'both';
  const showCanvas = view === 'canvas' || view === 'both';
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const showBlock = useCallback((blockId: string) => {
    setView((v) => toCanvas(v, narrowRef.current));
    setFocus((f) => ({ blockId, n: (f?.n ?? 0) + 1 }));
  }, []);
  const showFrame = useCallback((frameId: string) => {
    setView((v) => toCanvas(v, narrowRef.current));
    setFocus((f) => ({ frameId, n: (f?.n ?? 0) + 1 }));
  }, []);
  const report = useCallback(
    (job: Promise<string> | string) =>
      Promise.resolve(job).then(
        (m) => toastResult(m),
        (e) => toastResult(isChunkLoadError(e) ? CHUNK_MESSAGE : e instanceof Error ? e.message : '내보내지 못했어요', true),
      ),
    [],
  );
  const imageExport = (kind: ImageKind) => void report(exportCanvas(canvasHandle.current, kind, session.getState().file?.title ?? '', exportOptions));
  const markdownExport = () => {
    const f = session.getState().file;
    if (f) void report(Promise.resolve().then(() => exportMarkdown(f.title, f.document, f.blocks)));
  };
  const pdfScope = exportSelected ? 'selection' : showDoc ? 'document' : 'canvas';
  const pdfExport = () => void report(pdfScope === 'document' ? Promise.resolve().then(() => exportDocumentPdf(session.getState().file?.document)) : exportCanvas(canvasHandle.current, 'pdf', session.getState().file?.title ?? '', exportOptions));
  const openExport = useCallback((o: boolean) => {
    if (o) setExportSelected(canvasHandle.current?.scope().selected ?? false);
    setExportOpen(o);
  }, []);
  const blockExport = useCallback(
    (b: Block, kind: ImageKind) => {
      const f = session.getState().file;
      void report(exportBlock(b, kind, blockExportTitle(f?.title ?? '', b, f?.blocks ?? []), exportOptionsRef.current));
    },
    [report, session],
  );

  useGlobalShortcuts({ fileOpen: hasFile, session, canvasHandle, exportOptions: exportOptionsRef, openExport, report, setExportOpen, setPaletteGroup, setPaletteOpen });

  const commands = (): Command[] => {
    const h = canvasHandle.current;
    const key = (k: Parameters<CanvasHandle['key']>[0]) => () => canvasHandle.current?.key(IS_MAC && k.ctrl ? { ...k, ctrl: false, meta: true } : k);
    const needCanvas = !h || !hasFile;
    const M = IS_MAC ? '⌘' : 'Ctrl+';
    const lay = !needCanvas && h ? h.layout.state() : null;
    const layoutEditCmd = (): Command => ({
      id: 'layout-edit',
      group: 'block',
      icon: Move,
      title: lay?.editing ? '레이아웃 편집 끝내기' : '레이아웃 편집',
      disabled: !lay?.block,
      hint: lay?.block ? undefined : '블록을 하나 고를 때',
      keywords: ['layout', 'edit', 'node', '배치', '노드', '옮기기'],
      run: () => canvasHandle.current?.layout.edit(),
    });
    const layoutResetCmd = (): Command => ({
      id: 'layout-reset',
      group: 'block',
      icon: RotateCcw,
      title: '레이아웃 초기화',
      disabled: !lay?.moved,
      hint: lay?.moved ? undefined : lay?.block ? '옮긴 배치가 없어요' : '블록을 하나 고를 때',
      keywords: ['layout', 'reset', '배치', '초기화', '자동 배치'],
      run: () => canvasHandle.current?.layout.reset(),
    });
    const freeformCmd = (): Command => ({
      id: 'block-freeform',
      group: 'block',
      icon: Shapes,
      title: '자유 도형으로 바꾸기',
      disabled: !lay?.graph,
      hint: lay?.graph ? undefined : lay?.block ? '그래프 블록만 바꿀 수 있어요' : '블록을 하나 고를 때',
      keywords: ['freeform', 'convert', 'shapes', 'ungroup', '자유', '도형', '변환', '바꾸기'],
      run: () => canvasHandle.current?.layout.freeform(),
    });
    const canvasCmd = (id: string, title: string, keys: string | undefined, k: Parameters<CanvasHandle['key']>[0], keywords: string[], icon: Command['icon']): Command => ({ id, title, group: 'canvas', icon, keys, disabled: needCanvas, hint: needCanvas ? '캔버스가 보일 때' : undefined, keywords, run: key(k) });
    return [
      { id: 'new-file', title: '새 파일', icon: FilePlus, keywords: ['new', 'file', 'create', '만들기', '파일'], run: () => void newFile() },
      { id: 'new-pipeline', title: '새 파이프라인', icon: Workflow, keywords: ['new', 'pipeline', 'plan', 'create', '만들기', '파이프라인', '계획'], run: () => void newFile(undefined, 'plan') },
      { id: 'export-svg', title: '캔버스를 SVG로 내보내기', icon: ImageDown, disabled: needCanvas, keywords: ['export', 'svg', '내보내기', '이미지'], run: () => imageExport('svg') },
      { id: 'export-png', title: '캔버스를 PNG로 내보내기', icon: ImageDown, disabled: needCanvas, keywords: ['export', 'png', '내보내기', '이미지'], run: () => imageExport('png') },
      { id: 'export-copy', title: '이미지로 복사', icon: Copy, keys: COPY_IMAGE_SHORTCUT, disabled: needCanvas, keywords: ['copy', 'image', '복사', '클립보드'], run: () => imageExport('copy') },
      { id: 'export-md', title: '문서를 Markdown으로 내보내기', icon: FileText, disabled: !hasFile, keywords: ['export', 'markdown', 'md', '내보내기', '문서'], run: markdownExport },
      { id: 'history', title: '버전 기록 열기', icon: Clock, disabled: !hasFile, keywords: ['history', 'version', 'restore', '버전', '기록', '되돌리기'], run: () => setHistoryOpen(true) },
      { id: 'trash', title: '최근에 지운 파일 보기', icon: Trash, keywords: ['trash', 'deleted', 'restore', '휴지통', '지운', '되살리기', '복구'], run: () => setTrashOpen(true) },
      { id: 'view-doc', title: '보기: 문서', group: 'view', icon: PanelLeft, run: () => setView('doc'), keywords: ['view', '보기'] },
      // A narrow screen fits one pane (the header has no 둘 다 there either).
      { id: 'view-both', title: '보기: 둘 다', group: 'view', icon: Columns2, disabled: narrow, hint: narrow ? '넓은 화면에서' : undefined, run: () => setView('both'), keywords: ['view', '보기'] },
      { id: 'view-canvas', title: '보기: 캔버스', group: 'view', icon: PanelRight, run: () => setView('canvas'), keywords: ['view', '보기'] },
      { id: 'theme', title: theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기', group: 'view', icon: theme === 'dark' ? Sun : Moon, run: toggleTheme, keywords: ['theme', 'dark', 'light', '테마', '다크'] },
      canvasCmd('tool-select', '도구: 선택', 'V', { key: 'v' }, ['tool', 'select', '도구'], MousePointer2),
      canvasCmd('tool-rect', '도구: 사각형', 'R', { key: 'r' }, ['tool', 'rectangle', '도구'], Square),
      canvasCmd('tool-diamond', '도구: 마름모', 'D', { key: 'd' }, ['tool', 'diamond', '도구'], Diamond),
      canvasCmd('tool-ellipse', '도구: 원', 'O', { key: 'o' }, ['tool', 'ellipse', 'circle', '도구'], Circle),
      canvasCmd('tool-arrow', '도구: 화살표', 'A', { key: 'a' }, ['tool', 'arrow', '도구'], ArrowUpRight),
      canvasCmd('tool-line', '도구: 선', 'L', { key: 'l' }, ['tool', 'line', '도구'], Minus),
      canvasCmd('tool-draw', '도구: 그리기', 'P', { key: 'p' }, ['tool', 'draw', 'pencil', '도구'], Pencil),
      canvasCmd('tool-text', '도구: 글자', 'T', { key: 't' }, ['tool', 'text', '도구'], Type),
      canvasCmd('tool-eraser', '도구: 지우개', 'E', { key: 'e' }, ['tool', 'eraser', '도구'], Eraser),
      canvasCmd('tool-hand', '도구: 손(화면 이동)', 'H', { key: 'h' }, ['tool', 'hand', 'pan', '도구'], Hand),
      canvasCmd('zoom-in', '확대', `${M}+`, { key: '=', code: 'Equal', ctrl: true }, ['zoom', '줌'], ZoomIn),
      canvasCmd('zoom-out', '축소', `${M}-`, { key: '-', code: 'Minus', ctrl: true }, ['zoom', '줌'], ZoomOut),
      canvasCmd('zoom-reset', '화면 크기 100%', `${M}0`, { key: '0', code: 'Digit0', ctrl: true }, ['zoom', '줌'], Scan),
      canvasCmd('zoom-fit', '모두 보이게 맞추기', 'Shift+1', { key: '!', code: 'Digit1', shift: true }, ['zoom', 'fit', '줌'], Maximize),
      canvasCmd('undo', '실행 취소', `${M}Z`, { key: 'z', ctrl: true }, ['undo', '되돌리기'], Undo2),
      canvasCmd('redo', '다시 실행', `${M}Shift+Z`, { key: 'z', ctrl: true, shift: true }, ['redo'], Redo2),
      canvasCmd('duplicate', '복제', `${M}D`, { key: 'd', ctrl: true }, ['duplicate', 'copy'], CopyPlus),
      canvasCmd('delete', '삭제', 'Delete', { key: 'Delete' }, ['delete', 'remove'], Delete),
      canvasCmd('select-all', '전체 선택', `${M}A`, { key: 'a', ctrl: true }, ['select', 'all'], SquareDashedMousePointer),
      layoutEditCmd(),
      layoutResetCmd(),
      freeformCmd(),
    ];
  };
  // Top-level folders are projects. Going to one closes the open file and shows the project home.
  const goProject = (id: string | null) => showSection(id ? { kind: 'project', path: id } : { kind: 'all' });
  const projectCommands = (): Command[] => [
    {
      id: 'project:all',
      title: '대시보드',
      group: 'project',
      icon: House,
      keywords: ['dashboard', 'home', '홈', '프로젝트', '모든 파일'],
      run: () => goProject(null),
    },
    ...tree
      .filter((n) => n.type === 'folder')
      .map((n) => ({
        id: `project:${n.path}`,
        title: n.name,
        group: 'project' as const,
        icon: FolderClosed,
        keywords: ['project', '프로젝트'],
        run: () => goProject(n.path),
      })),
  ];
  const fileCommands = (): Command[] =>
    filesOf(tree).map((f) => ({
      id: `file:${f.path}`,
      title: displayName(f),
      group: 'file',
      icon: File,
      hint: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : undefined,
      keywords: [f.name, f.path],
      disabled: f.path === path,
      searchOnly: true,
      run: () => void open(f.path),
    }));
  const [registry] = useState(() => new CommandRegistry());
  useCommandSource(registry, 'app', commands);
  useCommandSource(registry, 'files', fileCommands);
  useCommandSource(registry, 'projects', projectCommands);

  const dark = theme === 'dark';
  const place = useMemo(() => docPlace(projects, path), [projects, path]);
  // .doc-host spans the whole doc pane (gutters included), so hovering anywhere in it reveals the 목차 button.
  const doc = hasFile && path && (
    <div className="doc-host">
      {/* Agents editing this document get a margin beside it (E532); the document and its sub-documents slide together. */}
      <DocMargin file={path} questions={openCount} onQuestions={toQuestions}>
        {(onEditor) => (
          <>
            {/* Questions agents asked in this document (#738), answered in place. */}
            <Questions session={session} />
            <DocSlot session={session} dark={dark} tree={tree} jump={jump} onOpenFile={openFile} onShow={showBlock} onShowFrame={showFrame} onExportBlock={blockExport} onFail={flushForReload} onEditor={onEditor} />
            <SubDocs node={place.node} onOpen={openFile} onAdd={() => void newFile(undefined, 'doc', true)} />
          </>
        )}
      </DocMargin>
    </div>
  );
  const canvas = <CanvasSlot session={session} focus={focus} dark={dark} handle={canvasHandle} onFail={flushForReload} />;

  // Every screen, the document one included, is a floating panel on the sidebar frame (#889).
  const docScreen = hasFile && section.kind === 'doc';
  const homeSection = section.kind === 'doc' ? ({ kind: 'all' } as const) : section;
  // The project the chat dock's helper works for (#937): the one shown, else the open file's, else none.
  const chatFolder = newFileDir(docScreen ? section : homeSection, projects, path) || null;
  // Dashboard / project home (shown outside the document screen): null = all files, else a project id (its folder path).
  const homeProject = homeSection.kind === 'project' ? homeSection.path : null;
  const showSection = useCallback(
    (s: Section) => {
      setSection(s);
      // The file stays loaded (its edits are already in the session); the address no longer names it.
      if (s.kind === 'board') setBoardHash(s);
      else setHashPath(null);
      if (narrow) setNavOpen(false);
    },
    [narrow],
  );
  // A toast's session request is for the board shown now; leaving the board drops it so coming back does not reopen it.
  useEffect(() => {
    if (section.kind !== 'board') setBoardOpen(null);
  }, [section.kind]);
  const findFile = useCallback(() => {
    setExportOpen(false);
    setPaletteGroup('file');
    setPaletteOpen(true);
  }, []);
  const showBoard = useCallback((folder?: string | null) => showSection({ kind: 'board', tab: 'sessions', folder }), [showSection]);
  // 세션 열기 on a toast: the board opens (keeping its tab and scope when it is already shown) with that session.
  const openBoardSession = useCallback(
    (id: string) => {
      setSection((s) => {
        const b: BoardSection = s.kind === 'board' ? s : { kind: 'board', tab: 'sessions' };
        setBoardHash(b);
        return b;
      });
      setBoardOpen({ id, n: Date.now() });
      if (narrow) setNavOpen(false);
    },
    [narrow],
  );
  // The board's own header (tabs, scope) moves within the board.
  const routeBoard = useCallback((tab: BoardSection['tab'], folder: string | null | undefined) => showSection({ kind: 'board', tab, folder }), [showSection]);
  const extraDone = useCallback(() => {
    setBoardExtra(null);
    // Drop `#board=tv` / `=settings` from the address so a reload does not open it again.
    setSection((s) => {
      if (s.kind === 'board') setBoardHash(s, true);
      return s;
    });
  }, []);
  const openCrumb = (c: Crumb) => (c.kind === 'project' ? showSection({ kind: 'project', path: c.path }) : void open(c.path));

  const newFileRef = useRef(newFile);
  newFileRef.current = newFile;
  useShellShortcuts({ showSection, showBoard, onArchive: () => setTrashOpen(true), newFile: newFileRef });

  useSaveShortcut(session);

  const sidebar = (
    <Sidebar
      project={projectName}
      view={projects}
      section={docScreen ? section : homeSection}
      current={docScreen ? path : null}
      onSection={showSection}
      onOpen={openFile}
      onNewFile={() => void newFile()}
      onRename={(n) => void renameEntry(n)}
      onDelete={(n) => void remove(n)}
      onMove={moveEntry}
      onArchive={() => setTrashOpen(true)}
      onCommands={() => {
        setExportOpen(false);
        setPaletteOpen(true);
      }}
      themePref={themePref}
      onThemePref={setThemePref}
      systemTheme={systemTheme}
    />
  );

  return (
    <CommandRegistryContext.Provider value={registry}>
      <SidebarProvider openMobile={navOpen} onOpenMobileChange={setNavOpen}>
        {sidebar}
        <ActivityAlerts onOpen={openFile} onSession={openBoardSession} />
        <AgentLiveHost onOpenFile={openFile} dark={dark} />
        <ChatDock folder={chatFolder} />
        <AppDialogHost />
        <Toaster dark={dark} />
        <SidebarInset>
          {historyOpen && path && <HistoryDialog path={path} dark={dark} onClose={() => setHistoryOpen(false)} onRestore={restoreVersion} />}
          {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} onRestored={() => void refreshTree()} />}
          {paletteOpen && <CommandPalette commands={registry.list()} scope={paletteScope(docScreen ? section : homeSection, projects, path)} onlyGroup={paletteGroup} onClose={() => setPaletteOpen(false)} />}
          {conflict && (
            <Alert className="border-b-0 bg-muted">
              <span className="mr-auto">이 파일이 다른 곳에서 바뀌었어요. 어떻게 할까요?</span>
              <Button variant="outline" size="sm" className="bg-transparent px-3 text-sm" onClick={() => void reload()}>
                다시 불러오기
              </Button>
              <Button size="sm" disabled={conflict.revision === undefined} className="px-3 text-sm hover:bg-primary" onClick={overwrite}>
                내 것으로 덮어쓰기
              </Button>
            </Alert>
          )}
          {error && (
            <Alert className="flex-nowrap border-b-0 bg-muted">
              <span>{error}</span>
              <button type="button" className="ml-auto cursor-pointer rounded-sm px-1 underline transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => setError(null)}>
                닫기
              </button>
            </Alert>
          )}
          {section.kind === 'board' ? (
            <LazyBoundary>
              <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>}>
                <SessionBoard tab={section.tab} folder={section.folder} onRoute={routeBoard} openRequest={boardOpen} extra={boardExtra} onExtraDone={extraDone} narrow={narrow} />
              </Suspense>
            </LazyBoundary>
          ) : !docScreen ? (
            <Home
              projectName={projectName}
              narrow={narrow}
             
              project={homeProject}
              recent={homeSection.kind === 'recent'}
              onArchive={() => setTrashOpen(true)}
              version={tree}
              onProject={goProject}
              onOpen={openFile}
              onCreate={(k, project) => void newFile(project, k)}
              // '' = the whole-project dashboard: the whole board, not 미분류.
              onBoard={(f, tab) => showSection({ kind: 'board', tab: tab ?? 'sessions', folder: f || undefined })}
              onSession={openBoardSession}
              // `/` on the dashboard: the command menu on its 문서 section, the same search Ctrl/⌘+K opens (#793).
              onFind={findFile}
            />
          ) : (
            <>
          <TopBar
            title={title}
            hasFile={hasFile}
            status={status}
            statusAlert={statusAlert}
            view={view}
            canRun={hasPlan}
            onView={setView}
            narrow={narrow}
            trail={place.trail}
            onCrumb={openCrumb}
            onSubDoc={() => void newFile(undefined, 'doc', true)}
            onTitle={(title) => edit({ title })}
            onHistory={() => setHistoryOpen(true)}
           
          onCommands={() => {
            setExportOpen(false);
            setPaletteGroup(undefined);
            setPaletteOpen(true);
          }}
            onToggleNav={narrow ? () => setNavOpen((o) => !o) : undefined}
            exportMenu={
              <ExportMenu
                narrow={narrow}
                open={exportOpen}
                onOpen={openExport}
                disabled={!hasFile}
                canvasReady={showCanvas}
                selected={exportSelected}
                options={exportOptions}
                onOptions={setExportOptions}
                onImage={imageExport}
                onMarkdown={markdownExport}
                pdfScope={pdfScope}
                onPdf={pdfExport}
              />
            }
          />
          {/* The 플랜 tab holds its own strip (#729), so the plan is reviewed and approved in one place. */}
          {view !== 'plan' && <PlanStrip session={session} />}
          {hasPlan && <RunStrip code={planCode} asking={asking} inRunView={view === 'run'} onRunView={() => setView('run')} onOpenFile={openFile} />}
              {view === 'run' ? (
            <LazyBoundary onFail={flushForReload}>
              <Suspense fallback={null}>
                <RunView code={planCode} asking={asking} />
              </Suspense>
            </LazyBoundary>
          ) : view === 'plan' ? (
            <LazyBoundary onFail={flushForReload}>
              <Suspense fallback={null}>
                <PlanView session={session} />
              </Suspense>
            </LazyBoundary>
          ) : view === 'both' ? (
            <Splitter ratio={ratio} onRatio={setRatio} onReset={resetRatio} left={doc} right={canvas} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {showDoc && doc}
              {showCanvas && canvas}
            </div>
          )}
            </>
          )}
        </SidebarInset>
      </SidebarProvider>
    </CommandRegistryContext.Provider>
  );
}
