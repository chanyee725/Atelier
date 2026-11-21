// Workspace file store: one `*.dpx.json` per diagram file, sub-folders = folders.
// Writes are atomic (temp file in the same dir + rename) and serialized; stale writes are refused by revision.
// The sections live in store-<name>.js (history, runs, trash, tree); each gets the shared context `c`.
import { lstatSync, readdirSync, watch } from 'node:fs';
import { pollWatch } from './poll-watch.js';
import { link, mkdir, readdir, readFile, rename, rm, rmdir, lstat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createResolver, parseWorkspacePath, PathError } from './paths.js';
import { FILE_EXT, FORMAT_VERSION, newFile, normalizeContent, parseStored, ValidationError } from './model.js';
import { applyPlanOps } from './plan-ops.js';
import { PLAN_VERSION } from '../../shared/dispatch/plan.ts';
import { DISCUSSIONS_VERSION } from '../../shared/dispatch/discussions.ts';
import { StoreError, sha, MAX_TOMBSTONES, isDpx, HISTORY_INTERVAL_MS, HISTORY_MAX } from './store-shared.js';
import { createHistory } from './store-history.js';
import { createRunsSidecar } from './store-runs.js';
import { createTrash } from './store-trash.js';
import { createTree } from './store-tree.js';

export { StoreError, HISTORY_DIR, HISTORY_INTERVAL_MS, HISTORY_MAX, VERSION_LABELS, TRASH_DIR, TRASH_DAYS, TRASH_MAX, RUNS_DIR } from './store-shared.js';

// Normal runs use the real recursive fs.watch. Only the test harness sets DRAW_WORKSPACE_WATCH=poll (no inotify instance per server).
export function pickWatchFn(env = process.env) {
  return env.DRAW_WORKSPACE_WATCH === 'poll' ? pollWatch : watch;
}

