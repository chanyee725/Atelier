// Shared motion constants and helpers for live apply of outside changes (E520, #543): documents, sidebar, canvas and
// diagram previews all use the same 150–300 ms ease-out timing and the same burst coalescing.

/** Enter / move / exit timing, ms. */
export const MOTION_MS = { enter: 220, move: 260, exit: 160, cursorFade: 4000 } as const;
export const MOTION_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Changes that arrive closer together than this are applied as one step. */
export const COALESCE_MS = 120;

/** Clamp a duration into the allowed 150–300 ms window. */
export function clampMotionMs(ms: number): number {
  return Math.min(300, Math.max(150, ms));
}

/** True when the user asked for less motion (false outside a browser). */
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Duration to use now: 0 under reduced motion, otherwise clamped. */
export function motionMs(ms: number, reduced: boolean = prefersReducedMotion()): number {
  return reduced ? 0 : clampMotionMs(ms);
}

export interface Coalescer<T> {
  /** Queue an item; the latest item wins for the same key. */
  push(key: string, item: T): void;
  /** Apply pending items now. */
  flush(): void;
  cancel(): void;
  readonly pending: number;
}

/**
 * Collects items pushed in a burst and hands them to `apply` once, after `delay` ms of quiet (trailing) but at most
 * `maxWait` ms after the first push, so a long stream still shows steady progress without stacking animations.
 * `schedule`/`clear` are injectable for tests.
 */
export function createCoalescer<T>(
  apply: (items: T[]) => void,
  opts: {
    delay?: number;
    maxWait?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
    clear?: (h: unknown) => void;
    now?: () => number;
  } = {},
): Coalescer<T> {
  const delay = opts.delay ?? COALESCE_MS;
  const maxWait = opts.maxWait ?? 600;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.clear ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = opts.now ?? (() => Date.now());
  const items = new Map<string, T>();
  let handle: unknown = null;
  let first = 0;

  const flush = () => {
    if (handle != null) clear(handle);
    handle = null;
    if (items.size === 0) return;
    const batch = [...items.values()];
    items.clear();
    apply(batch);
  };

  return {
    push(key, item) {
      if (items.size === 0) first = now();
      items.set(key, item);
      if (handle != null) clear(handle);
      const wait = Math.max(0, Math.min(delay, first + maxWait - now()));
      handle = schedule(flush, wait);
    },
    flush,
    cancel() {
      if (handle != null) clear(handle);
      handle = null;
      items.clear();
    },
    get pending() {
      return items.size;
    },
  };
}
