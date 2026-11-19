// Workspace module: HTTP API over the file store + SSE "workspace" events for outside changes.
import { createStore, StoreError } from './store.js';
import { RESERVED_PROJECT_NAMES } from './paths.js';
import { listProjects } from './projects.js';
import { listLocalFolders } from './local-folders.js';
import { cleanSessionLabel, projectOf, sessionIdOf } from '../cursor/presence.js';
import { addQuestion, answerQuestion } from './discussion-ops.js';
import { USER } from '../../shared/dispatch/discussions.ts';
// The PR/CI switch lives with the Dispatch PR tracker (it reads the same settings.json), so the route reuses it.
import { readPrTracking, setPrTracking } from '../dispatch/pr-status.js';

const SETTINGS_BROKEN = '설정 파일을 읽을 수 없어요. 파일을 확인해 주세요.';
const MAX_BODY = 20 * 1024 * 1024;

async function readJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) throw new StoreError(415, 'content-type must be application/json');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StoreError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new StoreError(400, 'invalid JSON');
  }
}

// Filesystem errors that mean "your request does not fit the current tree" are client errors.
// Never forward err.message: it contains absolute paths.
const FS_CLIENT_ERRORS = {
  ENOTDIR: [400, 'a parent in the path is not a folder'],
  EISDIR: [400, 'path is a folder'],
  ENAMETOOLONG: [400, 'name too long'],
  EEXIST: [409, 'already exists'],
  ENOTEMPTY: [409, 'folder is not empty'],
};
function toStoreError(err) {
  if (err instanceof StoreError) return err;
  const hit = FS_CLIENT_ERRORS[err?.code];
  return hit ? new StoreError(hit[0], hit[1]) : err;
}

