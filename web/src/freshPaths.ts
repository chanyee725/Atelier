// Files and folders that appeared after the page loaded (an agent or another tab created them): their list rows ease in (E520).
// Memory only. The first tree seeds the set, so opening the page animates nothing.

const FRESH_MS = 800;
let seen: Set<string> | null = null;
const fresh = new Map<string, number>();

const collect = (nodes: unknown, out: string[]) => {
  if (!Array.isArray(nodes)) return;
  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    if (typeof o.path === 'string') out.push(o.path);
    for (const v of Object.values(o)) if (Array.isArray(v)) collect(v, out);
  }
};

/** Note the paths of a freshly read file tree (and projects list). */
export function noteTree(...lists: unknown[]): void {
  const paths: string[] = [];
  for (const l of lists) collect(l, paths);
  if (!seen) {
    seen = new Set(paths);
    return;
  }
  const at = Date.now();
  for (const p of paths)
    if (!seen.has(p)) {
      seen.add(p);
      fresh.set(p, at);
    }
}

/** True for a short while after `path` first showed up. */
export function isFresh(path: string, at = Date.now()): boolean {
  const t = fresh.get(path);
  if (t === undefined) return false;
  if (at - t > FRESH_MS) {
    fresh.delete(path);
    return false;
  }
  return true;
}

/** Class for a list row of `path`. */
export const freshClass = (path: string): string => (isFresh(path) ? 'live-row-enter' : '');
