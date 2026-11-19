import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Block, type DocNode, type DpxFile, type Project, type ProjectsView, type TreeNode } from './api';
import type { CanvasData, CanvasFocus } from './canvas/ExcalidrawCanvas';
import { newBlockId, sameDrawing } from './canvas/sync';
import { pipelineTemplate, planPath } from './pipelineTemplate';
import { blocksInFrame, frameScene as sceneOf, frameSceneSig, type CanvasEl } from './doc/model';
import { Sidebar } from './Sidebar';
import { Home, type CreateKind } from './home/Home';
import { CHORD_MS, chord, folderPrefix } from './home/model';
import { Alert } from './components/ui/alert';
import { Button, buttonVariants } from './components/ui/button';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { ActivityAlerts } from './activity/ActivityAlerts';
import { ActivityBell } from './activity/ActivityBell';
import { AgentLiveHost } from './live/AgentLivePanel';
import { notifyApp } from './activity/appToasts';
import type { EntryKind } from './activity/appEvents';
import { asTreeNode, boardHash, docPlace, newFileDir, paletteScope, parseBoardHash, shellKey, subFolderOf, type BoardExtra, type BoardSection, type Crumb, type Section } from './projectNav';
import { SubDocs } from './SubDocs';
import { DocMargin } from './doc/DocMargin';
import { Questions, QUESTIONS_ID } from './doc/Questions';
import { openQuestions } from '../../shared/dispatch/discussions.ts';
import type { Editor } from '@tiptap/core';
import { moveTarget, subdocsMove, type MoveItem } from './sidebarMove';
import { isPipelineView, shownView, toCanvas } from './viewMode';
import { createFileSession, type FilePatch, type FileSession } from './fileSession';
import { useSession } from './useSession';
import { noteTree } from './freshPaths';
import { canApplyLive, type WorkspaceEvent } from './externalChange';
import { TopBar, type View } from './TopBar';
import { Splitter } from './Splitter';
import { RunStrip } from './run/RunStrip';
import { onRunEvent, reloadRun, watchRun } from './run/runData';
import { applyCursorEvent, applyCursorStatusEvent, clearCursors } from './canvas/cursorStore';
import { applyDocCursorEvent, applyDocCursorStatusEvent, clearDocCursors } from './doc/docCursorStore';
import type { CursorEvent, CursorStatusEvent } from './canvas/agentCursor';
import type { RunEvent } from './run/runModel';
// The run view (E22) loads when it is first shown.
const RunView = lazy(() => import('./run/RunView'));
// The 플랜 view (#729) too.
const PlanView = lazy(() => import('./run/PlanView'));
// The 세션 보드 (#731) loads only when opened, so the editor bundle does not carry the Dispatch screens.
const SessionBoard = lazy(() => import('./dispatch/SessionBoard'));
// TipTap and the diagram renderer are big; they load when a file is first opened.
const DocPane = lazy(() => import('./DocPane').then((m) => ({ default: m.DocPane })));
import { CanvasPane } from './CanvasPane';
import { LazyBoundary } from './LazyBoundary';
import { CHUNK_MESSAGE, isChunkLoadError } from './chunkError';
import { useTheme } from './theme';
import { fileStem } from './fileName';
import { moveErrorText, nameProblem, pathAfterMove, renameInitial, renameTarget } from './movePaths';
import { parseHash } from './doc/outline';
import { agentFromHash, withAgent } from './live/store';
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
import { COPY_IMAGE_SHORTCUT, EXPORT_MENU_QUERY, IS_MAC } from './platform';
import { PlanStrip } from './run/PlanStrip';
import { events } from './lib/events';
import { askConfirm, askText } from './appDialog';
import { AppDialogHost } from './AppDialogHost';

const NARROW = '(max-width: 767px)';
/** A top-level folder is a project (design doc 6 §1). */
const entryKind = (n: TreeNode): EntryKind => (n.type === 'file' ? 'doc' : n.path.includes('/') ? 'folder' : 'project');

