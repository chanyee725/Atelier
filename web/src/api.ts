// Client for the E1 workspace API (docs/workspace-api.md).
// Node position overrides for a block (docs/design/block-drag-edit.md §2.1). Keys of `items` are node or empty-group names.
export type { BlockLayout } from '../../shared/render/block-layout.ts';
import type { BlockLayout } from '../../shared/render/block-layout.ts';
import type { BlockCode } from '../../shared/render/block-code.ts';
export type { BlockCode } from '../../shared/render/block-code.ts';
// Newest file format this web build understands; a 422 on a file above it means a newer app wrote it.
export const FILE_FORMAT_VERSION = 6;
// Pipeline steps (format v4). The web only carries it through saves for now; docs/workspace-api.md "Pipeline `plan`".
export type { Plan, PlanStep } from '../../shared/dispatch/plan.ts';
import type { UsageDay } from '../../shared/dispatch/types.ts';
import type { Plan } from '../../shared/dispatch/plan.ts';
import type { Discussion, Discussions } from '../../shared/dispatch/discussions.ts';
export type { Discussion, Discussions } from '../../shared/dispatch/discussions.ts';
export type Block = { id: string; type: string; code: string; x: number; y: number; w: number; h: number; layout?: BlockLayout; codeRefs?: BlockCode; frameId?: string };
export type DpxFile = {
  version: number;
  title: string;
  document: unknown;
  canvas: unknown;
  blocks: Block[];
  /** Present only in pipeline files. Saves send it back unchanged. */
  plan?: Plan;
  /** In-document questions (format v6, #738). Saves never send it: it changes only through the discussions API. */
  discussions?: Discussions;
  revision: number;
};
export type TreeNode =
  | { type: 'folder'; name: string; path: string; children: TreeNode[] }
  | { type: 'file'; name: string; path: string; title: string; revision: number | null; mtime?: string; created?: string; pipeline?: PipelineMark; questions?: number };
/** Tree mark of a pipeline file: draft (`plan`), a run in progress, the newest run stopped or failed (`paused`), or done. */
export type PipelineMark = { state: 'plan' | 'running' | 'paused' | 'done' };

/** Projects view (GET /api/workspace/projects, docs/workspace-api.md). Times are ISO strings. */
export type DocNode = {
  type: 'doc' | 'group';
  path: string;
  name: string;
  title?: string;
  revision?: number | null;
  /** Set on a pipeline file (E18). */
  pipeline?: PipelineMark;
  /** Open in-document questions (#738); absent when none. */
  questions?: number;
  created: string | null;
  modified: string | null;
  /** Documents below this one. */
  count: number;
  children: DocNode[];
};
export type Project = { path: string; name: string; icon: string | null; description: string; created: string | null; modified: string | null; count: number; docs: DocNode[] };
export type ProjectsView = { projects: Project[]; loose: DocNode[] };

/** Model connection summary for the sidebar (Dispatch routes; GET only, nothing here starts a CLI). */
export type DispatchStatus = { enabled: boolean; reason?: string; message?: string };
/** docs/design/model-connection-contract.md. installed null = not checked yet. Never carries an account name or token. */
export type ProviderState = {
  installed: boolean | null;
  connected: boolean;
  busy?: boolean;
  url?: string | null;
  error?: string | null;
  name?: string;
  /** `claude --version` first line. */
  cli?: string | null;
  /** The CLI itself is logged in on this machine (independent of the Atelier connection). */
  cliLoggedIn?: boolean;
  /** How the CLI is logged in, e.g. 구독 계정 (claude.ai). */
  method?: string | null;
  /** The CLI can log in with an API key (Codex). */
  keySupported?: boolean;
};
export type LimitWindow = { label: string; used: number | null; reset?: number | null };
export type ProviderLimits = {
  claude?: { windows: LimitWindow[] } | null;
  /** Fable's own weekly window; null until a Fable turn has reported it. */
  fable?: { windows: LimitWindow[] } | null;
  /** OpenAI Codex's own windows from its CLI's session log; null until Codex is connected and has run. */
  openai?: { windows: LimitWindow[]; plan?: string | null } | null;
  /** Gemini reports no windows, only that its quota was hit and when it clears. */
  gemini?: { reached: boolean; reset: number | null } | null;
};

