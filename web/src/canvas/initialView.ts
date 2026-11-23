// Where the canvas looks when a file opens (E494). The first time a file opens in this tab, the view fits every
// shape and block, but never zooms in past 100%, so a small drawing is not blown up. A file that is one diagram or plan
// block alone never opens below 60% (#987); a file with several blocks or free shapes opens with all of them in view
// (#1005). Once the user pans or zooms,
// the file keeps the view they left it at: a reload (another tab, an agent editing the file) or switching back to
// the file does not move it. Until then a reload fits again, so a block an agent adds comes into view; while an agent
// writes, the fit follows the block it added or redrew when the whole file would drop below 60% (#1043). The 둘 다
// pane fits whole down to the same 60% floor, so node labels stay readable (#1048); what does not fit then starts at
// the pane's top-left margin (a flow's first node) and the rest is a drag or scroll away. While an agent writes, the
// pane follows the block it changed the same way.
// The first view Excalidraw reports after an open is the opening view (our fit, or its own default on an empty
// canvas), never the user's (E494b). Any later move counts as the user's, programmatic ones too (focusing a block,
// Excalidraw scrolling while a text is edited near the edge).
// Views live in memory only, per workspace path.

export type View = { scrollX: number; scrollY: number; zoom: number };
/** Scene bounds [minX, minY, maxX, maxY]. */
export type Bounds = readonly [number, number, number, number];

/** Largest zoom of a fitted view: a small drawing stays at its real size. */
export const FIT_MAX_ZOOM = 1;
/**
 * The 둘 다 view fits with a fixed 48px margin, may enlarge a small drawing up to this zoom (#976), and never goes
 * below the readable 60% floor (`pane`, #1048).
 */
export const PANE_FIT = { marginPx: 48, maxZoom: 2, pane: true } as const;
/**
 * `pane` (the 둘 다 pane, #1048): the 60% floor whatever `minZoom` says, and an axis that does not fit at it starts
 * at the margin instead of centred.
 */
export type FitOptions = { marginPx?: number; maxZoom?: number; minZoom?: number; pane?: boolean };
/**
 * Smallest zoom of a fitted view of a lone block (#987): below it the text is too small to read. A wider diagram or
 * plan opens at this zoom, centred, and the rest is a scroll away.
 */
export const FIT_MIN_ZOOM = 0.6;
/** Smallest zoom of a fitted view of several things (#1005): Excalidraw's own lowest zoom, so all of them show. */
export const FIT_ALL_MIN_ZOOM = 0.1;

/**
 * The smallest zoom the first fit may use, from the block id of each live element (null for a free shape): the
 * 60% floor only when everything on the canvas is one block, else the whole file comes into view (#1005).
 */
export function fitMinZoom(blockIds: readonly (string | null)[]): number {
  const first = blockIds[0];
  return first != null && blockIds.every((id) => id === first) ? FIT_MIN_ZOOM : FIT_ALL_MIN_ZOOM;
}
/** Share of the viewport the drawing takes, leaving a margin around it. */
export const FIT_MARGIN = 0.9;
/** Excalidraw's zoom step: fitted zooms are rounded down to it, like its own fit. */
const ZOOM_STEP = 0.1;

/**
 * The view that shows `bounds` whole and centred in a `width`×`height` viewport, or null when there is nothing to
 * fit (no shapes, an empty or hidden viewport). Excalidraw shows scene point p at `(p + scroll) * zoom`.
 */
export function fitView(bounds: Bounds | null, width: number, height: number, opts: FitOptions = {}): View | null {
  if (!bounds || !(width > 0) || !(height > 0)) return null;
  const [x1, y1, x2, y2] = bounds;
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 < x1 || y2 < y1) return null;
  const w = Math.max(x2 - x1, 1);
  const h = Math.max(y2 - y1, 1);
  const m = opts.marginPx;
  // A fixed pixel margin when asked (the viewport must be bigger than it), else a share of the viewport.
  const raw = m !== undefined && width > 2 * m && height > 2 * m ? Math.min((width - 2 * m) / w, (height - 2 * m) / h) : Math.min(width / w, height / h) * FIT_MARGIN;
  const maxZoom = opts.maxZoom ?? FIT_MAX_ZOOM;
  // Rounded down to the step (a hair over a step counts as on it), then kept within the limits.
  const stepped = Math.floor(raw / ZOOM_STEP + 1e-9) * ZOOM_STEP;
  const floor = opts.pane ? FIT_MIN_ZOOM : (opts.minZoom ?? FIT_MIN_ZOOM);
  const zoom = Math.min(maxZoom, Math.max(floor, Number(stepped.toFixed(2))));
  // Centred; in the pane an axis wider than the room at the floor starts at the margin, so the reader sees the start.
  const pad = opts.pane ? (m ?? 0) : 0;
  const start = (size: number, view: number) => opts.pane && size * zoom > view - 2 * pad;
  return {
    zoom,
    scrollX: start(w, width) ? pad / zoom - x1 : width / 2 / zoom - (x1 + x2) / 2,
    scrollY: start(h, height) ? pad / zoom - y1 : height / 2 / zoom - (y1 + y2) / 2,
  };
}