// The open file lives in the URL hash so a reload reopens it. Only the workspace-relative path is kept, plus the
// open agent live view (`&agent=<sid>`, web/src/live/store.ts), which survives a file change.
// Leaving the 세션 보드 adds a history entry, so 뒤로 goes back to the board (#731).
const setHashPath = (p: string | null) => {
  const sid = agentFromHash(window.location.hash);
  const url = `${window.location.pathname}${window.location.search}${withAgent(p ? `#file=${encodeURIComponent(p)}` : '', sid)}`;
  if (parseBoardHash(window.location.hash)) window.history.pushState({ drawing: 1 }, '', url);
  else window.history.replaceState({ drawing: 1 }, '', url);
};
// The 세션 보드's address: a new history entry when it changes, so back/forward walk the board's tabs and scope.
const setBoardHash = (b: BoardSection, replace = false) => {
  const url = `${window.location.pathname}${window.location.search}${withAgent(boardHash(b), agentFromHash(window.location.hash))}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;
  if (replace) window.history.replaceState({ drawing: 1 }, '', url);
  else window.history.pushState({ drawing: 1 }, '', url);
};
/** The board route of the address this page opened with, if any. */
const initialBoard = () => parseBoardHash(window.location.hash);
// A link followed in this tab was cancelled or failed: the browser already added a history entry for it.
// Step back over that entry (state is null on entries the browser made) so history has no duplicate of the open file.
const undoLinkEntry = (current: string | null) => {
  if (window.history.state === null) window.history.back();
  else setHashPath(current);
};

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return narrow;
}

const NO_BLOCKS: Block[] = [];

type TreeFile = Extract<TreeNode, { type: 'file' }>;
/** Every file in the tree, depth first (folders in tree order). */
const filesOf = (nodes: TreeNode[]): TreeFile[] => nodes.flatMap((n) => (n.type === 'folder' ? filesOf(n.children) : [n]));

// The panes read the file from the session themselves, so a canvas drag or a keystroke in the document
// re-renders only the pane that changed, not the whole app.
type DocSlotProps = {
  session: FileSession;
  dark: boolean;
  tree: TreeNode[];
  jump: { id: string; n: number } | null;
  onOpenFile: (path: string) => void;
  onNotice: (message: string) => void;
  onShow: (blockId: string) => void;
  onShowFrame: (frameId: string) => void;
  onExportBlock: (b: Block, kind: ImageKind) => void;
  onFail: () => Promise<boolean>;
  /** The document's editor, for the agent margin (E532). */
  onEditor?: (editor: Editor | null) => void;
};
const elementsOf = (canvas: unknown): CanvasEl[] => {
  const els = (canvas as { elements?: unknown } | null | undefined)?.elements;
  return Array.isArray(els) ? (els as CanvasEl[]) : [];
};
const inFrames = (blocks: Block[], els: CanvasEl[]): Block[] => {
  const frames = els.filter((e) => !e.isDeleted && (e.type === 'frame' || e.type === 'magicframe'));
  if (!frames.length) return NO_BLOCKS;
  return blocks.filter((b) => frames.some((f) => blocksInFrame({ x: f.x ?? 0, y: f.y ?? 0, width: f.width ?? 0, height: f.height ?? 0 }, [b]).length));
};
const sameFrameBlocks = (a: Block[], b: Block[]) => sameDrawing(a, b) && a.every((x, i) => x.x === b[i].x && x.y === b[i].y && x.w === b[i].w && x.h === b[i].h);
/** `value` once it has stopped changing for `ms`; a new `reset` key (another file) takes the live value at once. */
function useSettled<T>(value: T, ms: number, reset: string): T {
  const [v, setV] = useState({ value, reset });
  useEffect(() => {
    const t = setTimeout(() => setV({ value, reset }), ms);
    return () => clearTimeout(t);
  }, [value, ms, reset]);
  return v.reset === reset ? v.value : value;
}
const DocSlot = memo(function DocSlot({ session, dark, tree, jump, onOpenFile, onNotice, onShow, onShowFrame, onExportBlock, onFail, onEditor }: DocSlotProps) {
  const path = useSession(session, (s) => s.path ?? '');
  const key = useSession(session, (s) => `${s.path}#${s.loadSeq}`);
  const live = useSession(session, (s) => s.live);
  const remount = useCallback(() => session.remount(), [session]);
  // Blocks as drawn: a new array only when a block's id, type or code changes, not when it moves.
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS, sameDrawing);
  // Frames and their contents: a new array only when one of those changes (not when a block or other drawing does).
  const liveFrameScene = useSession(session, (s) => sceneOf(elementsOf(s.file?.canvas)), (a, b) => frameSceneSig(a) === frameSceneSig(b));
  // Blocks inside a frame, with where they sit: the frame preview draws them (they are not canvas elements).
  const liveFrameBlocks = useSession(session, (s) => inFrames(s.file?.blocks ?? NO_BLOCKS, elementsOf(s.file?.canvas)), sameFrameBlocks);
  // A block dragged inside a frame changes this many times a second; the preview (and the pane's context) follows once it settles.
  // Frames and their blocks settle together, so a moved frame and its blocks never draw out of step.
  const framePair = useMemo(() => ({ scene: liveFrameScene, blocks: liveFrameBlocks }), [liveFrameScene, liveFrameBlocks]);
  const { scene: frameScene, blocks: frameBlocks } = useSettled(framePair, 250, key);
  const getBlocks = useCallback(() => session.getState().file?.blocks ?? NO_BLOCKS, [session]);
  const getCanvas = useCallback(() => session.getState().file?.canvas, [session]);
  const onDocument = useCallback((d: unknown) => session.edit({ document: d }), [session]);
  const onBlocks = useCallback((b: Block[]) => session.edit({ blocks: b }), [session]);
  return (
    <LazyBoundary key={key} onFail={onFail}>
      <Suspense
        fallback={
          <p className="p-6 text-sm text-muted-foreground">
            문서를 불러오는 중이에요…
          </p>
        }
      >
        <DocPane
          key={key}
          // Read once when the pane starts (it is remounted per load).
          document={session.getState().file?.document}
          live={live}
          onLiveFail={remount}
          blocks={blocks}
          getBlocks={getBlocks}
          getCanvas={getCanvas}
          dark={dark}
          path={path}
          tree={tree}
          onOpenFile={onOpenFile}
          jump={jump}
          onNotice={onNotice}
          onDocument={onDocument}
          onBlocks={onBlocks}
          onShow={onShow}
          frameScene={frameScene}
          frameBlocks={frameBlocks}
          onShowFrame={onShowFrame}
          onExportBlock={onExportBlock}
          onEditor={onEditor}
        />
      </Suspense>
    </LazyBoundary>
  );
});

