// The 둘 다 view's doc : canvas split (#976). Pure, so it is tested without a browser.

export const MIN_SHARE = 0.3;
export const MAX_SHARE = 0.7;
/** Document share by default; a plan document gets a bit more room for its step list. */
export const DEFAULT_SHARE = 0.55;
export const PLAN_SHARE = 0.6;
/** One arrow key press; shift moves five times as far. */
export const KEY_STEP = 0.02;
export const STORAGE_KEY = 'atelier.splitShare';

export const clampShare = (r: number): number => (Number.isFinite(r) ? Math.min(MAX_SHARE, Math.max(MIN_SHARE, r)) : DEFAULT_SHARE);

export const defaultShare = (isPlan: boolean): number => (isPlan ? PLAN_SHARE : DEFAULT_SHARE);

/** The share after an arrow key, or null for other keys. Home and End go to the ends of the range. */
export function shareAfterKey(share: number, key: string, shift: boolean): number | null {
  const step = shift ? KEY_STEP * 5 : KEY_STEP;
  if (key === 'ArrowLeft') return clampShare(share - step);
  if (key === 'ArrowRight') return clampShare(share + step);
  if (key === 'Home') return MIN_SHARE;
  if (key === 'End') return MAX_SHARE;
  return null;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const local = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/** The share this browser remembered (clamped), or null when none or storage is unavailable. */
export function loadShare(store: Store | null = local()): number | null {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampShare(n) : null;
  } catch {
    return null;
  }
}

export function saveShare(share: number, store: Store | null = local()): void {
  try {
    store?.setItem(STORAGE_KEY, String(Math.round(clampShare(share) * 1000) / 1000));
  } catch {
    // Storage full or blocked: the ratio is just not remembered.
  }
}