export type ProviderInfo = { installed?: boolean | null; connected?: boolean; busy?: boolean; url?: string | null; error?: string | null };
export type DispatchSettings = { guard: { enabled: boolean; five: number; seven: number; fable?: number; /** Codex thresholds (#676). */ openai?: { five?: number; seven?: number } }; team: { ctxHandoff?: number; handoffMTokens?: number } & Record<string, unknown> };

export type VersionLabel = 'draft' | 'approved' | 'done';
export type HistoryEntry = { id: string; /** ms since epoch */ time: number; bytes: number; /** Pipeline milestones this version stands for (E28). */ labels?: VersionLabel[] };
export type TrashItem = { id: string; path: string; /** ms since epoch */ deletedAt: number; /** Deleted outside the app: restoring brings back the newest saved snapshot. */ fromSnapshot?: boolean };
export type HistoryVersion = DpxFile & { id: string; time: number };

/** GET /api/user-defaults (docs/design/user-defaults.md). Metadata only. */
export type UserDefaultsValues = {
  theme?: 'system' | 'light' | 'dark';
  workspace?: string;
  port?: number;
  prStatus?: boolean;
  workspaces?: { path: string; name: string }[];
  lastWorkspace?: string;
  /** User-set account label per provider id (#747), e.g. { claude: 'Max' }. A label only, never an email or account id. */
  accountLabels?: Record<string, string>;
};
export type UserDefaultsStatus = { file: string | null; values: UserDefaultsValues; error: string | null; problems: string[] };
export type UserDefaultsPatch = { theme?: 'system' | 'light' | 'dark' | null; workspace?: string | null; port?: number | null; prStatus?: boolean | null; accountLabels?: Record<string, string | null> };

export class ApiError extends Error {
  status: number;
  revision?: number;
  /** A stable reason the server gives for some errors (e.g. 'sessions_running'); branch on this, not the message. */
  code?: string;
  constructor(status: number, message: string, revision?: number, code?: string) {
    super(message);
    this.status = status;
    this.revision = revision;
    this.code = code;
  }
}

