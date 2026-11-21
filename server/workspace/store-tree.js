// Workspace store, tree: The file tree the sidebar lists, and when a file was made.
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseStored } from './model.js';
import { openQuestions } from '../../shared/dispatch/discussions.ts';
import { isDpx } from './store-shared.js';

export function createTree(c) {
  const { fsr, skip } = c;
  const historyDirOf = (...a) => c.historyDirOf(...a); // store-history.js
  const readBorn = (...a) => c.readBorn(...a); // store-history.js
  const snapshotIds = (...a) => c.snapshotIds(...a); // store-history.js

  // ---- tree ----
  async function walk(absDir, relDir) {
    const out = [];
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return out;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (skip(e, relDir)) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ type: 'folder', name: e.name, path: rel, children: await walk(join(absDir, e.name), rel) });
      } else if (e.isFile() && isDpx(e.name)) {
        let title = '';
        let revision = null;
        let pipeline;
        let questions = 0;
        try {
          const f = parseStored(await readFile(join(absDir, e.name), 'utf8'));
          title = f.title;
          revision = f.revision;
          // A file with a plan is a draft (plan) until the runs module says it is running, paused or done.
          if (f.plan) pipeline = (c.treeMark && (await c.treeMark(rel).catch(() => null))) || { state: 'plan' };
          // Open questions for the sidebar badge (#738).
          questions = openQuestions(f.discussions).length;
        } catch {
          // unreadable file still shows up so it can be renamed or deleted
        }
        let st;
        try {
          st = await stat(join(absDir, e.name));
        } catch {
          continue; // removed or unreadable between readdir and stat
        }
        // Saves replace the file (atomic rename), so its birth time is the last save on most systems; projects.js
        // takes the earlier of this and the oldest history snapshot. Without a birth time (0) the mtime stands in.
        const born = st.birthtimeMs > 0 && st.birthtimeMs < st.mtimeMs ? st.birthtime : st.mtime;
        const row = { type: 'file', name: e.name, path: rel, title, revision, mtime: st.mtime.toISOString(), created: born.toISOString() };
        if (pipeline) row.pipeline = pipeline;
        if (questions) row.questions = questions;
        out.push(row);
      }
    }
    // folders first
    return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1));
  }

  const tree = () => walk(fsr.root, '');

  /**
   * When the file at `rel` (a tree path) was made, in ms: the `born` mark of a file made through the API; for one
   * made outside the app, the earliest of its oldest kept history snapshot and `fallback` (its own times). Null when unknown.
   */
  async function createdAt(rel, fallback = null) {
    try {
      const dir = await historyDirOf(rel);
      const born = await readBorn(dir);
      if (born) return born;
      const first = (await snapshotIds(dir))[0];
      const known = [first === undefined ? null : Number(first), fallback].filter((t) => t != null);
      return known.length ? Math.min(...known) : null;
    } catch {
      return fallback;
    }
  }

  return { walk, tree, createdAt };
}