type CanvasSlotProps = {
  session: FileSession;
  focus: CanvasFocus | null;
  dark: boolean;
  handle: { current: CanvasHandle | null };
  onFail: () => Promise<boolean>;
};
const CanvasSlot = memo(function CanvasSlot({ session, focus, dark, handle, onFail }: CanvasSlotProps) {
  const fileKey = useSession(session, (s) => (s.file && s.path ? `${s.path}#${s.loadSeq}` : null));
  const canvas = useSession(session, (s) => s.file?.canvas);
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS);
  const onChange = useCallback((patch: { canvas?: CanvasData; blocks?: Block[] }) => session.edit(patch), [session]);
  return <CanvasPane fileKey={fileKey} canvas={canvas} blocks={blocks} focus={focus} dark={dark} onChange={onChange} handle={handle} onFail={onFail} />;
});

export function App() {
  const [theme, toggleTheme, themePref, setThemePref, systemTheme] = useTheme();
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  // The one project this server belongs to (#778): its folder name, shown top-left.
  const [projectName, setProjectName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const treePaths = useMemo(() => filesOf(tree).map((f) => f.path), [tree]);
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
  const [ratio, setRatio] = useState(0.45);
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
  // Open in-document questions (#738): the agent area's badge, and the blocked steps of the plan.
  const openCount = useSession(session, (s) => openQuestions(s.file?.discussions).length);
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

  useEffect(() => {
    api.info().then((i) => setProjectName(i.project || i.workspace || null)).catch(() => {});
    void refreshTree();
    const link = parseHash(window.location.hash);
    if (link)
      api
        .readFile(link.path)
        .then((f) => {
          load(link.path, f);
          setSection({ kind: 'doc' });
          jumpTo(link.heading);
        })
        .catch(() => setHashPath(null));
  }, [refreshTree, load, jumpTo]);

  // A heading link pasted into the address bar of this tab (only the hash changes, so the page does not reload).
  useEffect(() => {
    const onHash = () => {
      // Back/forward into or within the 세션 보드 (#731).
      const board = parseBoardHash(window.location.hash);
      if (board) {
        setSection({ kind: 'board', tab: board.tab, folder: board.folder });
        if (board.extra) setBoardExtra(board.extra);
        return;
      }
      const link = parseHash(window.location.hash);
      if (!link) {
        // Back from the board to an entry without a file: the dashboard.
        setSection((s) => (s.kind === 'board' ? { kind: 'all' } : s));
        return;
      }
      // Drop `&h=` (same file) or restore the open file's hash (cancelled or failed open), so the
      // address bar always names the open file and following the same link again fires `hashchange`.
      const current = session.getState().path;
      if (link.path === current) {
        setSection({ kind: 'doc' });
        setHashPath(current);
        return jumpTo(link.heading);
      }
      void open(link.path).then((ok) => {
        if (ok) jumpTo(link.heading);
        else undoLinkEntry(session.getState().path);
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [session, open, jumpTo]);

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

  // Warn before leaving with unsaved edits; on pagehide send them with keepalive.
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (session.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const hide = () => session.saveOnHide();
    window.addEventListener('beforeunload', before);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);

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
      notifyApp({ type: 'created', kind: kind === 'canvas' ? 'canvas' : 'doc', path: p });
      await refreshTree();
      if (await open(p) && kind === 'canvas') setView('canvas');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? '같은 이름의 파일이 이미 있어요' : e instanceof Error ? e.message : '만들지 못했어요');
    }
  };
  // The server now runs in another folder: everything on screen belongs to the old one, so start over at home.
  const reloadForWorkspace = () => window.location.assign('/');
  // The open file is gone (deleted or moved away): drop it and its pending save.
  const closeOpenFile = useCallback(() => {
    session.close();
    setHashPath(null);
  }, [session]);

  // Other tabs and outside edits: keep the file list current, reload the open file when it changed and holds no unsaved edits.
  useEffect(() => {
    // Another tab switched the server to another folder (E554).
    const offSwitch = events.subscribeJson('workspace-switch', reloadForWorkspace);
    const offWorkspace = events.subscribeJson<WorkspaceEvent>('workspace', (e) => {
      // This tab's own move already renames the open file; the echo must not close it.
      if (e.kind === 'tree' && e.from !== undefined && ownMoves.current.delete(e.from)) {
        void refreshTree();
        return;
      }
      if (session.external(e, (p) => api.readFile(p), (p, f) => (canApplyLive(session.getState().file, f) ? session.applyLive(p, f) : load(p, f))) === 'close') {
        setHashPath(null);
        // Our own delete can be announced before its response arrives: that close needs no error.
        if (!removing.current) setError('열어 둔 파일이 지워졌거나 옮겨졌어요');
      }
      void refreshTree();
    });
    // Runs of the open file; a run starting or ending also changes its tree badge.
    const offRun = events.subscribeJson<RunEvent>('run', (e) => {
      onRunEvent(e);
      if (e.run) void refreshTree();
      // A run that ended: no agent is editing its file any more.
      if (e.run?.endedAt) {
        clearCursors(e.file);
        clearDocCursors(e.file);
      }
    });
    // Live agent cursors (E56): where an agent session is editing a diagram. A malformed event moves nothing.
    // The same events place agent cursors in the document (E529) when they carry a document place.
    const offCursor = events.subscribeJson<CursorEvent>('cursor', (e) => {
      applyCursorEvent(e);
      applyDocCursorEvent(e);
    });
    // A session's status label changed (E536): the tag text only, the cursor stays where it is.
    const offStatus = events.subscribeJson<CursorStatusEvent>('cursor-status', (e) => {
      applyCursorStatusEvent(e);
      applyDocCursorStatusEvent(e);
    });
    // Events missed while the stream was down: read the run again. Cursors from before the gap are stale; the server
    // sends the cursors of sessions still at work to the new connection (live cursors only leave on `gone`).
    const offOpen = events.onConnection((online) => {
      if (!online) return;
      clearCursors();
      clearDocCursors();
      void reloadRun();
    });
    return () => {
      offSwitch();
      offWorkspace();
      offRun();
      offCursor();
      offStatus();
      offOpen();
    };
  }, [session, load, refreshTree]);

  // Moves started here, by their `from` path: the server's SSE echo of them is not an outside move.
  const ownMoves = useRef(new Set<string>());
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
      notifyApp({ type: parent(from) === parent(dest) ? 'renamed' : 'moved', kind: entryKind(n), from, to: dest });
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
      notifyApp({ type: 'deleted', kind: entryKind(n), path: n.path });
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
        (m) => setStatus(m),
        (e) => setStatus(isChunkLoadError(e) ? CHUNK_MESSAGE : e instanceof Error ? e.message : '내보내지 못했어요', true),
      ),
    [setStatus],
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

  // Global shortcuts (capture phase, so they win over the canvas and the editor): Ctrl/Cmd+K palette,
  // Ctrl/Cmd+E export, Shift+Alt+C copy as image. Tool keys, zoom, undo/redo, duplicate, delete and
  // select all are the canvas's own keys, active while the canvas has focus.
  const fileOpen = hasFile;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // A native modal <dialog> (settings) owns the keyboard: no palette, G P or export behind it.
      if (document.querySelector('dialog:modal')) return;
      // Mac uses only Cmd, everything else only Ctrl, so Mac's Ctrl+E/K stay with text fields.
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const k = e.code;
      // Inside a text field, the document editor or the code editor these keys belong to the editor
      // (Ctrl+E is "code" in the document), so the export shortcuts step aside; the menu and palette still work.
      const editing = e.target instanceof Element && !!e.target.closest('.ProseMirror, input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""]');
      if (!mod && !e.shiftKey && !e.altKey && !editing && !e.isComposing && !e.repeat && !(e.target instanceof Element && e.target.closest('[role=dialog], [role=menu]'))) {
        if (k === 'KeyG') chord.g = Date.now();
        else if (k === 'KeyP' && Date.now() - chord.g < CHORD_MS) {
          e.preventDefault();
          e.stopPropagation(); // the canvas must not also take P as its own tool key
          setTimeout(() => (chord.g = 0));
          setExportOpen(false);
          setPaletteGroup('project');
          setPaletteOpen(true);
          return;
        }
      }
      if (mod && !e.shiftKey && !e.altKey && k === 'KeyK') {
        e.preventDefault();
        e.stopPropagation();
        setExportOpen(false);
        setPaletteGroup(undefined);
        setPaletteOpen((o) => !o);
      } else if (mod && !e.shiftKey && !e.altKey && k === 'KeyE' && fileOpen && !editing && window.matchMedia(EXPORT_MENU_QUERY).matches) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        openExport(true);
      } else if (!mod && e.shiftKey && e.altKey && k === 'KeyC' && fileOpen && !editing) {
        e.preventDefault();
        e.stopPropagation();
        void report(exportCanvas(canvasHandle.current, 'copy', session.getState().file?.title ?? '', exportOptionsRef.current));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileOpen, openExport, report, session]);

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
            <DocSlot session={session} dark={dark} tree={tree} jump={jump} onOpenFile={openFile} onNotice={setStatus} onShow={showBlock} onShowFrame={showFrame} onExportBlock={blockExport} onFail={flushForReload} onEditor={onEditor} />
            <SubDocs node={place.node} onOpen={openFile} onAdd={() => void newFile(undefined, 'doc', true)} />
          </>
        )}
      </DocMargin>
    </div>
  );
  const canvas = <CanvasSlot session={session} focus={focus} dark={dark} handle={canvasHandle} onFail={flushForReload} />;

  // The document screen sits flush against the sidebar (frame A); everything else is a floating panel (frame B).
  const docScreen = hasFile && section.kind === 'doc';
  const homeSection = section.kind === 'doc' ? ({ kind: 'all' } as const) : section;
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

  // Shell shortcuts (doc 6 §5): A 홈, R 최근, B 보관함, N 새 파일. Never inside a text field,
  // an editor, the canvas (its own tool keys) or a dialog: see shellKey.
  const newFileRef = useRef(newFile);
  newFileRef.current = newFile;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = shellKey(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'all') showSection({ kind: 'all' });
      else if (k === 'recent') showSection({ kind: 'recent' });
      else if (k === 'board') showBoard();
      else if (k === 'archive') setTrashOpen(true);
      else if (k === 'new') void newFileRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSection, showBoard]);

  // Ctrl/Cmd+S (E540, #671): save now and say so. Autosave stays quiet: a toast per pause in typing would be noise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyS') return;
      e.preventDefault();
      const p = session.getState().path;
      if (!p) return;
      void session.flush().then(() => {
        const st = session.getState();
        if (st.path !== p) return;
        notifyApp(st.statusAlert ? { type: 'save-failed', path: p } : { type: 'saved', path: p });
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session]);

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

  // The 알림함 sits at the right end of whichever top bar is on screen (#786).
  const bell = <ActivityBell className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'shrink-0 text-muted-foreground max-md:size-11 [&>svg]:size-[17px]' })} onOpen={openFile} onSession={openBoardSession} files={treePaths} />;
  return (
    <CommandRegistryContext.Provider value={registry}>
      <SidebarProvider openMobile={navOpen} onOpenMobileChange={setNavOpen}>
        {sidebar}
        <ActivityAlerts onOpen={openFile} onSession={openBoardSession} />
        <AgentLiveHost onOpenFile={openFile} />
        <AppDialogHost />
        <SidebarInset frame={docScreen ? 'attached' : 'floating'}>
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
                <SessionBoard tab={section.tab} folder={section.folder} onRoute={routeBoard} openRequest={boardOpen} extra={boardExtra} onExtraDone={extraDone} bell={bell} />
              </Suspense>
            </LazyBoundary>
          ) : !docScreen ? (
            <Home
              projectName={projectName}
              narrow={narrow}
              bell={bell}
              project={homeProject}
              version={tree}
              onProject={goProject}
              onOpen={openFile}
              onCreate={(k, project) => void newFile(project, k)}
              // '' = the whole-project dashboard: the whole board, not 미분류.
              onBoard={(f, tab) => showSection({ kind: 'board', tab: tab ?? 'sessions', folder: f || undefined })}
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
            bell={bell}
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
          {hasPlan && <RunStrip code={planCode} inRunView={view === 'run'} onRunView={() => setView('run')} onOpenFile={openFile} />}
              {view === 'run' ? (
            <LazyBoundary onFail={flushForReload}>
              <Suspense fallback={null}>
                <RunView code={planCode} />
              </Suspense>
            </LazyBoundary>
          ) : view === 'plan' ? (
            <LazyBoundary onFail={flushForReload}>
              <Suspense fallback={null}>
                <PlanView session={session} />
              </Suspense>
            </LazyBoundary>
          ) : view === 'both' ? (
            <Splitter ratio={ratio} onRatio={setRatio} left={doc} right={canvas} />
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
