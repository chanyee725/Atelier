// Where a new plan goes (#726, #782): <area>/<feature>/계획.dpx.json. The area is the one write_plan names, else the
// lead's folder, else the one top-level folder every file the plan's steps name sits in. Areas are the workspace's
// top-level folders; a lead picks them from the project's structure (no fixed list) and reuses the ones that exist.
import { readdir } from 'node:fs/promises';
import { topFolder } from '../dispatch/session-folder.js';
import { RESERVED_PROJECT_NAMES } from '../workspace/paths.js';

/** File name of a plan inside its feature folder. */
export const PLAN_FILE_STEM = '계획';

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
 * The top-level folder all files the steps name share, if it is one of `folders`, else null.
 * Steps without files do not count; a file at the root, or files in two folders, give null.
 */
export function inferPlanFolder(steps, folders) {
  const files = (Array.isArray(steps) ? steps : []).flatMap((s) => (Array.isArray(s?.files) ? s.files : [])).filter((f) => typeof f === 'string' && f.trim());
  if (!files.length) return null;
  const tops = new Set(files.map((f) => topFolder(f.trim().replace(/^\.\//, ''))));
  if (tops.size !== 1) return null;
  const [only] = tops;
  return only && folders.includes(only) ? only : null;
}