const same = (a: View, b: View) => a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.zoom === b.zoom;

// Path → the view it was last shown at, and whether that is still the view it opened at (the user has not moved
// it). `opening`: opened without a kept view and Excalidraw has not reported the view yet.
const views = new Map<string, { view: View | null; fitted: boolean; opening?: boolean }>();

/** The view the user left `path` at in this tab; null if it was never opened or never moved from its fit. */
export function rememberedView(path: string | undefined): View | null {
  const v = path ? views.get(path) : undefined;
  return v && !v.fitted ? v.view : null;
}

/** Keep the current view of `path`, for its next open (reload, switching back). */
export function rememberView(path: string | undefined, v: View): void {
  if (!path || ![v.scrollX, v.scrollY, v.zoom].every(Number.isFinite) || v.zoom <= 0) return;
  const old = views.get(path);
  const view = { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom };
  // The first view after an open is the one it opened at, whatever Excalidraw made of it.
  if (old?.opening) return void views.set(path, { view, fitted: true });
  if (old?.view && same(old.view, v)) return;
  views.set(path, { view, fitted: false });
}

/** Forget every remembered view (tests). */
export function forgetViews(): void {
  views.clear();
  shownSizes.clear();
}

/**
 * The opening view of `path`: the one the user left it at, else a fit of `bounds`, else null (Excalidraw then
 * centres the content at 100%, as before). Unless it is the user's, the next view reported for `path` is taken
 * as this opening view, not as a move.
 */
export function openingView(path: string | undefined, bounds: Bounds | null, width: number, height: number, opts?: FitOptions, changed?: Bounds | null): View | null {
  const kept = rememberedView(path);
  if (kept) return kept;
  // A reload of a file still at its fit (an agent's change the page could not apply in place) follows the block that
  // changed, like an in-place change (followView); a first open fits as before.
  const fit = changed && path && views.has(path) ? followFit(bounds, changed, width, height, opts) : fitView(bounds, width, height, opts);
  if (path) views.set(path, { view: fit, fitted: true, opening: true });
  return fit;
}

/**
 * The view to switch to when the pane's size changed: a fit of `bounds`, unless the user has moved the view of
 * `path` (it then stays) or the fit is `current` already. The next view reported counts as this fit, not a move.
 */
export function refitView(path: string | undefined, bounds: Bounds | null, width: number, height: number, current: View, opts?: FitOptions): View | null {
  if (!path || rememberedView(path)) return null;
  const fit = fitView(bounds, width, height, opts);
  if (!fit || same(fit, current)) return null;
  views.set(path, { view: fit, fitted: true, opening: true });
  return fit;
}

/**
 * The fit while an agent writes (#1043): everything (`all`) when that fits at the 60% floor or above; else the block
 * that changed (`changed`), at no less than the floor, so the diagram being written stays readable instead of
 * shrinking with the whole file (in the 둘 다 pane it starts at the margin when it is wider, #1048). Without a changed
 * block it is the plain fit of everything.
 */
export function followFit(all: Bounds | null, changed: Bounds | null, width: number, height: number, base: FitOptions = {}): View | null {
  const whole = fitView(all, width, height, { ...base, pane: false, minZoom: FIT_ALL_MIN_ZOOM });
  if (whole && whole.zoom < FIT_MIN_ZOOM && changed) return fitView(changed, width, height, { ...base, minZoom: FIT_MIN_ZOOM });
  return base.pane ? fitView(all, width, height, base) : whole;
}

/**
 * The view to switch to after a block was added or redrawn at another size (an agent writing, #1043), while the view
 * of `path` is still its fit (the user has not moved it): followFit. Null when the user moved the view or the fit is
 * `current` already. The next view reported counts as this fit, not a move.
 */
export function followView(path: string | undefined, all: Bounds | null, changed: Bounds | null, width: number, height: number, current: View, base?: FitOptions): View | null {
  if (!path || rememberedView(path)) return null;
  const fit = followFit(all, changed, width, height, base);
  if (!fit || same(fit, current)) return null;
  views.set(path, { view: fit, fitted: true, opening: true });
  return fit;
}

// Path → block id → its picture's size as last shown, to tell which block an outside change added or redrew.
const shownSizes = new Map<string, Map<string, string>>();

/**
 * The last of `blocks` (id, picture width and height) that is new or changed size since the last call for `path`,
 * or null (nothing changed, or the first call: a first open follows no block). Remembers the sizes for next time.
 */
export function changedBlock(path: string | undefined, blocks: readonly { id: string; width: number; height: number }[]): string | null {
  if (!path) return null;
  const old = shownSizes.get(path);
  const next = new Map(blocks.map((b) => [b.id, `${Math.round(b.width)}x${Math.round(b.height)}`]));
  shownSizes.set(path, next);
  if (!old) return null;
  let hit: string | null = null;
  for (const [id, size] of next) if (old.get(id) !== size) hit = id;
  return hit;
}
