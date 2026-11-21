// Workspace store, runs: Run record sidecars: the store side of server/runs/ (where records live, the tree mark).
// Part of createStore (store.js): `c` is its shared context (state, helpers, options, every section's functions).
import { join } from 'node:path';
import { ensureDirInside, LockPathError } from '../lock.js';
import { StoreError } from './store-shared.js';

export function createRunsSidecar(c) {
  const { fsr, sidecarListeners, serial, checkedFileRel } = c;
  const entryDir = (...a) => c.entryDir(...a); // store-trash.js
  const runsDirOf = (...a) => c.runsDirOf(...a); // store-history.js

  // ---- run record sidecars: server/runs/ owns their content; the store owns where they live ----
  // c.treeMark: (rel) => Promise<{ state } | null>, set by the runs module
  const runsApi = {
    // The runs module tells the tree a pipeline file's run state (running / paused / done).
    setTreeMark: (fn) => {
      c.treeMark = typeof fn === 'function' ? fn : null;
    },
    // Run `fn` in the store's mutation queue, so a run write never interleaves with a move, delete or restore.
    serial,
    fileRel: checkedFileRel,
    dirOf: runsDirOf,
    // The `runs` folder inside a trash entry must be a real folder inside the workspace (not a link out of it).
    trashDirOf: async (trashId) => {
      const dir = join(await entryDir(trashId), 'runs');
      try {
        await ensureDirInside(fsr.root, dir);
      } catch (err) {
        if (err instanceof LockPathError) throw new StoreError(400, err.message);
        throw err;
      }
      return dir;
    },
    onChange(fn) {
      sidecarListeners.add(fn);
      return () => sidecarListeners.delete(fn);
    },
  };

  return { runsApi };
}
