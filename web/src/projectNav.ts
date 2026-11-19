// App shell navigation (design doc 6 §2.1, §5): which screen is shown, which sidebar rows are open, and the
// one-letter shortcuts. Pure, so it is tested without a browser.
import type { DocNode, Project, ProjectsView, TreeNode } from './api';

/** The main panel: a sidebar view, a project home, the 세션 보드 or the open document. 보관함 opens the trash dialog. */
export type Section = { kind: 'all' } | { kind: 'recent' } | { kind: 'project'; path: string } | { kind: 'doc' } | BoardSection;

/** 세션 보드 tabs (#731, docs/design/session-board-in-shell.md §1). */
export type BoardTab = 'sessions' | 'timeline' | 'usage';
/** The 세션 보드 in the shell. `folder`: undefined = 전체 프로젝트, null = 미분류, else a project folder path. */
export type BoardSection = { kind: 'board'; tab: BoardTab; folder?: string | null };
/** Something the board opens over itself once, from the address: the 상시 화면 or the 설정 dialog. */
export type BoardExtra = 'tv' | 'settings';
export type BoardRoute = BoardSection & { extra?: BoardExtra };

const BOARD_TABS: readonly string[] = ['sessions', 'timeline', 'usage'];
const BOARD_EXTRAS: readonly string[] = ['tv', 'settings'];

