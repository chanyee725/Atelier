// Which project folder a new plan goes into (#726): the folder write_plan names, else the lead's folder, else the
// one top-level folder every file the plan's steps name sits in. Only top-level workspace folders count.
import { readdir } from 'node:fs/promises';
import { topFolder } from '../dispatch/session-folder.js';

/** The workspace's top-level folders as the tree lists them (no hidden folders, no symlinks). */
export async function topFolders(root) {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

/** A top-level folder name write_plan may name: one plain path segment, nothing hidden, no way out of the workspace. */
export function isFolderName(name) {
  return typeof name === 'string' && name.length > 0 && !/[\\/]/.test(name) && !name.startsWith('.') && name.trim() === name;
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
