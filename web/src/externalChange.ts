// What the web does with a server `workspace` SSE event (pure, so it can be tested).

export type WorkspaceEvent = { kind: 'create' | 'change' | 'delete' | 'tree'; path: string; from?: string; revision?: number | null };

/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
const stem = (p: string) => p.replace(/\.dpx(\.json)?$/i, '');
const same = (a: string, b: string) => stem(a) === stem(b);

/**
 * - `close`: the open file was deleted or moved away, so its pending save must not run.
 * - `reload`: the open file changed on disk and there is nothing unsaved to lose.
 * - `refresh`: only the file list needs updating (also when the open file changed but has unsaved edits:
 *   its next save gets the 409 choice).
 */
export function externalAction(e: WorkspaceEvent, openPath: string | null, dirty: boolean): 'close' | 'reload' | 'refresh' {
  if (!openPath) return 'refresh';
  if (e.kind === 'delete' && same(e.path, openPath)) return 'close';
  if (e.kind === 'tree' && e.from !== undefined && (same(e.from, openPath) || openPath.startsWith(e.from + '/'))) return 'close';
  if (e.kind === 'change' && same(e.path, openPath)) return dirty ? 'refresh' : 'reload';
  return 'refresh';
}

/**
 * Deep equality of JSON-like values that ignores object key order (a writer that reorders keys has not changed
 * anything, so it must not restart the panes, #557). `undefined` and `null` count as the same, as in JSON.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const y = b as unknown[];
    return a.length === y.length && a.every((v, i) => sameJson(v, y[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  // Keys whose value is undefined are dropped by JSON, so they do not count.
  const kx = Object.keys(x).filter((k) => x[k] !== undefined);
  const ky = Object.keys(y).filter((k) => y[k] !== undefined);
  return kx.length === ky.length && kx.every((k) => Object.hasOwn(y, k) && sameJson(x[k], y[k]));
}
const same_ = sameJson;

type LiveBlock = { id?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; frameId?: unknown };
const placeOf = (b: LiveBlock) => [b.id, b.x, b.y, b.w, b.h, b.frameId ?? null];

/**
 * Can an outside change of the open file be applied in place (panes keep their zoom, scroll and selection) or must the
 * panes restart? In place: the same blocks (same ids) sitting where they were, with only their type, code or layout
 * changed, and the same free-form scene. The document pane diffs its blocks; the canvas and the document previews morph
 * the pictures. Blocks added, removed or moved, or a changed scene, still restart the panes: the canvas reads those
 * only when it mounts, so applying them in place would drop them and its next save would write the old ones back.
 */
export function canApplyLive(cur: { blocks?: unknown; canvas?: unknown } | null | undefined, next: { blocks?: unknown; canvas?: unknown }): boolean {
  if (!cur || !same_(cur.canvas, next.canvas)) return false;
  const a = Array.isArray(cur.blocks) ? (cur.blocks as LiveBlock[]) : [];
  const b = Array.isArray(next.blocks) ? (next.blocks as LiveBlock[]) : [];
  return a.length === b.length && a.every((x, i) => same_(placeOf(x), placeOf(b[i]!)));
}
