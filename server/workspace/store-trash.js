// Workspace store, trash: Trash: deleted files (content, history, runs) stay restorable for TRASH_DAYS.
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { mkdir, readdir, readFile, rename, rm, lstat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { FORMAT_VERSION, parseStored, ValidationError } from './model.js';
import { StoreError, isDpx, TRASH_DIR, TRASH_DAYS, TRASH_MAX, TRASH_ID, RUNS_DIR } from './store-shared.js';

export function createTrash(c) {
  const { fsr, parseRelPath, skip, knownDirs, tombstones, sidecarEvent, serial, wrapPath, checkFolderNames, atomicWrite, statOrNull, asParentClash, ensureParent, serialize, onExternalChange, now } = c;
  const adopt = (...a) => c.adopt(...a); // store-files.js
  const historyDirOf = (...a) => c.historyDirOf(...a); // store-history.js
  const markBorn = (...a) => c.markBorn(...a); // store-history.js
  const nonEmptyDir = (...a) => c.nonEmptyDir(...a); // store-history.js
  const pruneEmptyHistoryParents = (...a) => c.pruneEmptyHistoryParents(...a); // store-history.js
  const pruneEmptyParents = (...a) => c.pruneEmptyParents(...a); // store-history.js
  const readBorn = (...a) => c.readBorn(...a); // store-history.js
  const runsDirOf = (...a) => c.runsDirOf(...a); // store-history.js
  const snapshotIds = (...a) => c.snapshotIds(...a); // store-history.js

  // ---- trash: deleted files stay restorable for TRASH_DAYS ----
  // `.drawing/trash/<ms>-<hex>/` holds `meta.json` {path, deletedAt}, `file.json` (the content when we saw it go)
  // and `history/` (the file's snapshots). Like history, trash is best effort and never fails a delete.
  const trashRoot = () => fsr.resolveInternal(...TRASH_DIR);
  const entryDir = async (id) => {
    if (typeof id !== 'string' || !TRASH_ID.test(id)) throw new StoreError(400, 'invalid trash id');
    return fsr.resolveInternal(...TRASH_DIR, id);
  };
  const plainFile = async (abs) => (await statOrNull(abs))?.isFile() === true;

  // Move `rel`'s history (and `text`, if known) into a new trash entry. Without text, the newest snapshot stands in on restore.
  // Returns the new entry's id (or null). Pass `purge: false` when deleting many files at once and call
  // `purgeTrash(keepIds)` once afterwards, so the entries just made are never the ones dropped.
  async function trashQuietly(rel, text, { purge = true } = {}) {
    try {
      const histDir = await historyDirOf(rel);
      const hasHistory = (await snapshotIds(histDir)).length > 0;
      const runsDir = await runsDirOf(rel);
      const hasRuns = await nonEmptyDir(runsDir);
      if (text == null && !hasHistory && !hasRuns) return null;
      const born = await readBorn(histDir);
      const t = now();
      const id = `${String(t).padStart(13, '0')}-${randomBytes(4).toString('hex')}`;
      const dir = join(await trashRoot(), id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ path: rel, deletedAt: t, ...(born ? { created: born } : {}) }) + '\n', { mode: 0o644 });
      if (text != null) await writeFile(join(dir, 'file.json'), text, { mode: 0o644 });
      if (hasHistory) await rename(histDir, join(dir, 'history'));
      await rm(histDir, { recursive: true, force: true });
      await pruneEmptyHistoryParents(histDir);
      if (hasRuns) {
        await rename(runsDir, join(dir, 'runs'));
        await pruneEmptyParents(RUNS_DIR, runsDir);
        sidecarEvent({ kind: 'trash', path: rel, trashId: id });
      }
      if (purge) await purgeTrash([id]);
      return id;
    } catch {
      return null;
    }
  }

  // Trash every file of one delete, then purge once, sparing what this delete just made.
  async function trashMany(items) {
    const ids = [];
    for (const [rel, text] of items) ids.push(await trashQuietly(rel, text, { purge: false }));
    await purgeTrash(ids.filter(Boolean)).catch(() => {});
  }

  async function readEntry(root, id) {
    const dir = join(root, id);
    try {
      if (!(await lstat(dir)).isDirectory() || !(await plainFile(join(dir, 'meta.json')))) return null;
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
      if (typeof meta?.path !== 'string' || !Number.isFinite(meta.deletedAt)) return null;
      parseRelPath(meta.path);
      return { id, dir, path: meta.path, deletedAt: meta.deletedAt, created: Number.isSafeInteger(meta.created) && meta.created > 0 ? meta.created : null };
    } catch {
      return null;
    }
  }

  async function trashEntries() {
    let root;
    try {
      root = await trashRoot();
    } catch {
      return [];
    }
    let names;
    try {
      names = (await readdir(root)).filter((n) => TRASH_ID.test(n)).sort();
    } catch {
      return [];
    }
    const out = [];
    for (const id of names) {
      const e = await readEntry(root, id);
      if (e) out.push(e);
      else await rm(join(root, id), { recursive: true, force: true }).catch(() => {}); // not ours or damaged
    }
    return out;
  }

  // Drop entries older than 30 days, and the oldest beyond TRASH_MAX. Ids in `spare` (made by the delete in
  // progress) are never dropped, even past the cap; the next ordinary purge trims the excess.
  async function purgeTrash(spare = [], { cap = true } = {}) {
    const entries = await trashEntries();
    const cutoff = now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    const keep = entries.filter((e) => e.deletedAt >= cutoff);
    const spared = new Set(spare);
    const droppable = keep.filter((e) => !spared.has(e.id));
    const drop = [...entries.filter((e) => e.deletedAt < cutoff && !spared.has(e.id)), ...droppable.slice(0, Math.max(0, cap ? keep.length - TRASH_MAX : 0))];
    for (const e of drop) await rm(e.dir, { recursive: true, force: true }).catch(() => {});
  }

  async function trash() {
    return serial(async () => {
      await purgeTrash([], { cap: false }).catch(() => {}); // listing only ages entries out; the cap is enforced when something is deleted
      const items = [];
      for (const e of (await trashEntries()).reverse()) {
        // No saved copy of the content (deleted outside the app): restoring brings back the newest history snapshot.
        items.push({ id: e.id, path: e.path, deletedAt: e.deletedAt, fromSnapshot: !(await plainFile(join(e.dir, 'file.json'))) });
      }
      return { items };
    });
  }

  async function restoreTrash(id) {
    return serial(async () => {
      const dir = await entryDir(id);
      const entry = await readEntry(join(dir, '..'), id);
      if (!entry) throw new StoreError(404, 'not in the trash');
      const rel = entry.path;
      if (!isDpx(rel)) throw new StoreError(404, 'not in the trash');
      checkFolderNames(rel.split('/').slice(0, -1));
      let abs;
      try {
        abs = await wrapPath(rel);
      } catch (err) {
        // A file now sits where one of the folders used to be: say so instead of a generic failure.
        throw asParentClash(err);
      }
      if (await statOrNull(abs)) throw new StoreError(409, 'a file already exists at that path');
      const histDir = join(dir, 'history');
      const hasHist = (await statOrNull(histDir))?.isDirectory() === true;
      let text = null;
      if (await plainFile(join(dir, 'file.json'))) text = await readFile(join(dir, 'file.json'), 'utf8');
      else if (hasHist) {
        const ids = await snapshotIds(histDir);
        for (const sid of ids.reverse()) {
          if (await plainFile(join(histDir, `${sid}.json`))) {
            text = await readFile(join(histDir, `${sid}.json`), 'utf8');
            break;
          }
        }
      }
      if (text == null) throw new StoreError(422, 'nothing left to restore');
      let file;
      try {
        file = parseStored(text);
      } catch (err) {
        if (err instanceof ValidationError) throw new StoreError(422, `unreadable file: ${err.message}`);
        throw err;
      }
      await ensureParent(abs);
      // Start above the revision the path had when it was deleted, so a stale tab cannot overwrite the restored file.
      const floor = tombstones.get(rel) ?? 0;
      if (file.revision <= floor && file.version <= FORMAT_VERSION) text = serialize({ ...file, revision: floor + 1 });
      await atomicWrite(abs, text, { exclusive: true });
      await adopt(rel, abs);
      if (hasHist) await mergeHistory(histDir, await historyDirOf(rel));
      const hasRuns = (await statOrNull(join(dir, 'runs')))?.isDirectory() === true;
      if (hasRuns) await mergeRuns(join(dir, 'runs'), await runsDirOf(rel));
      if (entry.created) await markBorn(rel, entry.created);
      await rm(dir, { recursive: true, force: true });
      if (hasRuns) sidecarEvent({ kind: 'restore', path: rel, trashId: id });
      for (let d = dirname(rel); d !== '.'; d = dirname(d)) knownDirs.add(d);
      onExternalChange?.({ kind: 'tree', path: rel });
      return { path: rel };
    });
  }

  // Put trashed snapshots back; ids that are taken (a new file got history at that path) move to the next free id.
  async function mergeHistory(fromDir, toDir) {
    await mkdir(toDir, { recursive: true });
    const taken = new Set(await snapshotIds(toDir));
    for (const id of await snapshotIds(fromDir)) {
      if (!(await plainFile(join(fromDir, `${id}.json`)))) continue;
      let next = id;
      while (taken.has(next)) next = String(Number(next) + 1).padStart(13, '0');
      taken.add(next);
      await rename(join(fromDir, `${id}.json`), join(toDir, `${next}.json`)).catch(() => {});
    }
  }

  // Put trashed run records back; a record whose name is taken at the path keeps the one already there.
  async function mergeRuns(fromDir, toDir) {
    await mkdir(toDir, { recursive: true });
    const taken = new Set(await readdir(toDir).catch(() => []));
    for (const name of await readdir(fromDir).catch(() => [])) {
      if (name.startsWith('.') || taken.has(name) || !(await plainFile(join(fromDir, name)))) continue;
      await rename(join(fromDir, name), join(toDir, name)).catch(() => {});
    }
  }

  // Every diagram file under a folder (rel path + content), read before the folder goes away.
  async function collectFiles(absDir, relDir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (skip(e, relDir)) continue;
      const rel = `${relDir}/${e.name}`;
      if (e.isDirectory()) out.push(...(await collectFiles(join(absDir, e.name), rel)));
      else if (e.isFile() && isDpx(e.name)) out.push({ rel, text: await readFile(join(absDir, e.name), 'utf8').catch(() => null) });
    }
    return out;
  }

  return { trashRoot, entryDir, plainFile, trashQuietly, trashMany, readEntry, trashEntries, purgeTrash, trash, restoreTrash, mergeHistory, mergeRuns, collectFiles };
}
