// Local folder projects (E554, docs/design/local-folder-projects.md): browse the server machine's folders by name
// and link one to a new project. Browsing is read-only and lists folder names only: no file names, no file contents,
// no hidden entries (".env", ".git", ...), and symlinks are never followed. Linking writes only inside the workspace
// (a new project folder plus its .project.json); the linked folder itself is never written to.
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { StoreError } from './store.js';
import { PROJECT_META, readProjectMeta } from './projects.js';

// A folder with more sub-folders than this is cut off (the list says so); keeps one response small.
export const MAX_FOLDERS = 2000;
const MAX_PATH = 4096;

// Never forward err.message: it holds absolute paths.
function fsError(err) {
  switch (err?.code) {
    case 'ENOENT':
      return new StoreError(404, 'folder not found');
    case 'ENOTDIR':
      return new StoreError(400, 'not a folder');
    case 'EACCES':
    case 'EPERM':
      return new StoreError(403, 'no permission to read this folder');
    case 'ENAMETOOLONG':
    case 'ELOOP':
      return new StoreError(400, 'bad path');
    default:
      return err;
  }
}

/** An absolute, normalized path from the query, or the home folder when none is given. Relative paths are refused. */
export function parseFolderPath(raw) {
  if (raw == null || raw === '') return homedir();
  if (typeof raw !== 'string' || raw.length > MAX_PATH || raw.includes('\0') || !isAbsolute(raw)) throw new StoreError(400, 'path must be an absolute folder path');
  return resolve(raw);
}

const hidden = (name) => name.startsWith('.');

/**
 * GET /api/local-folders?path=<abs>: { path, parent, home, root, sep, folders: string[], truncated }.
 * `path` is the real path (symlinks in the request resolved), `parent` is null at the filesystem root.
 */
export async function listLocalFolders(raw) {
  const asked = parseFolderPath(raw);
  let path;
  try {
    path = await realpath(asked);
    if (!(await stat(path)).isDirectory()) throw new StoreError(400, 'not a folder');
  } catch (err) {
    throw fsError(err);
  }
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (err) {
    throw fsError(err);
  }
  // Dirent types come from readdir itself: a symlink is reported as a symlink, so it is skipped without being followed.
  const names = entries.filter((e) => e.isDirectory() && !hidden(e.name)).map((e) => e.name);
  names.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    home: homedir(),
    root: parse(path).root,
    sep,
    folders: names.slice(0, MAX_FOLDERS),
    truncated: names.length > MAX_FOLDERS,
  };
}

const inside = (child, parentDir) => {
  const r = relative(parentDir, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

// Same rules as the store's folder names (no hidden names, no slashes, no control chars), Windows-safe too.
function projectFolderName(name) {
  const clean = [...name.replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '')]
    .slice(0, 80)
    .join('')
    .replace(/\.dpx\.json$/i, '');
  return clean || '프로젝트';
}

/**
 * POST /api/workspace/local-project { path }: link a local folder as a new project.
 * Creates <workspace>/<name>/ and its .project.json { name, linkedPath }. 409 when the folder is already linked.
 * Returns { path (workspace project path), name, linkedPath }.
 */
export async function linkLocalFolder(store, raw) {
  if (typeof raw !== 'string' || raw === '') throw new StoreError(400, 'path is required');
  const asked = parseFolderPath(raw);
  let target;
  try {
    target = await realpath(asked);
    if (!(await stat(target)).isDirectory()) throw new StoreError(400, 'not a folder');
  } catch (err) {
    throw fsError(err);
  }
  const ws = await realpath(store.root);
  // The workspace (or a folder in it) is already where projects live; linking it would make a project of itself.
  if (inside(target, ws)) throw new StoreError(400, 'folder is inside the workspace');
  if (parse(target).root === target) throw new StoreError(400, 'cannot link the filesystem root');

  const tree = await store.tree();
  const taken = new Set();
  for (const n of tree) {
    // A root document's stem is taken too: a folder of that name would hold its sub-documents.
    taken.add(n.name.replace(/\.dpx\.json$/, '').toLowerCase());
    if (n.type !== 'folder') continue;
    const meta = await readProjectMeta(join(store.root, n.name));
    if (meta.linkedPath === target) throw Object.assign(new StoreError(409, 'folder is already a project'), { project: n.path });
  }
  const name = projectFolderName(basename(target));
  let folder = name;
  for (let i = 2; taken.has(folder.toLowerCase()); i++) folder = `${name} ${i}`;

  await store.createFolder(folder);
  // A fresh folder the store just made: O_EXCL so nothing there is overwritten, O_NOFOLLOW so a planted link is refused.
  const fh = await open(join(store.root, folder, PROJECT_META), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try {
    await fh.writeFile(JSON.stringify({ name: basename(target) || folder, linkedPath: target }, null, 2) + '\n');
  } finally {
    await fh.close();
  }
  return { path: folder, name: basename(target) || folder, linkedPath: target };
}
