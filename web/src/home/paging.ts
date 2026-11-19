// Page math for dashboard lists (#800): the issue list splits into pages instead of running past its card.
// Pure, so it is shared by any issue source (GitHub today, GitLab later) and tested without a DOM.

/** How many pages `total` rows make at `size` rows a page; at least 1, so an empty list is page 1 of 1. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
}

/** `page` (1-based) kept inside 1..pageCount, e.g. after the list shrank under the current page. */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, size));
}

/** The rows on `page` (1-based). */
export function pageSlice<T>(rows: readonly T[], page: number, size: number): T[] {
  const p = clampPage(page, rows.length, size);
  const n = Math.max(1, size);
  return rows.slice((p - 1) * n, p * n);
}

/** Whole rows of `rowHeight` that fit in `space` px, kept inside min..max. */
export function rowsThatFit(space: number, rowHeight: number, min: number, max: number): number {
  const n = Number.isFinite(space) && rowHeight > 0 ? Math.floor(space / rowHeight) : max;
  return Math.min(max, Math.max(min, n));
}

/**
 * Page buttons for a pager: every page up to 7, else the first, the last, the current one with its neighbours,
 * and 'gap' where pages are left out (1 … 4 5 6 … 12).
 */
export function pagerItems(page: number, count: number): (number | 'gap')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const p = Math.min(Math.max(1, page), count);
  const lo = Math.max(2, Math.min(p - 1, count - 4));
  const hi = Math.min(count - 1, Math.max(p + 1, 5));
  const out: (number | 'gap')[] = [1];
  if (lo > 2) out.push('gap');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < count - 1) out.push('gap');
  out.push(count);
  return out;
}
