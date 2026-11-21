// Workspace store, history: Version history and the history/runs sidecar folders that follow a file.
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { mkdir, readdir, readFile, rename, rm, rmdir, lstat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, sep } from 'node:path';
import { PathError } from './paths.js';
import { parseStored, ValidationError } from './model.js';
import { StoreError, HISTORY_DIR, SNAPSHOT_ID, BORN_FILE, LABELS_FILE, VERSION_LABELS, RUNS_DIR } from './store-shared.js';

export function createHistory(c) {
  const { fsr, sidecarEvent, serial, wrapPath, checkedFileRel, statOrNull, loadStored, now, historyIntervalMs, historyMax } = c;
  const plainFile = (...a) => c.plainFile(...a); // store-trash.js

  // ---- version history ----
  // `.drawing/history/<file path>/<ms timestamp>.json` holds the file as it was on disk just before a save
  // overwrote it (the timestamp is that save's time), so the end of each edit session is kept.
  // History is a convenience: a failure here never fails the save, delete or move it belongs to.
  const sidecarDirOf = async (root, rel) => {
    try {
      return await fsr.resolveInternal(...root, ...rel.split('/'));
    } catch (err) {
      if (err instanceof PathError) throw new StoreError(400, err.message);
      throw err;
    }
  };
  const historyDirOf = (rel) => sidecarDirOf(HISTORY_DIR, rel);
  const runsDirOf = (rel) => sidecarDirOf(RUNS_DIR, rel);

  async function snapshotIds(dir) {
    try {
      return (await readdir(dir)).filter((n) => n.endsWith('.json') && SNAPSHOT_ID.test(n.slice(0, -5))).map((n) => n.slice(0, -5)).sort();
    } catch {
      return [];
    }
  }

  const sameContent = (a, b) => {
    try {
      const { revision: _a, ...x } = parseStored(a);
      const { revision: _b, ...y } = parseStored(b);
      return JSON.stringify(x) === JSON.stringify(y);
    } catch {
      return false;
    }
  };

  // Keep `text` as a snapshot of `rel` unless the newest one is younger than the interval (or `force`) or has the same content.
  async function snapshot(rel, text, { force = false } = {}) {
    const dir = await historyDirOf(rel);
    const ids = await snapshotIds(dir);
    const last = ids[ids.length - 1];
    if (last !== undefined) {
      if (!force && now() - Number(last) < historyIntervalMs) return null;
      try {
        if (sameContent(await readFile(join(dir, `${last}.json`), 'utf8'), text)) return last;
      } catch {}
    }
    let id = Math.max(now(), last === undefined ? 0 : Number(last) + 1);
    id = String(id).padStart(13, '0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), text, { mode: 0o644 });
    ids.push(id);
    for (const old of ids.slice(0, Math.max(0, ids.length - historyMax))) await unlink(join(dir, `${old}.json`)).catch(() => {});
    return id;
  }

  const snapshotQuietly = (rel, text) => snapshot(rel, text).catch(() => null);

  // When a file was made: saves replace the file, so its own birth time is lost. A `born` file (ms as text) in its
  // history dir keeps it; it moves with the history (move), and goes through the trash in meta.json (delete, restore).
  async function markBorn(rel, t) {
    try {
      const dir = await historyDirOf(rel);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, BORN_FILE), `${t}\n`, { mode: 0o644 });
    } catch {}
  }
  async function readBorn(dir) {
    try {
      if (!(await plainFile(join(dir, BORN_FILE)))) return null;
      const t = Number((await readFile(join(dir, BORN_FILE), 'utf8')).trim());
      return Number.isSafeInteger(t) && t > 0 ? t : null;
    } catch {
      return null;
    }
  }

  async function readLabels(dir) {
    try {
      if (!(await plainFile(join(dir, LABELS_FILE)))) return {};
      const raw = JSON.parse(await readFile(join(dir, LABELS_FILE), 'utf8'));
      const out = {};
      for (const [id, ls] of Object.entries(raw ?? {})) {
        if (!SNAPSHOT_ID.test(id) || !Array.isArray(ls)) continue;
        const ok = [...new Set(ls.filter((l) => VERSION_LABELS.includes(l)))];
        if (ok.length) out[id] = ok;
      }
      return out;
    } catch {
      return {};
    }
  }

  async function history(rel) {
    rel = checkedFileRel(rel);
    await wrapPath(rel);
    const dir = await historyDirOf(rel);
    const labels = await readLabels(dir);
    const versions = [];
    for (const id of (await snapshotIds(dir)).reverse()) {
      try {
        const st = await lstat(join(dir, `${id}.json`));
        if (st.isFile()) versions.push({ id, time: Number(id), bytes: st.size, ...(labels[id] && { labels: labels[id] }) });
      } catch {}
    }
    return { path: rel, versions };
  }

  /**
   * Keep the file as it is on disk now as a version and mark it with a pipeline milestone (`draft`, `approved`,
   * `done`). Best effort like all history: returns the snapshot id, or null when it could not be kept.
   */
  async function labelVersion(rel, label) {
    if (!VERSION_LABELS.includes(label)) throw new StoreError(400, 'invalid version label');
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      try {
        const { text } = await loadStored(abs);
        const id = await snapshot(rel, text, { force: true });
        if (!id) return null;
        const dir = await historyDirOf(rel);
        const kept = new Set(await snapshotIds(dir));
        const labels = Object.fromEntries(Object.entries(await readLabels(dir)).filter(([k]) => kept.has(k)));
        labels[id] = [...new Set([...(labels[id] ?? []), label])];
        const tmp = join(dir, `.${LABELS_FILE}.${randomBytes(6).toString('hex')}.tmp`);
        await writeFile(tmp, JSON.stringify(labels) + '\n', { mode: 0o644 });
        await rename(tmp, join(dir, LABELS_FILE));
        return id;
      } catch {
        return null;
      }
    });
  }

  async function historyVersion(rel, id) {
    rel = checkedFileRel(rel);
    await wrapPath(rel);
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new StoreError(400, 'invalid version id');
    const dir = await historyDirOf(rel);
    let text;
    try {
      // The snapshot itself must be a plain file: a link there could point at anything the server can read.
      const st = await lstat(join(dir, `${id}.json`));
      if (!st.isFile()) throw new StoreError(404, 'version not found');
      text = await readFile(join(dir, `${id}.json`), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'version not found');
      throw err;
    }
    try {
      return { path: rel, id, time: Number(id), ...parseStored(text) };
    } catch (err) {
      if (err instanceof ValidationError) throw new StoreError(422, `unreadable version: ${err.message}`);
      throw err;
    }
  }

  // Snapshot what is on disk now, ignoring the interval (before a restore).
  async function historySnapshotNow(rel) {
    rel = checkedFileRel(rel);
    const abs = await wrapPath(rel);
    return serial(async () => {
      const { text } = await loadStored(abs);
      return { path: rel, id: await snapshot(rel, text, { force: true }) };
    });
  }

  // A file or folder moved: its history and runs move with it (best effort); one deleted: its history goes too.
  async function moveSidecar(root, from, to) {
    try {
      const fromDir = await sidecarDirOf(root, from);
      if (!(await statOrNull(fromDir))) return;
      const toDir = await sidecarDirOf(root, to);
      await rm(toDir, { recursive: true, force: true });
      await mkdir(dirname(toDir), { recursive: true });
      await rename(fromDir, toDir);
      await pruneEmptyParents(root, fromDir);
    } catch {}
  }
  async function moveHistory(from, to) {
    await moveSidecar(HISTORY_DIR, from, to);
    await moveSidecar(RUNS_DIR, from, to);
    sidecarEvent({ kind: 'move', from, to });
  }
  // Remove now-empty parent folders of a sidecar dir that moved or went away, up to (not including) `.drawing/<kind>`.
  async function pruneEmptyParents(rootSegs, dir) {
    try {
      const root = await fsr.resolveInternal(...rootSegs);
      for (let d = dirname(dir); d.startsWith(root + sep) && d !== root; d = dirname(d)) await rmdir(d); // throws (ENOTEMPTY) at the first non-empty one
    } catch {}
  }
  const pruneEmptyHistoryParents = (dir) => pruneEmptyParents(HISTORY_DIR, dir);
  const dropSidecar = (root, rel) =>
    sidecarDirOf(root, rel)
      .then(async (d) => {
        await rm(d, { recursive: true, force: true });
        await pruneEmptyParents(root, d);
      })
      .catch(() => {});
  const dropHistory = async (rel) => {
    await dropSidecar(HISTORY_DIR, rel);
    await dropSidecar(RUNS_DIR, rel);
  };
  const nonEmptyDir = async (dir) => {
    try {
      return (await readdir(dir)).length > 0;
    } catch {
      return false;
    }
  };

  return { sidecarDirOf, historyDirOf, runsDirOf, snapshotIds, snapshot, snapshotQuietly, markBorn, readBorn, readLabels, history, labelVersion, historyVersion, historySnapshotNow, moveSidecar, moveHistory, pruneEmptyParents, pruneEmptyHistoryParents, dropSidecar, dropHistory, nonEmptyDir };
}
