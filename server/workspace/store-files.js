// Workspace store, files: File and folder operations: create, read, save, patch, move, delete.
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { mkdir, readdir, readFile, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { PathError } from './paths.js';
import { FILE_EXT, FORMAT_VERSION, newFile, normalizeContent, parseStored, ValidationError } from './model.js';
import { applyPlanOps } from './plan-ops.js';
import { PLAN_VERSION } from '../../shared/dispatch/plan.ts';
import { DISCUSSIONS_VERSION } from '../../shared/dispatch/discussions.ts';
import { StoreError, sha, MAX_TOMBSTONES } from './store-shared.js';

export function createFileOps(c) {
  const { parseRelPath, known, knownDirs, tombstones, serial, wrapPath, checkFolderNames, checkedFileRel, atomicWrite, statOrNull, asParentClash, ensureDir, ensureParent, loadStored, serialize, onExternalChange, now } = c;
  const collectFiles = (...a) => c.collectFiles(...a); // store-trash.js
  const dropHistory = (...a) => c.dropHistory(...a); // store-history.js
  const markBorn = (...a) => c.markBorn(...a); // store-history.js
  const moveHistory = (...a) => c.moveHistory(...a); // store-history.js
  const scan = (...a) => c.scan(...a); // store-watch.js
  const snapshotQuietly = (...a) => c.snapshotQuietly(...a); // store-history.js
  const trashMany = (...a) => c.trashMany(...a); // store-trash.js
  const trashQuietly = (...a) => c.trashQuietly(...a); // store-trash.js

  // ---- folder name case (#1026) ----
  // A folder that differs from an existing sibling only in letter case (`Web/` next to `web/`) splits one area in two.
  // Every create and move reuses the existing folder instead: each folder segment of `rel` (the last one too with
  // `last`) that has no exact match but exactly one case-insensitive sibling folder takes that folder's name. Two or
  // more such siblings and no exact one are ambiguous: 409. Segments past the first missing folder stay as written.
  const caseKey = (s) => s.normalize('NFC').toLowerCase();
  async function matchFolderCase(rel, { last = false } = {}) {
    const segs = rel.split('/');
    const count = last ? segs.length : segs.length - 1;
    let dir = c.fsr.root;
    for (let i = 0; i < count; i++) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') break;
        throw err;
      }
      const seg = segs[i];
      if (!entries.some((e) => e.name === seg)) {
        const key = caseKey(seg);
        const same = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && caseKey(e.name) === key).map((e) => e.name);
        if (same.length > 1) throw new StoreError(409, `대소문자만 다른 폴더가 여러 개예요: ${same.join(', ')}`);
        if (same.length === 1) segs[i] = same[0];
        else break;
      }
      dir = join(dir, segs[i]);
    }
    return segs.join('/');
  }

  // ---- file operations ----
  // `body` may carry starting content (document, canvas, blocks, plan), e.g. a pipeline template; it is checked like a save.
  async function createFile(rel, body = {}) {
    rel = checkedFileRel(rel);
    checkFolderNames(rel.split('/').slice(0, -1));
    await wrapPath(rel).catch((err) => {
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
      // Inside the queue, so the folder lookup sees every earlier create and move (#1026).
      rel = await matchFolderCase(rel);
      const abs = await wrapPath(rel).catch((err) => {
        throw asParentClash(err);
      });
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
    await wrapPath(rel);
    return serial(async () => {
      rel = await matchFolderCase(rel, { last: true });
      const abs = await wrapPath(rel);
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
      return serial(async () => moveWithSubdocs(from, await matchFolderCase(to)));
    }
    return serial(async () => {
      to = await matchFolderCase(to);
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
    const subRaw = fileTo.slice(0, -FILE_EXT.length);
    const subMatched = await matchFolderCase(subRaw, { last: true });
    const subTo = subMatched === subFrom ? subRaw : subMatched; // a case-only rename keeps its own spelling
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
    // The target name reuses a case-variant sibling (then refused below as taken), except the folder itself: `Web` → `web`.
    const matched = await matchFolderCase(toRel, { last: true });
    if (matched !== from) toRel = matched;
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

  return { matchFolderCase, createFile, readFileAt, fileExists, syncExternal, writeFileAt, patchPlanAt, patchDiscussionsAt, editDocumentAt, createFolder, parseOrThrow, move, moveWithSubdocs, moved, moveFile, moveFolder, knownEntry, adopt, pruneEmptyDirs, removeFile, removeFolder, forget };
}