async function call<T>(method: string, url: string, body?: unknown, keepalive = false): Promise<T> {
  const res = await fetch(url, {
    method,
    keepalive,
    // Every non-GET /api request needs x-drawing: 1 (server/app.js); a cross-site page can't send it.
    headers: {
      // x-drawing-client: this page's own saves, so the server shows no outside-writer cursor for them (E520).
      ...(method === 'GET' ? {} : { 'x-drawing': '1', 'x-drawing-client': 'app' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.revision, typeof data.code === 'string' ? data.code : undefined);
  return data as T;
}

/** A window of lines from a git-tracked file (GET /api/code, docs/workspace-api.md "Code window"). */
export type CodeWindow = { path: string; start: number; end: number; total: number; lines: string[]; language: string; truncated?: boolean };

const q = (p: string) => `?path=${encodeURIComponent(p)}`;

/** GET /api/workspaces: paths are absolute; `missing` = the folder is gone from disk. */
export type WorkspaceFolders = {
  current: { path: string; name: string } | null;
  folders: { path: string; name: string; current: boolean; missing: boolean }[];
  switchable: boolean;
  error: string | null;
};
/** Sub-folder names of a folder on the server machine (GET /api/local-folders, E554). `parent` is null at the root. */
export type LocalFolders = { path: string; parent: string | null; home: string; root: string; sep: string; folders: string[]; truncated: boolean };

export const api = {
  /** `project`: the git project's folder name when the server sends it (#773); else the workspace folder's name. */
  info: () => call<{ workspace: string; mode?: 'drawing' | 'project'; project?: string | null }>('GET', '/api/info'),
  tree: () => call<{ tree: TreeNode[] }>('GET', '/api/tree').then((r) => r.tree),
  projects: () => call<ProjectsView>('GET', '/api/workspace/projects'),
  dispatch: () => call<DispatchStatus>('GET', '/api/dispatch'),
  providers: () => call<{ providers: Record<string, ProviderState> }>('GET', '/api/state').then((r) => r.providers ?? {}),
  limits: () => call<ProviderLimits>('GET', '/api/limits'),
  /** Settings dialog (E57): full provider status, Dispatch settings, connect/disconnect. Login runs the user's own CLI. */
  dispatchState: () => call<{ providers?: Record<string, ProviderInfo>; settings?: DispatchSettings; models?: { id: string; label?: string; provider?: string }[] }>('GET', '/api/state'),
  /** Daily cost and tokens per model and role from the run records (14 days, numbers only; #819 사용량 tab). */
  usage: () => call<{ days: UsageDay[] }>('GET', '/api/usage').then((r) => (Array.isArray(r.days) ? r.days : [])),
  providerLogin: (id: string) => call<{ ok: boolean; connected: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/login`, {}),
  providerCancel: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/cancel`, {}),
  /** Disconnects from Atelier only; the CLI's own login stays. */
  providerLogout: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/logout`, {}),
  /** Disconnect and also log the CLI itself out on this machine (`cli: true`, as in Dispatch). */
  providerCliLogout: (id: string) => call<{ ok: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/logout`, { cli: true }),
  /** The CLI's own API-key login: the server hands the key to the CLI on stdin. The web keeps no copy (no storage, no logs). */
  providerKey: (id: string, key: string) => call<{ ok: boolean; connected: boolean }>('POST', `/api/providers/${encodeURIComponent(id)}/key`, { key }),
  providerRefresh: () => call<Record<string, ProviderInfo>>('POST', '/api/providers/refresh', {}),
  saveDispatchSettings: (patch: { guard?: Partial<Omit<DispatchSettings["guard"], "fable" | "openai">> & { fable?: number | null; openai?: Record<string, number> }; team?: Partial<DispatchSettings['team']> }) =>
    call<DispatchSettings>('POST', '/api/settings', patch),
  /** The user's defaults in ~/.dispatch/drawing.json (E555): `error` is set when the file could not be read. */
  userDefaults: () => call<UserDefaultsStatus>('GET', '/api/user-defaults'),
  /** Saves some defaults; null clears one. 409 when the file is broken (it is never overwritten). */
  setUserDefaults: (patch: UserDefaultsPatch) => call<UserDefaultsStatus>('POST', '/api/user-defaults', patch),
  prTracking: () => call<{ on: boolean }>('GET', '/api/workspace/pr-tracking'),
  setPrTracking: (on: boolean) => call<{ on: boolean }>('POST', '/api/workspace/pr-tracking', { on }),
  /** Read only; `start`/`end` are 1-based and inclusive. */
  code: (path: string, start: number, end: number, signal?: AbortSignal) =>
    fetch(`/api/code${q(path)}&start=${start}&end=${end}`, { signal }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
      return data as CodeWindow;
    }),
  readFile: (path: string) => call<DpxFile>('GET', `/api/file${q(path)}`),
  /** `content`: starting document, canvas, blocks and plan (a template); defaults to an empty file. */
  createFile: (path: string, title: string, content?: Partial<Pick<DpxFile, 'document' | 'canvas' | 'blocks' | 'plan'>>) =>
    call<DpxFile>('POST', '/api/file', { ...content, path, title }),
  saveFile: (path: string, f: Pick<DpxFile, 'revision' | 'title' | 'document' | 'canvas' | 'blocks' | 'plan'>, keepalive = false) =>
    call<DpxFile>('PUT', `/api/file${q(path)}`, f, keepalive),
  /** `withSubdocs`: the document's sub-documents folder (`X/` next to `X.dpx.json`) goes to the trash with it. */
  removeFile: (path: string, withSubdocs = false) => call<unknown>('DELETE', `/api/file${q(path)}${withSubdocs ? '&withSubdocs=1' : ''}`),
  createFolder: (path: string) => call<unknown>('POST', '/api/folder', { path }),
  /** Folder picker for 새 프로젝트: no path = the server user's home folder. */
  localFolders: (path?: string) => call<LocalFolders>('GET', `/api/local-folders${path ? q(path) : ''}`),
  /** The workspace folders this server can switch between (E554); the open one has `current`. */
  workspaces: () => call<WorkspaceFolders>('GET', '/api/workspaces'),
  /** Adds a server folder to the list and switches the server to it. Reload the page afterwards. */
  addWorkspace: (path: string) => call<WorkspaceFolders>('POST', '/api/workspaces', { path }),
  /** Switches the server to a folder already in the list. Reload the page afterwards. */
  openWorkspace: (path: string) => call<WorkspaceFolders>('POST', '/api/workspaces/open', { path }),
  /** Takes a folder off the list; its files stay. */
  removeWorkspace: (path: string) => call<WorkspaceFolders>('DELETE', `/api/workspaces${q(path)}`),
  removeFolder: (path: string) => call<unknown>('DELETE', `/api/folder${q(path)}`),
  history: (path: string) => call<{ versions: HistoryEntry[] }>('GET', `/api/history${q(path)}`).then((r) => r.versions),
  historyVersion: (path: string, id: string) => call<HistoryVersion>('GET', `/api/history/version${q(path)}&id=${encodeURIComponent(id)}`),
  /** Keep the file as it is on disk now as a version (before a restore). */
  /** Answer an open question (#738): a picked choice or typed text. `delivered`: the asking session got it now. */
  answerQuestion: (path: string, id: string, answer: { choice: number } | { text: string }) =>
    call<{ path: string; revision: number; item: Discussion; delivered: boolean }>('POST', `/api/file/discussions/answer${q(path)}`, { id, ...answer }),
  historySnapshot: (path: string) => call<{ id: string | null }>('POST', `/api/history${q(path)}`, {}),
  trash: () => call<{ items: TrashItem[] }>('GET', '/api/trash').then((r) => r.items),
  restoreTrash: (id: string) => call<{ path: string }>('POST', '/api/trash/restore', { id }),
  /** `withSubdocs`: a document's sub-documents folder (`X/` next to `X.dpx.json`) moves along (type 'file' only). */
  move: (from: string, to: string, type: 'file' | 'folder', withSubdocs = false) =>
    call<unknown>('POST', '/api/move', withSubdocs ? { from, to, type, withSubdocs } : { from, to, type }),
};

// Project view: GET /api/workspace/projects (docs/workspace-api.md "Projects view"), mapped to the shapes the screens use.
type DocNodeDto = { type: 'doc' | 'group'; path: string; name: string; title?: string; created: string | null; modified: string | null; pipeline?: PipelineMark; children: DocNodeDto[] };
type ProjectDto = { path: string; name: string; icon: string | null; description: string; created: string | null; modified: string | null; count: number; docs: DocNodeDto[] };
export type ProjectDoc = {
  path: string;
  name: string;
  title: string;
  /** A folder without a same-named file: a parent without a document of its own. */
  bundle: boolean;
  /** ms since epoch (0 = unknown) */
  createdAt: number;
  modifiedAt: number;
  /** A plan document's state (계획 · 실행 중 · 멈춤 · 완료); absent for other documents. */
  plan?: PipelineMark['state'];
  children: ProjectDoc[];
};
export type ProjectInfo = {
  /** The project folder's path (its unique id). */
  id: string;
  path: string;
  name: string;
  icon: string;
  description: string;
  docCount: number;
  createdAt: number;
  modifiedAt: number;
  docs: ProjectDoc[];
};
export type ProjectsResponse = { projects: ProjectInfo[]; unfiled: ProjectDoc[] };
export type RecentFile = { path: string; title: string; project: string | null; parent: string | null; createdAt: number; modifiedAt: number };
const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
const toDoc = (n: DocNodeDto): ProjectDoc => ({
  path: n.path,
  name: n.name,
  title: n.title || n.name,
  bundle: n.type === 'group',
  createdAt: time(n.created),
  modifiedAt: time(n.modified),
  ...(n.pipeline ? { plan: n.pipeline.state } : {}),
  children: n.children.map(toDoc),
});
export const projectsApi = {
  /** Files with a run going now (GET /api/runs/active). */
  running: () => call<{ files: string[] }>('GET', '/api/runs/active').then((r) => r.files),
  projects: () =>
    call<{ projects: ProjectDto[]; loose: DocNodeDto[] }>('GET', '/api/workspace/projects').then(
      (r): ProjectsResponse => ({
        projects: r.projects.map((p) => ({
          id: p.path,
          path: p.path,
          name: p.name,
          icon: p.icon ?? [...p.name][0] ?? '',
          description: p.description,
          docCount: p.count,
          createdAt: time(p.created),
          modifiedAt: time(p.modified),
          docs: p.docs.map(toDoc),
        })),
        unfiled: r.loose.map(toDoc),
      }),
    ),
};