export function createStore(
  workspaceDir,
  { onExternalChange, watchDebounceMs = 60, watchRestartMs = 1000, watchFn = pickWatchFn(), now = Date.now, historyIntervalMs = HISTORY_INTERVAL_MS, historyMax = HISTORY_MAX, reserved = [] } = {},
) {
  // reserved: top-level names that are never documents (project mode: `worktrees`, #782); not listed, watched or written.
  const fsr = createResolver(workspaceDir, { reserved });
  const parseRelPath = (rel) => parseWorkspacePath(rel, reserved);
  const skip = (e, relDir) => e.name.startsWith('.') || e.isSymbolicLink() || (!relDir && reserved.includes(e.name));
  const known = new Map(); // rel file path -> { hash, revision } of the content we last wrote or saw
  const knownDirs = new Set();
  // rel file path -> last revision seen before the file was deleted or moved away, so a file that
  // reappears at that path starts above it and clients holding the old revision get 409.
  const tombstones = new Map();
  let queue = Promise.resolve();
  let watcher = null;
  const timers = new Map();
  // Listeners told when a file's sidecars (history, runs) move: {kind:'move', from, to} | {kind:'trash', path, trashId}
  // | {kind:'restore', path, trashId}. Called inside the serial queue, so they see a settled tree.
  const sidecarListeners = new Set();
  const sidecarEvent = (e) => {
    for (const fn of sidecarListeners) {
      try {
        fn(e);
      } catch {}
    }
  };

  // Serialize every mutation so revision check + rename is one step.
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const wrapPath = async (rel) => {
    try {
      return await fsr.resolve(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };

  const fileRel = (rel) => {
    parseRelPath(rel);
    if (isDpx(rel)) return rel;
    // A typed `.dpx` suffix is dropped like in the web UI: `demo.dpx` is the file `demo.dpx.json`, not `demo.dpx.dpx.json`.
    const stem = rel.replace(/\.dpx$/i, '');
    return (stem === '' || stem.endsWith('/') ? rel : stem) + FILE_EXT;
  };
  // A folder named like a file (`x.dpx.json/`) would be confused with a file, so no path may contain one.
  const checkFolderNames = (segs) => {
    if (segs.some(isDpx)) throw new StoreError(400, `folder names cannot end with ${FILE_EXT}`);
  };
  const checkedFileRel = (rel) => {
    try {
      return fileRel(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };

  async function atomicWrite(abs, text, { exclusive = false } = {}) {
    const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(tmp, text, { mode: 0o644 });
    try {
      if (exclusive) await link(tmp, abs); // fails with EEXIST instead of overwriting
      else await rename(tmp, abs);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      if (err.code === 'EEXIST') throw new StoreError(409, 'already exists');
      throw err;
    }
    if (exclusive) await unlink(tmp).catch(() => {});
  }

  async function statOrNull(abs) {
    try {
      return await lstat(abs);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // A file where a folder is needed (ENOTDIR deeper down, EEXIST for the last one) is a clash the caller can fix: 409.
  const asParentClash = (err) => {
    if (err?.code === 'ENOTDIR' || err?.code === 'EEXIST') return new StoreError(409, 'a parent in the path is a file');
    return err;
  };
  async function ensureDir(dir) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      throw asParentClash(err);
    }
  }
  const ensureParent = (abs) => ensureDir(dirname(abs));

  async function loadStored(abs) {
    let text;
    try {
      text = await readFile(abs, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'file not found');
      if (err.code === 'EISDIR') throw new StoreError(400, 'not a file');
      throw err;
    }
    try {
      return { text, file: parseStored(text) };
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(422, `unreadable file: ${err.message}`);
      throw err;
    }
  }

  const serialize = (file) => JSON.stringify(file, null, 2) + '\n';

  // Moved sections, called through the shared context.
  const collectFiles = (...a) => c.collectFiles(...a); // store-trash.js
  const dropHistory = (...a) => c.dropHistory(...a); // store-history.js
  const markBorn = (...a) => c.markBorn(...a); // store-history.js
  const moveHistory = (...a) => c.moveHistory(...a); // store-history.js
  const snapshotQuietly = (...a) => c.snapshotQuietly(...a); // store-history.js
  const trashMany = (...a) => c.trashMany(...a); // store-trash.js
  const trashQuietly = (...a) => c.trashQuietly(...a); // store-trash.js

  // ---- file operations ----
  // `body` may carry starting content (document, canvas, blocks, plan), e.g. a pipeline template; it is checked like a save.
  async function createFile(rel, body = {}) {
    rel = checkedFileRel(rel);
    checkFolderNames(rel.split('/').slice(0, -1));
    const abs = await wrapPath(rel).catch((err) => {
      throw asParentClash(err);
    });
    const { title } = body ?? {};
    let fresh = newFile({ title: typeof title === 'string' ? title : basename(rel, FILE_EXT) });
    const { document, canvas, blocks, plan } = body ?? {};
    if (document !== undefined || canvas !== undefined || blocks !== undefined || plan !== undefined) {
      try {
        fresh = { ...normalizeContent({ title: fresh.title, document, canvas, blocks, plan }), revision: fresh.revision };
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(400, err.message);
        throw err;
      }
    }
    return serial(async () => {
      await ensureParent(abs);
      const file = { ...fresh, revision: Math.max(fresh.revision, (tombstones.get(rel) ?? 0) + 1) };
      const text = serialize(file);
      await atomicWrite(abs, text, { exclusive: true });
      known.set(rel, { hash: sha(text), revision: file.revision });
      tombstones.delete(rel);
      // The file's own write time, so `created` never comes after its first `mtime`.
      await markBorn(rel, Math.floor((await statOrNull(abs).catch(() => null))?.mtimeMs ?? now()));
      return { path: rel, ...file };
    });
  }

  async function readFileAt(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { file } = await syncExternal(rel, await loadStored(abs), abs);
      return { path: rel, ...file };
    });
  }

  // Cheap check that a document is still in the workspace (not trashed or deleted), without reading it.
  async function fileExists(rel) {
    try {
      return !!(await statOrNull(await wrapPath(checkedFileRel(rel))))?.isFile();
    } catch {
      return false;
    }
  }

  // If the file was edited outside without raising its revision, raise it here so a client that
  // loaded the old content cannot overwrite the outside edit with a "current" revision.
  async function syncExternal(rel, loaded, abs) {
    const k = known.get(rel) ?? (tombstones.has(rel) ? { hash: null, revision: tombstones.get(rel) } : null);
    const h = sha(loaded.text);
    if (!k || k.hash === h) return loaded;
    // A newer format than this server knows is read-only: rewriting it would store it back as ours.
    if (loaded.file.version > FORMAT_VERSION) return loaded;
    let file = loaded.file;
    let text = loaded.text;
    if (file.revision <= k.revision) {
      file = { ...file, revision: k.revision + 1 };
      text = serialize(file);
      await atomicWrite(abs, text);
    }
    known.set(rel, { hash: sha(text), revision: file.revision });
    tombstones.delete(rel);
    return { text, file };
  }

  async function writeFileAt(rel, body) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    const base = body?.revision;
    if (!Number.isInteger(base) || base < 1) throw new StoreError(400, 'revision (the revision you loaded) is required');
    let content;
    try {
      content = normalizeContent(body);
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(400, err.message);
      throw err;
    }
    return serial(async () => {
      const { file: current, text: before } = await syncExternal(rel, await loadStored(abs), abs);
      // A newer format than this server knows: writing would store it back as ours and drop what it added.
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      if (current.revision !== base) {
        throw new StoreError(409, 'stale write', { revision: current.revision });
      }
      // Questions change only through /api/file/discussions: a save keeps what is on disk, so a tab that loaded the
      // file before an agent asked does not drop the question (#738).
      const { discussions: _sent, ...rest } = content;
      const next = { ...rest, ...(current.discussions ? { discussions: current.discussions } : {}), revision: current.revision + 1 };
      const text = serialize(next);
      // Keep what is on disk before overwriting it, so the end state of an edit session stays reachable.
      await snapshotQuietly(rel, before);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: next.revision });
      return { path: rel, revision: next.revision };
    });
  }

  // Agents change the plan without holding the whole file: step-level ops applied to what is on disk now, under
  // the same lock as saves. `revision` is optional; when given, a stale one gets 409 like a save.
  async function patchPlanAt(rel, body) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    const base = body?.revision;
    if (base !== undefined && (!Number.isInteger(base) || base < 1)) throw new StoreError(400, 'revision must be an integer >= 1');
    if (!Array.isArray(body?.ops) || body.ops.length === 0) throw new StoreError(400, 'ops must be a non-empty array');
    return serial(async () => {
      const { file: current, text: before } = await syncExternal(rel, await loadStored(abs), abs);
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      if (base !== undefined && current.revision !== base) throw new StoreError(409, 'stale write', { revision: current.revision });
      if (current.plan && current.plan.v > PLAN_VERSION) throw new StoreError(422, '더 새 버전에서 만든 계획이라 바꾸지 않았어요');
      let next;
      try {
        const plan = applyPlanOps(current.plan, body.ops);
        next = { ...normalizeContent({ ...current, plan }), revision: current.revision + 1 };
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(400, err.message);
        throw err;
      }
      const text = serialize(next);
      await snapshotQuietly(rel, before);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: next.revision });
      return { path: rel, revision: next.revision, plan: next.plan ?? null };
    });
  }

  /**
   * Question / answer edit (#738): `change(discussions)` (undefined when the file has none) returns
   * { discussions, item }, applied to what is on disk now under the save lock. Returns the changed item.
   */
  async function patchDiscussionsAt(rel, change) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { file: current, text: before } = await syncExternal(rel, await loadStored(abs), abs);
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      if (current.discussions && current.discussions.v > DISCUSSIONS_VERSION) throw new StoreError(422, '더 새 버전에서 만든 질문이라 바꾸지 않았어요');
      let next;
      let item;
      try {
        const r = change(current.discussions);
        item = r.item;
        next = { ...normalizeContent({ ...current, discussions: r.discussions }), revision: current.revision + 1 };
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(400, err.message);
        throw err;
      }
      const text = serialize(next);
      await snapshotQuietly(rel, before);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: next.revision });
      return { path: rel, revision: next.revision, item };
    });
  }

  /**
   * The server's own document edit (E28: the 완료 summary block): `edit(document)` returns the new document, applied
   * to what is on disk now under the save lock. Open tabs see a newer revision like any outside change.
   */
  async function editDocumentAt(rel, edit) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { file: current, text: before } = await syncExternal(rel, await loadStored(abs), abs);
      if (current.version > FORMAT_VERSION) throw new StoreError(422, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
      let next;
      try {
        next = { ...normalizeContent({ ...current, document: edit(current.document) }), revision: current.revision + 1 };
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(400, err.message);
        throw err;
      }
      const text = serialize(next);
      await snapshotQuietly(rel, before);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: next.revision });
      return { path: rel, revision: next.revision };
    });
  }

  async function createFolder(rel) {
    parseOrThrow(rel);
    checkFolderNames(rel.split('/'));
    const abs = await wrapPath(rel);
    return serial(async () => {
      if (await statOrNull(abs)) throw new StoreError(409, 'already exists');
      await mkdir(abs, { recursive: true });
      knownDirs.add(rel);
      // Announced like any other tree change, so other tabs list the new project without a reload.
      onExternalChange?.({ kind: 'tree', path: rel });
      return { path: rel };
    });
  }

  function parseOrThrow(rel) {
    try {
      parseRelPath(rel);
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  }

  /**
   * Rename and move are the same operation: `to` is the full new path.
   * `type` is 'file' | 'folder'. Without it a file wins: `from` is tried as a file
   * (extension optional) first, then as a folder.
   */
  async function move(from, to, type, { withSubdocs = false } = {}) {
    parseOrThrow(from);
    parseOrThrow(to);
    if (type !== undefined && type !== 'file' && type !== 'folder') throw new StoreError(400, 'type must be "file" or "folder"');
    if (withSubdocs) {
      if (type !== 'file') throw new StoreError(400, 'withSubdocs needs type "file"');
      return serial(() => moveWithSubdocs(from, to));
    }
    return serial(async () => {
      if (type !== 'folder') {
        const fileFrom = checkedFileRel(from);
        const fromAbs = await wrapPath(fileFrom);
        const st = await statOrNull(fromAbs);
        if (st?.isFile()) return moved(from, await moveFile(fileFrom, fromAbs, checkedFileRel(to)));
        if (type === 'file') throw new StoreError(404, 'not found');
      }
      const fromAbs = await wrapPath(from);
      const st = await statOrNull(fromAbs);
      if (!st?.isDirectory()) throw new StoreError(404, 'not found');
      return moved(from, await moveFolder(from, fromAbs, to));
    });
  }

  // A document and its sub-documents folder (`X/` next to `X.dpx.json`) move as one: both targets are checked
  // before anything moves, and the file goes back if the folder move still fails.
  async function moveWithSubdocs(from, to) {
    const fileFrom = checkedFileRel(from);
    const fileTo = checkedFileRel(to);
    const fromAbs = await wrapPath(fileFrom);
    if (!(await statOrNull(fromAbs))?.isFile()) throw new StoreError(404, 'not found');
    const subFrom = fileFrom.slice(0, -FILE_EXT.length);
    const subTo = fileTo.slice(0, -FILE_EXT.length);
    const subAbs = await wrapPath(subFrom);
    const hasSub = (await statOrNull(subAbs))?.isDirectory();
    if (hasSub && (subTo === subFrom || subTo.startsWith(subFrom + '/'))) throw new StoreError(400, 'cannot move a folder into itself');
    // A folder already named like the new document would become its sub-documents (an unrelated group taken over),
    // so the move is refused even when the document has no sub-documents of its own.
    const subToAbs = await wrapPath(subTo).catch((err) => {
      throw asParentClash(err);
    });
    if (await statOrNull(subToAbs).catch((err) => Promise.reject(asParentClash(err)))) throw new StoreError(409, 'target already exists');
    if (!hasSub) return moved(from, await moveFile(fileFrom, fromAbs, fileTo));
    checkFolderNames(subTo.split('/'));
    const result = await moveFile(fileFrom, fromAbs, fileTo);
    try {
      await moveFolder(subFrom, subAbs, subTo);
    } catch (err) {
      await moveFile(fileTo, await wrapPath(fileTo), fileFrom).catch(() => {});
      throw err;
    }
    moved(subFrom, { path: subTo });
    return moved(from, result);
  }

  // A move or rename through the API tells other tabs where the thing went; `from` is the path as the caller wrote it.
  function moved(from, result) {
    onExternalChange?.({ kind: 'tree', path: result.path, from });
    return result;
  }

  async function moveFile(from, fromAbs, toRel) {
    checkFolderNames(toRel.split('/').slice(0, -1));
    const toAbs = await wrapPath(toRel).catch((err) => {
      throw asParentClash(err);
    });
    if (await statOrNull(toAbs).catch((err) => Promise.reject(asParentClash(err)))) throw new StoreError(409, 'target already exists');
    await ensureDir(dirname(toAbs));
    await rename(fromAbs, toAbs);
    forget(from, false);
    await adopt(toRel, toAbs);
    await moveHistory(from, toRel);
    return { path: toRel };
  }

  async function moveFolder(from, fromAbs, toRel) {
    checkFolderNames(toRel.split('/'));
    if (toRel === from || toRel.startsWith(from + '/')) throw new StoreError(400, 'cannot move a folder into itself');
    const toAbs = await wrapPath(toRel).catch((err) => {
      throw asParentClash(err);
    });
    if (await statOrNull(toAbs).catch((err) => Promise.reject(asParentClash(err)))) throw new StoreError(409, 'target already exists');
    await ensureDir(dirname(toAbs));
    await rename(fromAbs, toAbs);
    forget(from, true);
    knownDirs.add(toRel);
    await scan(toAbs, toRel);
    await moveHistory(from, toRel);
    return { path: toRel };
  }

  async function knownEntry(abs) {
    const text = await readFile(abs, 'utf8');
    let revision = 0;
    try {
      revision = parseStored(text).revision;
    } catch {}
    return { hash: sha(text), revision };
  }

  // Record a file that arrived at `rel` by a move; raise its revision above a tombstone there.
  async function adopt(rel, abs) {
    const entry = await knownEntry(abs);
    const floor = tombstones.get(rel);
    if (floor !== undefined && entry.revision > 0 && entry.revision <= floor) {
      const file = { ...parseStored(await readFile(abs, 'utf8')), revision: floor + 1 };
      const text = serialize(file);
      await atomicWrite(abs, text);
      known.set(rel, { hash: sha(text), revision: file.revision });
    } else {
      known.set(rel, floor !== undefined && entry.revision === 0 ? { ...entry, revision: floor } : entry);
    }
    tombstones.delete(rel);
  }

  // Remove the empty folders under (and including) absDir, deepest first; anything still holding a file stays.
  // Returns the rel paths of the folders it removed. Symlinks are never followed.
  async function pruneEmptyDirs(absDir, relDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const removed = [];
    for (const e of entries) if (e.isDirectory()) removed.push(...(await pruneEmptyDirs(join(absDir, e.name), `${relDir}/${e.name}`)));
    if (await rmdir(absDir).then(() => true, () => false)) removed.push(relDir); // fails (ENOTEMPTY) when something stays
    return removed;
  }

  // withSubdocs: the document's sub-documents (`.dpx.json` files under `X/`, next to `X.dpx.json`) go to the trash
  // with it. Only those files are removed: anything else under X/ (notes, images, hidden files) cannot be kept in
  // the trash, so it stays where it is, with the folders that hold it. Folders left empty are removed.
  async function removeFile(rel, { withSubdocs = false } = {}) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    const subRel = rel.slice(0, -FILE_EXT.length);
    const subAbs = withSubdocs ? await wrapPath(subRel) : null;
    return serial(async () => {
      const st = await statOrNull(abs);
      if (!st?.isFile()) throw new StoreError(404, 'file not found');
      const text = await readFile(abs, 'utf8').catch(() => null);
      const sub = subAbs && (await statOrNull(subAbs))?.isDirectory() ? await collectFiles(subAbs, subRel) : null;
      await unlink(abs);
      forget(rel, false);
      if (sub) {
        for (const f of sub) {
          await unlink(join(subAbs, f.rel.slice(subRel.length + 1)));
          forget(f.rel, false);
        }
        for (const d of await pruneEmptyDirs(subAbs, subRel)) knownDirs.delete(d);
        await trashMany([[rel, text], ...sub.map((f) => [f.rel, f.text])]);
        for (const f of sub) await dropHistory(f.rel);
      } else await trashQuietly(rel, text);
      onExternalChange?.({ kind: 'delete', path: rel }); // other tabs learn about it (our own saves stay silent)
      if (sub) onExternalChange?.({ kind: 'tree', path: subRel, from: subRel });
      return { path: rel };
    });
  }

  async function removeFolder(rel) {
    parseOrThrow(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const st = await statOrNull(abs);
      if (!st?.isDirectory()) throw new StoreError(404, 'folder not found');
      const files = await collectFiles(abs, rel);
      await rm(abs, { recursive: true });
      forget(rel, true);
      await trashMany(files.map((f) => [f.rel, f.text]));
      await dropHistory(rel); // what is left belongs to files that were already gone
      // `from`: other tabs with a file under this folder open must close it (same shape as a folder move).
      onExternalChange?.({ kind: 'tree', path: rel, from: rel });
      return { path: rel };
    });
  }

  function forget(rel, isDir) {
    const bury = (k) => {
      const e = known.get(k);
      if (!e) return;
      const floor = Math.max(e.revision, tombstones.get(k) ?? 0);
      tombstones.delete(k); // re-insert so the newest burials are the last to go
      tombstones.set(k, floor);
      // Bounded: only the most recent deletions keep a revision floor.
      if (tombstones.size > MAX_TOMBSTONES) tombstones.delete(tombstones.keys().next().value);
      known.delete(k);
    };
    if (!isDir) return void bury(rel);
    knownDirs.delete(rel);
    for (const k of [...known.keys()]) if (k.startsWith(rel + '/')) bury(k);
    for (const k of [...knownDirs]) if (k.startsWith(rel + '/')) knownDirs.delete(k);
  }

  // ---- watching ----
  async function scan(absDir, relDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip(e, relDir)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        knownDirs.add(rel);
        await scan(join(absDir, e.name), rel);
      } else if (e.isFile() && isDpx(e.name)) {
        try {
          await adopt(rel, join(absDir, e.name));
        } catch {}
      }
    }
  }

  // Compare disk with what we know; only differences (= outside changes) are reported.
  const reconcile = (rel, catchUp = false) => serial(() => reconcileNow(rel, catchUp));
  async function reconcileNow(rel, catchUp = false) {
    let segs;
    try {
      segs = parseRelPath(rel);
    } catch {
      return; // hidden / temp names
    }
    const abs = join(fsr.root, ...segs);
    const st = await statOrNull(abs);
    if (st?.isSymbolicLink()) return;
    if (!st) {
      if (known.has(rel)) {
        forget(rel, false);
        await trashQuietly(rel, null); // deleted outside: keep its history out of reach of a new file at this path
        onExternalChange?.({ kind: 'delete', path: rel });
      } else if (knownDirs.has(rel)) {
        const gone = [...known.keys()].filter((k) => k.startsWith(rel + '/'));
        forget(rel, true);
        await trashMany(gone.map((k) => [k, null]));
        onExternalChange?.({ kind: 'tree', path: rel, from: rel });
      }
      return;
    }
    if (st.isDirectory()) {
      if (!knownDirs.has(rel)) {
        knownDirs.add(rel);
        onExternalChange?.({ kind: 'tree', path: rel });
      }
      return;
    }
    if (!st.isFile() || !isDpx(rel)) return;
    let loaded;
    try {
      const text = await readFile(abs, 'utf8');
      try {
        loaded = { text, file: parseStored(text) };
      } catch {
        loaded = { text, file: null };
      }
    } catch {
      return;
    }
    const prev = known.get(rel);
    if (prev?.hash === sha(loaded.text)) return; // our own write
    const floor = prev?.revision ?? tombstones.get(rel);
    if (!loaded.file || floor === undefined) {
      known.set(rel, { hash: sha(loaded.text), revision: loaded.file?.revision ?? floor ?? 0 });
      tombstones.delete(rel);
      onExternalChange?.({ kind: prev ? 'change' : 'create', path: rel, revision: loaded.file?.revision ?? null, ...(catchUp ? { catchUp } : {}) });
      return;
    }
    const { file } = await syncExternal(rel, loaded, abs); // raises the revision if the editor did not
    onExternalChange?.({ kind: prev ? 'change' : 'create', path: rel, revision: file.revision, ...(catchUp ? { catchUp } : {}) });
  }

  let closed = false;
  let restartTimer = null;
  let restartDelay = watchRestartMs;
  let healthyTimer = null;
  // Logged once per server run: a watcher that keeps failing must not fill the log.
  let warned = false;

  // With reserved names (project mode, #782) one recursive watch on the root would also cover .atelier/worktrees
  // (whole git checkouts with node_modules) and .drawing/: inotify watches on all of it. Instead the root is watched
  // alone (top-level names only) and each top-level document folder recursively. A folder that appears later gets its
  // own watch; one that goes away has it closed. Hidden, reserved and symlinked top-level entries are never watched.
  // Returns one watcher-like object (on('error'), close()); an error from any part reaches the 'error' listeners.
  function watchByFolder() {
    const subs = new Map(); // top folder name -> fs watcher
    const errorFns = [];
    let done = false;
    const fail = (err) => { for (const fn of errorFns) fn(err); };
    const watchable = (name) => {
      if (!name || name.startsWith('.') || reserved.includes(name)) return false;
      try { const st = lstatSync(join(fsr.root, name)); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
    };
    const add = (name) => {
      if (done || subs.has(name) || !watchable(name)) return;
      const w = watchFn(join(fsr.root, name), { recursive: true }, (_ev, filename) => {
        if (filename) onWatchEvent(`${name}/${String(filename).split('\\').join('/')}`);
      });
      w.on?.('error', (err) => {
        // The folder itself went away (moved or deleted): drop its watch; the root watch reports the change.
        try { w.close(); } catch { /* already closed */ }
        subs.delete(name);
        if (watchable(name)) fail(err);
      });
      subs.set(name, w);
    };
    const root = watchFn(fsr.root, { recursive: false }, (_ev, filename) => {
      if (!filename) return;
      const name = String(filename).split('\\').join('/').split('/')[0];
      if (name.startsWith('.') || reserved.includes(name)) return;
      if (watchable(name)) add(name);
      else if (subs.has(name)) { try { subs.get(name).close(); } catch { /* closed */ } subs.delete(name); }
      onWatchEvent(name);
    });
    root.on?.('error', fail);
    try {
      for (const e of readdirSync(fsr.root, { withFileTypes: true })) if (e.isDirectory()) add(e.name);
    } catch (err) {
      try { root.close(); } catch { /* closed */ }
      for (const w of subs.values()) try { w.close(); } catch { /* closed */ }
      throw err;
    }
    return {
      on(ev, fn) { if (ev === 'error') errorFns.push(fn); return this; },
      close() {
        done = true;
        try { root.close(); } catch { /* closed */ }
        for (const w of subs.values()) try { w.close(); } catch { /* closed */ }
        subs.clear();
      },
      folders: () => [...subs.keys()],
    };
  }

  function onWatchEvent(rel) {
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
      timers.delete(rel);
      reconcile(rel).catch(() => {});
    }, watchDebounceMs));
  }

  function watchRoot() {
    watcher = reserved.length ? watchByFolder() : watchFn(fsr.root, { recursive: true }, (_ev, filename) => {
      if (!filename) return;
      onWatchEvent(String(filename).split('\\').join('/'));
    });
    const mine = watcher;
    // Errors after start (the root removed, watch limit hit, ...) arrive here. Log the code once, no path,
    // then try to watch again: a dead watcher would stop noticing outside edits without any sign.
    mine.on('error', (err) => {
      if (!warned) {
        warned = true;
        console.warn(`workspace: watching for outside changes failed (${err?.code ?? 'error'}), retrying`);
      }
      try { mine.close(); } catch { /* already closed */ }
      if (watcher === mine) watcher = null;
      // A watcher that dies right after starting (ENOSPC on a recursive watch, ...) backs off instead of
      // restarting every second; the delay resets only after a watcher has stayed up for a while.
      clearTimeout(healthyTimer);
      healthyTimer = null;
      scheduleRestart();
      restartDelay = Math.min(restartDelay * 2, 30000);
    });
  }

  function scheduleRestart() {
    if (closed || restartTimer) return;
    restartTimer = setTimeout(async () => {
      restartTimer = null;
      if (closed) return;
      try {
        watchRoot();
        healthyTimer = setTimeout(() => { restartDelay = watchRestartMs; }, 60000);
        healthyTimer.unref?.();
        // Catch what changed while nothing was watching (known files only; new ones show up with the next tree refresh).
        for (const rel of [...known.keys()]) {
          if (closed) break;
          await reconcile(rel, true).catch(() => {});
        }
      } catch {
        restartDelay = Math.min(restartDelay * 2, 30000);
        scheduleRestart();
      }
    }, restartDelay);
    restartTimer.unref?.();
  }

  async function startWatching() {
    await scan(fsr.root, '');
    try {
      watchRoot();
    } catch (err) {
      // EACCES, ENOSPC (watch limit), ...: the app still works, outside edits are just not noticed until a file is read or saved. No path in the log.
      console.warn(`workspace: not watching for outside changes (${err?.code ?? 'error'})`);
    }
  }

  function close() {
    closed = true;
    clearTimeout(restartTimer);
    clearTimeout(healthyTimer);
    watcher?.close();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    return c.queue;
  }

  // Shared context for the sections: state, helpers and options above, then every section's functions (store-*.js).
  const c = {
    fsr, parseRelPath, skip, known, knownDirs, tombstones, sidecarListeners, sidecarEvent, serial, wrapPath, fileRel, checkFolderNames,
    checkedFileRel, atomicWrite, statOrNull, asParentClash, ensureDir, ensureParent, loadStored, serialize,
    onExternalChange, watchDebounceMs, watchRestartMs, watchFn, now, historyIntervalMs, historyMax, reserved,
    treeMark: null, // (rel) => Promise<{ state } | null>, set by the runs module
    get queue() {
      return queue;
    },
    // Sections not split out yet.
    createFile, readFileAt, fileExists, syncExternal, writeFileAt, patchPlanAt, patchDiscussionsAt, editDocumentAt, createFolder, parseOrThrow, move, moveWithSubdocs, moved, moveFile, moveFolder, knownEntry, adopt, pruneEmptyDirs, removeFile, removeFolder, forget, scan, reconcile, reconcileNow, startWatching, close,
  };
  for (const make of [createHistory, createRunsSidecar, createTrash, createTree]) Object.assign(c, make(c));
  const { tree, createdAt, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, runsApi } = c;

  return { root: fsr.root, tree, createdAt, createFile, readFile: readFileAt, fileExists, writeFile: writeFileAt, patchPlan: patchPlanAt, patchDiscussions: patchDiscussionsAt, editDocument: editDocumentAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, startWatching, close, runs: runsApi };
}
