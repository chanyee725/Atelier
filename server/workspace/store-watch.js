// Workspace store, watch: Watching the workspace for outside changes and reconciling them.
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { lstatSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseStored } from './model.js';
import { sha, isDpx } from './store-shared.js';

export function createWatch(c) {
  const { fsr, parseRelPath, skip, known, knownDirs, tombstones, serial, statOrNull, onExternalChange, watchDebounceMs, watchRestartMs, watchFn, reserved } = c;
  const adopt = (...a) => c.adopt(...a); // store-files.js
  const forget = (...a) => c.forget(...a); // store-files.js
  const syncExternal = (...a) => c.syncExternal(...a); // store-files.js
  const trashMany = (...a) => c.trashMany(...a); // store-trash.js
  const trashQuietly = (...a) => c.trashQuietly(...a); // store-trash.js

  let watcher = null;
  const timers = new Map();

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

  return { scan, reconcile, reconcileNow, startWatching, close };
}
