// Workspace file store: one `*.dpx.json` per diagram file, sub-folders = folders.
// Writes are atomic (temp file in the same dir + rename) and serialized; stale writes are refused by revision.
// The sections live in store-<name>.js (history, runs, trash, tree, files); each gets the shared context `c`.
import { lstatSync, readdirSync, watch } from 'node:fs';
import { pollWatch } from './poll-watch.js';
import { link, mkdir, readdir, readFile, rename, lstat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { createResolver, parseWorkspacePath, PathError } from './paths.js';
import { FILE_EXT, parseStored, ValidationError } from './model.js';
import { StoreError, sha, isDpx, HISTORY_INTERVAL_MS, HISTORY_MAX } from './store-shared.js';
import { createHistory } from './store-history.js';
import { createRunsSidecar } from './store-runs.js';
import { createTrash } from './store-trash.js';
import { createTree } from './store-tree.js';
import { createFileOps } from './store-files.js';

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
  const adopt = (...a) => c.adopt(...a); // store-files.js
  const forget = (...a) => c.forget(...a); // store-files.js
  const syncExternal = (...a) => c.syncExternal(...a); // store-files.js
  const trashMany = (...a) => c.trashMany(...a); // store-trash.js
  const trashQuietly = (...a) => c.trashQuietly(...a); // store-trash.js

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
    scan, reconcile, reconcileNow, startWatching, close,
  };
  for (const make of [createHistory, createRunsSidecar, createTrash, createTree, createFileOps]) Object.assign(c, make(c));
  const { tree, createdAt, createFile, readFileAt, fileExists, writeFileAt, patchPlanAt, patchDiscussionsAt, editDocumentAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, runsApi } = c;

  return { root: fsr.root, tree, createdAt, createFile, readFile: readFileAt, fileExists, writeFile: writeFileAt, patchPlan: patchPlanAt, patchDiscussions: patchDiscussionsAt, editDocument: editDocumentAt, createFolder, move, removeFile, removeFolder, trash, restoreTrash, history, historyVersion, historySnapshotNow, labelVersion, startWatching, close, runs: runsApi };
}
