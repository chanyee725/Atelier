// Layout math for the 실행 중인 세션 card (#819): how many session cards go on each row, so no row is left ragged.
// Pure, so node --test checks it without a DOM.

/** Cards a row fits at `width` px: each at least `min` px with `gap` px between them, kept inside 1..max. */
export function colsThatFit(width: number, min: number, gap: number, max: number): number {
  const n = Number.isFinite(width) && min > 0 ? Math.floor((width + gap) / (min + gap)) : 1;
  return Math.min(Math.max(1, max), Math.max(1, n));
}

/**
 * Cards per row for `count` cards at most `cols` a row: the fewest rows, then the cards spread over them as evenly as
 * possible (sizes differ by at most one, the fuller rows first). 4 at 3 a row → [2, 2]; 7 → [3, 2, 2]; 12 → [3, 3, 3, 3].
 */
export function rowSizes(count: number, cols: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (!n) return [];
  const rows = Math.ceil(n / Math.max(1, Math.floor(cols) || 1));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The row size of each card in order, e.g. [3, 2, 2] → [3, 3, 3, 2, 2, 2, 2]. */
export const perCard = (sizes: readonly number[]): number[] => sizes.flatMap((k) => Array.from({ length: k }, () => k));