export async function setup(ctx) {
  if (!ctx.workspaceDir) return {};
  // In-process listeners for content changes of a file (API saves, plan patches, outside edits); the live agent
  // cursor (server/cursor/) diffs them. SSE clients still get only what they got before.
  const changeListeners = new Set();
  const changed = (path, opts) => {
    for (const fn of changeListeners) fn(path, opts);
  };
  const store = createStore(ctx.workspaceDir, {
    // Project mode keeps agent git worktrees in <project>/.atelier/worktrees (#782): never documents, never watched.
    reserved: ctx.projectMode ? RESERVED_PROJECT_NAMES : [],
    onExternalChange: ({ catchUp, ...e }) => {
      ctx.hub.broadcast('workspace', e);
      if (e.kind === 'change' || e.kind === 'create') changed(e.path, { catchUp: catchUp === true });
    },
  });
  await store.startWatching();

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const route = (method, path, fn, okStatus = 200) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const body = method === 'GET' || method === 'DELETE' ? null : await readJson(req);
        // x-drawing-session: the writing session's id (`$DRAWING_SESSION`, #656), or an outside writer's own name for
        // its cursor label (E528 #592; cleaned). Memory only.
        const head = req.headers['x-drawing-session'];
        const sid = sessionIdOf(head);
        const from = { app: req.headers['x-drawing-client'] === 'app', sid, writer: sid ? null : cleanSessionLabel(head) };
        send(res, okStatus, await fn(url.searchParams.get('path'), body, url.searchParams, from));
      } catch (e) {
        const err = toStoreError(e);
        if (!(err instanceof StoreError)) throw err;
        const out = { error: err.message };
        if (err.revision !== undefined) out.revision = err.revision;
        send(res, err.status, out);
      }
    },
  });
  const need = (v, name) => {
    if (typeof v !== 'string') throw new StoreError(400, `${name} is required`);
    return v;
  };

  // Agent sessions live in the dispatch module (set up after this one; off outside a git project).
  const hub = () => ctx.modules.dispatch?.hub ?? null;
  const sessionOf = (sid) => (sid && hub()?.get(sid)) || null;
  // The answer goes to the asking session by name (only names are stored). False when it is gone or refuses a message now.
  const deliverAnswer = (path, item) => {
    const h = hub();
    const s = h?.sessions?.find((x) => x.name === item.askedBy);
    if (!s) return false;
    const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
    try {
      h.send(s.id, `[문서 질문 답변] ${path}의 질문 ${item.id} "${clip(item.question, 200)}"에 사용자가 답했어요: ${item.answer}`);
      return true;
    } catch {
      return false; // e.g. a running Codex turn or the usage guard; the answer stays readable in the document
    }
  };
  const announce = (r, from) => {
    ctx.hub.broadcast('workspace', { kind: 'change', path: r.path, revision: r.revision });
    changed(r.path, { sid: from.sid, writer: from.writer });
  };

  return {
    store,
    /** fn(path, { catchUp, app, sid, writer }) on each content change of a file (catchUp: found after the watcher restarted); returns an unsubscribe function. */
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    close: () => store.close(),
    routes: [
      route('GET', '/api/tree', async () => ({ tree: await store.tree() })),
      // Projects view (top-level folders, nested sub-documents). Not /api/projects: Dispatch owns that path.
      route('GET', '/api/workspace/projects', () => listProjects(store)),
      // Folder picker for 폴더 열기 (E554): sub-folder names of a folder on the server machine, read-only.
      route('GET', '/api/local-folders', (p) => listLocalFolders(p)),
      // Per-workspace PR/CI tracking switch (E57 settings dialog); stored in <workspace>/.drawing/settings.json.
      route('GET', '/api/workspace/pr-tracking', async () => {
        try {
          const ud = ctx.modules.userDefaults?.defaults;
          return { on: await readPrTracking(ctx.workspaceDir, (ud ? (await ud.current()).prStatus : undefined) ?? true) };
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
      }),
      route('POST', '/api/workspace/pr-tracking', async (_p, b) => {
        if (typeof b?.on !== 'boolean') throw new StoreError(400, 'on must be true or false');
        try {
          await setPrTracking(ctx.workspaceDir, b.on);
        } catch (e) {
          if (e?.code === 'ESETTINGS') throw new StoreError(409, SETTINGS_BROKEN);
          throw e;
        }
        return { on: b.on };
      }),
      route('GET', '/api/file', (p) => store.readFile(need(p, 'path'))),
      route('PUT', '/api/file', async (p, b, _sp, from) => {
        const r = await store.writeFile(need(p, 'path'), b);
        // Same as the plan patch: the store knows its own writes, so tell open tabs. A tab that saved this revision
        // itself ignores the echo (it only reloads a strictly newer revision).
        ctx.hub.broadcast('workspace', { kind: 'change', path: r.path, revision: r.revision });
        changed(r.path, { app: from.app, sid: from.sid, writer: from.writer });
        return r;
      }),
      route('POST', '/api/file', async (_p, b, _sp, from) => {
        const r = await store.createFile(need(b?.path, 'path'), b);
        // The store knows its own writes, so the watcher stays quiet: tell the open tabs the tree grew.
        ctx.hub.broadcast('workspace', { kind: 'tree', path: r.path });
        changed(r.path, { app: from.app, sid: from.sid, writer: from.writer });
        return r;
      }, 201),
      // Step-level plan edit (agents): re-read under the store lock, then announced like an outside change so an
      // open, clean tab reloads and a dirty one gets the 409 choice on its next save.
      route('PATCH', '/api/file/plan', async (p, b, _sp, from) => {
        const r = await store.patchPlan(need(p, 'path'), b);
        ctx.hub.broadcast('workspace', { kind: 'change', path: r.path, revision: r.revision });
        changed(r.path, { sid: from.sid, writer: from.writer });
        return r;
      }),
      // In-document questions (#738). An agent asks (its session name is stored, from x-drawing-session); the user
      // answers (a choice or text) and the answer is sent to the asking session.
      route('GET', '/api/file/discussions', async (p) => {
        const f = await store.readFile(need(p, 'path'));
        return { path: f.path, revision: f.revision, discussions: f.discussions ?? null };
      }),
      route('POST', '/api/file/discussions', async (p, b, _sp, from) => {
        const askedBy = sessionOf(from.sid)?.name ?? (from.sid ? null : from.writer);
        if (!askedBy) throw new StoreError(400, '질문한 세션을 알 수 없어요 (x-drawing-session 헤더가 필요해요)');
        const r = await store.patchDiscussions(need(p, 'path'), (d) => addQuestion(d, b, askedBy));
        announce(r, from);
        return r;
      }, 201),
      route('POST', '/api/file/discussions/answer', async (p, b, _sp, from) => {
        const answeredBy = sessionOf(from.sid)?.name ?? USER;
        const r = await store.patchDiscussions(need(p, 'path'), (d) => answerQuestion(d, b, answeredBy));
        announce(r, from);
        return { ...r, delivered: deliverAnswer(r.path, r.item) };
      }),
      // Open question counts per document and per project (top folder) for the sidebar badges.
      route('GET', '/api/discussions/open', async () => {
        const files = [];
        const visit = (rows) => {
          for (const r of rows) {
            if (r.type === 'folder') visit(r.children);
            else if (r.questions) files.push({ path: r.path, title: r.title, open: r.questions });
          }
        };
        visit(await store.tree());
        const projects = {};
        for (const f of files) {
          const k = projectOf(f.path) ?? '';
          projects[k] = (projects[k] ?? 0) + f.open;
        }
        return { total: files.reduce((n, f) => n + f.open, 0), files, projects };
      }),
      // withSubdocs=1: the document's sub-documents folder goes to the trash with it.
      route('DELETE', '/api/file', (p, _b, sp) => store.removeFile(need(p, 'path'), { withSubdocs: sp.get('withSubdocs') === '1' })),
      route('POST', '/api/folder', (_p, b) => store.createFolder(need(b?.path, 'path')), 201),
      route('DELETE', '/api/folder', (p) => store.removeFolder(need(p, 'path'))),
      // Deleted files stay here for 30 days; restore puts one back at its old path (409 if the path is taken).
      route('GET', '/api/trash', () => store.trash()),
      route('POST', '/api/trash/restore', (_p, b) => store.restoreTrash(need(b?.id, 'id'))),
      route('GET', '/api/history', (p) => store.history(need(p, 'path'))),
      route('GET', '/api/history/version', (p, _b, q) => store.historyVersion(need(p, 'path'), q.get('id'))),
      // Snapshot the file as it is on disk now (before a restore); ignores the 5-minute interval.
      route('POST', '/api/history', (p) => store.historySnapshotNow(need(p, 'path'))),
      // body: {from, to, type?: 'file'|'folder', withSubdocs?: true}; without type a file wins over a same-named folder.
      // withSubdocs (type 'file' only): the document's sub-documents folder (`X/` next to `X.dpx.json`) moves along.
      route('POST', '/api/move', (_p, b) => store.move(need(b?.from, 'from'), need(b?.to, 'to'), b?.type, { withSubdocs: b?.withSubdocs === true })),
    ],
  };
}
