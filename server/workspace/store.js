// Workspace file store: one `*.dpx.json` per diagram file, sub-folders = folders.
// Writes are atomic (temp file in the same dir + rename) and serialized; stale writes are refused by revision.
// The sections live in store-<name>.js (history, runs, trash, tree, files, watch); each gets the shared context `c`.
import { watch } from 'node:fs';
import { pollWatch } from './poll-watch.js';
import { link, mkdir, readFile, rename, lstat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createResolver, parseWorkspacePath, PathError } from './paths.js';
import { FILE_EXT, parseStored, ValidationError } from './model.js';
import { StoreError, isDpx, HISTORY_INTERVAL_MS, HISTORY_MAX } from './store-shared.js';
import { createHistory } from './store-history.js';
import { createRunsSidecar } from './store-runs.js';
import { createTrash } from './store-trash.js';
import { createTree } from './store-tree.js';
import { createFileOps } from './store-files.js';
import { createWatch } from './store-watch.js';

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

  // Shared context for the sections: state, helpers and options above, then every section's functions (store-*.js).
  const c = {
    fsr, parseRelPath, skip, known, knownDirs, tombstones, sidecarListeners, sidecarEvent, serial, wrapPath, fileRel, checkFolderNames,
    checkedFileRel, atomicWrite, statOrNull, asParentClash, ensureDir, ensureParent, loadStored, serialize,
    onExternalChange, watchDebounceMs, watchRestartMs, watchFn, now, historyIntervalMs, historyMax, reserved,
    treeMark: null, // (rel) => Promise<{ state } | null>, set by the runs module
    get queue() {
      return queue;
    },
  };
  for (const make of [createHistory, createRunsSidecar, createTrash, createTree, createFileOps, createWatch]) Object.assign(c, make(c));
  const { matchFolderCase, tree, createdAt, createFile, readFileAt, fileExists, writeFileAt, patchPlanAt, patchDiscussionsAt, editDocumentAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, startWatching, close, runsApi } = c;

  return { root: fsr.root, matchFolderCase, tree, createdAt, createFile, readFile: readFileAt, fileExists, writeFile: writeFileAt, patchPlan: patchPlanAt, patchDiscussions: patchDiscussionsAt, editDocument: editDocumentAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, startWatching, close, runs: runsApi };
}
