// Scale limits of a diagram picture in the document (#987). Pure, so the rule is testable without a browser.

/** Largest scale: a small picture (a single node) stays at its real size instead of being blown up to the column. */
export const DOC_MAX_SCALE = 1;
/**
 * Smallest scale: a wide picture (a 12-step plan) shrinks to the column only down to 60%, so its text stays
 * readable; past that it keeps 60% and the block scrolls sideways.
 */
export const DOC_MIN_SCALE = 0.6;

/** CSS width limits of the picture's img: fill the column, clamped to [DOC_MIN_SCALE, DOC_MAX_SCALE] of its size. */
export function docPicWidths(width: number): { minWidth: number; maxWidth: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  return { minWidth: Math.round(w * DOC_MIN_SCALE), maxWidth: w * DOC_MAX_SCALE };
}

/**
 * Whether a picture `width` wide is held at its 60% floor past a stage `stageWidth` wide, so the stage scrolls
 * sideways and gets the end gap (#1005). The gap sits past the picture, so adding it never flips the answer back.
 */
export function stageWide(width: number, stageWidth: number): boolean {
  return stageWidth > 0 && docPicWidths(width).minWidth > stageWidth;
}

type Rect = { left: number; top: number; width: number };

/**
 * Where the picture sits inside the stage, in the stage's content coordinates, and its scale. The stage scrolls
 * sideways when the picture is wider than the column, and the overlay layers are children of the stage, so they
 * move with the scrolled content: the scroll offset is added back to the on-screen distance.
 */
export function picBox(stage: Rect, img: Rect, scroll: { left: number; top: number }, picWidth: number): { left: number; top: number; scale: number } {
  return { left: img.left - stage.left + scroll.left, top: img.top - stage.top + scroll.top, scale: picWidth > 0 ? img.width / picWidth : 1 };
}
