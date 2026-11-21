// Where a new plan goes (#726, #782, #1045): drafted in 기획/<feature>/계획.dpx.json, then moved to
// <area>/<feature>/ on 시작하기. The area is the one write_plan names, else the top-level folder most files the plan's
// steps name sit in, else the lead's folder. Areas are the workspace's top-level folders; a lead picks them from the
// project's structure (no fixed list) and reuses the ones that exist. 기획 is the one fixed folder.
import { readdir } from 'node:fs/promises';
import { topFolder } from '../dispatch/session-folder.js';
import { DRAFT_FOLDER, RESERVED_PROJECT_NAMES } from '../workspace/paths.js';

/** File name of a plan inside its feature folder. */
export const PLAN_FILE_STEM = '계획';

// A new plan is drafted in 기획/<feature>/ (#1045) and moves to its area when 시작하기 starts the run: the one fixed
// top-level folder (workspace/paths.js); an existing one differing only in letter case is reused (#1026).
export { DRAFT_FOLDER };

/** The workspace's top-level folders as the tree lists them (no hidden folders, no symlinks, no reserved names). */
export async function topFolders(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !RESERVED_PROJECT_NAMES.includes(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * An area or feature name write_plan may use: one plain path segment (no `/`, `\\`, `..` or hidden name, no control
 * characters), not reserved, not named like a document file, at most 80 characters, no outer spaces.
 */
export function isFolderName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 80 &&
    name.trim() === name &&
    !/[\\/\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('.') &&
    !/\.dpx(\.json)?$/i.test(name) &&
    !RESERVED_PROJECT_NAMES.includes(name)
  );
}

/**
 * The area a plan's feature folder moves to on 시작하기 (#1045): the top-level folder (one of `folders`, not 기획)
 * that most files the steps name sit in. A tie gives null; no such file gives `fallback`.
 */
export function planArea(steps, folders, fallback = null) {
  const counts = new Map();
  for (const s of Array.isArray(steps) ? steps : []) {
    for (const f of Array.isArray(s?.files) ? s.files : []) {
      if (typeof f !== 'string' || !f.trim()) continue;
      const top = topFolder(f.trim().replace(/^\.\//, ''));
      if (!top || top === DRAFT_FOLDER || !folders.includes(top)) continue;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
  }
  let best = null;
  let tie = false;
  for (const [name, n] of counts) {
    if (!best || n > counts.get(best)) [best, tie] = [name, false];
    else if (n === counts.get(best)) tie = true;
  }
  if (!best) return fallback;
  return tie ? null : best;
}

/** `<draft folder>/<feature>/<file>` → the feature folder path, else null (only a plan inside a feature folder moves). */
export function draftFeatureFolder(path, draftFolder = DRAFT_FOLDER) {
  const segs = typeof path === 'string' ? path.split('/') : [];
  return segs.length === 3 && segs[0] === draftFolder ? `${segs[0]}/${segs[1]}` : null;
}