/** Reads `#board`, `#board=usage`, `#board=timeline&folder=<path>` (`folder=` empty = 미분류); null for any other hash. */
export function parseBoardHash(hash: string): BoardRoute | null {
  const parts = hash.replace(/^#/, '').split('&');
  const m = /^board(?:=(.*))?$/.exec(parts[0] ?? '');
  if (!m) return null;
  const v = m[1] ?? '';
  const out: BoardRoute = { kind: 'board', tab: BOARD_TABS.includes(v) ? (v as BoardTab) : 'sessions' };
  if (BOARD_EXTRAS.includes(v)) out.extra = v as BoardExtra;
  const folder = folderPart(parts.slice(1));
  if (folder !== undefined) out.folder = folder;
  return out;
}

/** The `folder=` piece of a hash's parts: undefined when absent, null when empty (미분류). */
function folderPart(parts: readonly string[]): string | null | undefined {
  const p = parts.find((x) => x === 'folder' || x.startsWith('folder='));
  if (p === undefined) return undefined;
  let f = '';
  try {
    f = decodeURIComponent(p.slice('folder='.length));
  } catch {
    /* unreadable: 미분류 */
  }
  return f === '' ? null : f;
}

/** The address of a board route; parseBoardHash reads it back. */
export function boardHash(r: { tab: BoardTab; folder?: string | null; extra?: BoardExtra }): string {
  const view = r.extra ?? (r.tab === 'sessions' ? '' : r.tab);
  const folder = r.folder === undefined ? '' : `&folder=${encodeURIComponent(r.folder ?? '')}`;
  return `#board${view ? `=${view}` : ''}${folder}`;
}

/** The board address for an old `/dispatch` hash (`#usage&folder=x`, `#folder=x`, `#tv`, `#settings`, `#timeline`). */
export function legacyBoardHash(hash: string): string {
  const own = parseBoardHash(hash);
  if (own) return boardHash(own);
  const parts = hash.replace(/^#/, '').split('&');
  const first = parts[0] ?? '';
  const view = first.includes('=') || first === 'folder' ? '' : first;
  const route: BoardRoute = { kind: 'board', tab: BOARD_TABS.includes(view) ? (view as BoardTab) : 'sessions' };
  if (BOARD_EXTRAS.includes(view)) route.extra = view as BoardExtra;
  const folder = folderPart(parts);
  if (folder !== undefined) route.folder = folder;
  return boardHash(route);
}

/** Project that holds `path` (a file path), or null for loose files. */
export function projectOf(view: ProjectsView | null, path: string | null): Project | null {
  if (!view || !path) return null;
  const top = path.split('/')[0];
  return path.includes('/') ? (view.projects.find((p) => p.path === top) ?? null) : null;
}

/** Rows to open so `path` is visible: its project and every document or group above it. */
export function openPathsFor(view: ProjectsView | null, path: string | null): string[] {
  const project = projectOf(view, path);
  if (!project || !path) return [];
  const out = [project.path];
  const walk = (nodes: DocNode[]): boolean => {
    for (const n of nodes) {
      if (n.path === path) return true;
      if (walk(n.children)) {
        out.push(n.path);
        return true;
      }
    }
    return false;
  };
  walk(project.docs);
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** One step of the open document's path (design doc 6 §2.4): its project, then the documents or groups above it. */
export type Crumb = { kind: 'project' | 'doc' | 'group'; path: string; label: string };

const docLabel = (n: DocNode) => (n.type === 'doc' && n.title) || n.name.replace(/\.dpx\.json$/, '');

/** The open document's node (its sub-documents) and the steps above it; node is null when the view does not have it yet. */
export function docPlace(view: ProjectsView | null, path: string | null): { trail: Crumb[]; node: DocNode | null } {
  if (!view || !path) return { trail: [], node: null };
  // A file opened right after it was made has no suffix in its path; the view's paths always have one.
  const want = subFolderOf(path);
  const project = projectOf(view, path);
  const trail: Crumb[] = project ? [{ kind: 'project', path: project.path, label: project.name }] : [];
  const walk = (nodes: DocNode[]): DocNode | null => {
    for (const n of nodes) {
      if (n.type === 'doc' && subFolderOf(n.path) === want) return n;
      trail.push({ kind: n.type, path: n.path, label: docLabel(n) });
      const hit = walk(n.children);
      if (hit) return hit;
      trail.pop();
    }
    return null;
  };
  const node = walk(project ? project.docs : view.loose);
  return { trail: node ? trail : project ? [trail[0]] : [], node };
}

/** The tree node the existing move / delete code works with. */
export function asTreeNode(n: DocNode | Project): TreeNode {
  if ('docs' in n || n.type === 'group') return { type: 'folder', name: baseName(n.path), path: n.path, children: [] };
  return { type: 'file', name: baseName(n.path), path: n.path, title: n.title ?? '', revision: n.revision ?? null };
}

/** Folder that holds a document's sub-documents (`a/X.dpx.json` → `a/X`). */
export const subFolderOf = (filePath: string) => filePath.replace(/\.dpx\.json$/, '');

/** Project the command menu is scoped to (its chip, its files first): the open file's project on the
 * document screen, the shown project on a project home, none elsewhere. Never a stale earlier one. */
export function paletteScope(section: Section, view: ProjectsView | null, openPath: string | null): { path: string; name: string } | null {
  const project =
    section.kind === 'doc' ? projectOf(view, openPath) : section.kind === 'project' ? (view?.projects.find((p) => p.path === section.path) ?? null) : null;
  if (project) return { path: project.path, name: project.name };
  return section.kind === 'project' ? { path: section.path, name: section.path } : null;
}

/** Folder new files go in: the project shown or the open file's project; '' = workspace root. */
export function newFileDir(section: Section, view: ProjectsView | null, openPath: string | null): string {
  if (section.kind === 'project') return section.path;
  if (section.kind === 'doc') return projectOf(view, openPath)?.path ?? '';
  return '';
}

export type ShellKey = 'all' | 'recent' | 'archive' | 'new' | 'board';
const KEYS: Record<string, ShellKey> = { KeyA: 'all', KeyR: 'recent', KeyB: 'archive', KeyN: 'new', KeyS: 'board' };

// Where one-letter keys belong to something else: text fields, the editors, the canvas (its tool keys) and dialogs.
const OWNED = '.ProseMirror, input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""], .excalidraw, dialog, [role="dialog"], [role="menu"], [role="listbox"]';

type KeyLike = { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean; defaultPrevented: boolean; target: EventTarget | null };

/** The shell action for a key press (A R B N S), or null when the key is not one or belongs to something else. */
export function shellKey(e: KeyLike): ShellKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.repeat || e.defaultPrevented) return null;
  const k = KEYS[e.code];
  if (!k) return null;
  const t = e.target as { closest?: (s: string) => unknown } | null;
  if (t && typeof t.closest === 'function' && t.closest(OWNED)) return null;
  return k;
}

/** "42%" from a 0..1 fraction; null when unknown. */
export const percent = (used: number | null | undefined) => (used == null || !Number.isFinite(used) ? null : Math.max(0, Math.min(100, Math.round(used * 100))));
/** Above this a usage figure turns to the warning colour (doc 6 §2.1). */
export const WARN_PERCENT = 75;

export type ModelLine = { id: string; name: string; installed: boolean | null; connected: boolean; pct: number | null; reached: boolean; busy?: boolean; /** The CLI's own https sign-in page while a login runs. */ url?: string | null; error?: string | null };
export type ModelTone = 'ok' | 'warn' | 'off';
/**
 * One sidebar model row: the short visible text next to the name (never colour alone, doc 6 §6) and the dot tone
 * (--ok, --warn, --muted-foreground). `enabled` false: pipelines are off on this server, so every model reads 연결 안 됨 (text, not colour alone).
 */
export function modelStatus(m: ModelLine, enabled: boolean): { text: string; long: string; tone: ModelTone } {
  if (!enabled) return { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' };
  if (m.busy && !m.connected) return { text: '연결 중', long: '연결하는 중', tone: 'off' };
  if (!m.connected) return { text: '연결 안 됨', long: '연결 안 됨', tone: 'off' };
  if (m.reached) return { text: '한도 도달', long: '사용 한도 도달', tone: 'warn' };
  if (m.pct == null) return { text: '연결됨', long: '연결됨', tone: 'ok' };
  return { text: `${m.pct}%`, long: `연결됨, 5시간 한도 ${m.pct}% 사용`, tone: m.pct > WARN_PERCENT ? 'warn' : 'ok' };
}
