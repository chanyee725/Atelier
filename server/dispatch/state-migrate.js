// One-time move of a project's state from an older version's `.dispatch/` to `.atelier/` (issue #782).
//
// Runs when the Dispatch module starts, holding both project locks (`.dispatch/drawing.lock`, so no
// older server works on the folder meanwhile, and `.atelier/drawing.lock`). It moves only when no
// session is saved in `.dispatch/state.json`: a saved session runs in `.dispatch/wt/<slug>` and is
// resumed from there. Until then the server keeps using `.dispatch/` as it is (nothing new is made
// there beyond what an older version made) and tries again on the next start.
// Never overwrites: any name already in `.atelier/` stops the move before anything is moved, and a
// rename that fails midway puts back what was moved. `wt/` becomes `worktrees/`; git's links of the
// moved worktrees are fixed with `git worktree repair`. A `.dispatch` that is a symlink is never
// followed or moved.
import { lstat, readdir, readFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { ownGitEnv, runCli } from "./cli.js";
import { ensureExcluded } from "./git.js";
import { claimProject } from "./project.js";
import { LEGACY_WORKTREES_DIR, stateLayout, WORKTREES_DIR } from "./paths.js";

const exists = (p) => lstat(p).then(() => true, (e) => (e.code === "ENOENT" ? false : Promise.reject(e)));
/** The lock file and the files lock.js makes beside it stay behind: they belong to the lock, not the state. */
const isLockFile = (name) => name === "drawing.lock" || name.startsWith("drawing.lock.");

/** `git worktree repair <paths>` in root: re-links worktrees whose folder was moved. */
export async function repairWorktrees(root, dirs) {
  if (dirs.length) await runCli("git", ["-C", root, "worktree", "repair", ...dirs], { env: ownGitEnv() });
}

/**
 * Moves every entry of `from.dir` but the lock into `to.dir` (wt/ → worktrees/).
 * Returns { ok: true } or { ok: false, why: 'sessions' | 'unreadable' | 'conflict' | <error code> }.
 */
export async function moveState(root, from, to, { repair = repairWorktrees } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(await readFile(from.stateFile, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") return { ok: false, why: "unreadable" };
  }
  if (saved && Object.keys(saved.sessions || {}).length) return { ok: false, why: "sessions" };

  const moves = [];
  for (const name of await readdir(from.dir)) {
    if (isLockFile(name)) continue;
    const dest = name === LEGACY_WORKTREES_DIR ? WORKTREES_DIR : name;
    if (await exists(path.join(to.dir, dest))) return { ok: false, why: "conflict" };
    moves.push([path.join(from.dir, name), path.join(to.dir, dest)]);
  }
  // State last, so a half-done move never has state.json in .atelier/ without its worktrees.
  moves.sort(([a], [b]) => (a === from.stateFile) - (b === from.stateFile));
  const done = [];
  try {
    for (const [src, dst] of moves) {
      await rename(src, dst);
      done.push([src, dst]);
    }
  } catch (e) {
    for (const [src, dst] of done.reverse()) await rename(dst, src).catch(() => {});
    return { ok: false, why: e.code ?? e.name };
  }

  const worktrees = to.worktrees;
  if (done.some(([, dst]) => dst === worktrees)) {
    await ensureExcluded(root, worktrees);
    const dirs = [];
    for (const e of await readdir(worktrees, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) dirs.push(path.join(worktrees, e.name));
    await repair(root, dirs).catch((e) => console.error("dispatch state: git worktree repair failed:", e.code ?? e.name));
  }
  return { ok: true };
}

/**
 * Claims the project's state folder for this server (project.js claimProject), moving an older
 * `.dispatch/` over first when it may. Returns claimProject's refusal, or
 * { ok: true, lock, layout, moved?, kept? } — `layout` is the folder to use (paths.js), `kept` why
 * a `.dispatch/` stays in use.
 */
export async function claimState(root, opts = {}) {
  const fresh = stateLayout(root);
  const legacy = stateLayout(root, { legacy: true });
  const st = await lstat(legacy.dir).catch(() => null);
  if (!st?.isDirectory()) {
    const c = await claimProject(root, fresh);
    return c.ok ? { ...c, layout: fresh } : c;
  }
  const old = await claimProject(root, legacy);
  if (!old.ok) return old;
  const hadFresh = await exists(fresh.dir);
  const neu = await claimProject(root, fresh);
  if (!neu.ok) {
    await old.lock.release();
    return neu;
  }
  let res;
  try {
    res = await moveState(root, legacy, fresh, opts);
  } catch (e) {
    res = { ok: false, why: e.code ?? e.name };
  }
  if (res.ok) {
    await old.lock.release();
    await rmdir(legacy.dir).catch(() => {}); // only while empty: the lock's own leftovers keep it
    console.log("Dispatch state: moved .dispatch to .atelier");
    return { ok: true, lock: neu.lock, layout: fresh, moved: true };
  }
  await neu.lock.release();
  if (!hadFresh) await rmdir(fresh.dir).catch(() => {});
  console.log(`Dispatch state: kept .dispatch (${res.why}); it moves to .atelier on a start with no saved session`);
  return { ok: true, lock: old.lock, layout: legacy, kept: res.why };
}
