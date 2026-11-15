// The canvas draws clean, not hand-drawn: Excalidraw's defaults are swapped for the 'architect' look
// (no roughness), Pretendard (Latin + Hangul, bundled), round corners and thin lines.
// Used for new shapes the user draws, shapes from the insert menu, converted diagram blocks (freeform.ts),
// and to tidy shapes that arrive hand-drawn (old files, paste, library).

/**
 * Excalidraw's font id 9, "Liberation Sans". Excalidraw 0.18 cannot register a new family, so the file it loads for
 * this id is replaced by Pretendard Regular (web/vite.config.ts, FONT_OVERRIDES): every text with this id, new or
 * saved by an older build, is drawn, measured and exported in Pretendard.
 */
export const CLEAN_FONT_FAMILY = 9;

/** Excalidraw's handwriting fonts: Virgil (1) and Excalifont (5). */
const HAND_FONTS: ReadonlySet<unknown> = new Set([1, 5]);

/** Size of new free-form text: the size of node text in diagram blocks. Texts already saved keep their own size. */
export const CLEAN_FONT_SIZE = 13;

/**
 * Excalidraw's line height for font id 9 (its FONT_METADATA, which cannot be changed): a 13px line is 14.95 high.
 * Measured (units of 2048): Liberation ascent 1854 / descent 434, Pretendard 1950 / 494 (1.19 em of content; 1.15 is
 * a little tight but Excalidraw clips nothing). Excalidraw's baseline offset still uses Liberation's numbers: 0.6px
 * at 13px.
 */
export const CLEAN_LINE_HEIGHT = 1.15;

/** Starting tool settings for a fresh canvas (`initialData.appState`). */
export const CLEAN_APP_STATE = {
  currentItemRoughness: 0,
  currentItemFontFamily: CLEAN_FONT_FAMILY,
  currentItemFontSize: CLEAN_FONT_SIZE,
  currentItemStrokeWidth: 1,
  currentItemRoundness: 'round' as const,
  currentItemFillStyle: 'solid' as const,
  // Arrows turn at right angles, like the connectors in diagram blocks.
  currentItemArrowType: 'elbow' as const,
};

/**
 * Clean style for an element skeleton (convertToExcalidrawElements), which would otherwise get Excalidraw's
 * hand-drawn defaults (roughness 1, handwriting font, thick lines). Fields the skeleton already sets win.
 */
export function cleanSkeleton(sk: Record<string, unknown>): Record<string, unknown> {
  const base = { roughness: 0, strokeWidth: 1 };
  switch (sk.type) {
    case 'text':
      return { ...base, fontFamily: CLEAN_FONT_FAMILY, fontSize: CLEAN_FONT_SIZE, ...sk };
    case 'rectangle':
      return { ...base, roundness: { type: 3 }, ...sk };
    case 'diamond':
      return { ...base, roundness: { type: 2 }, ...sk };
    case 'arrow':
      return { ...base, elbowed: true, ...sk };
    default:
      return { ...base, ...sk };
  }
}

/** Ids of the texts that were saved in font id 9: measured in a different face then, so they are measured again. */
export function pretendardRefitIds(els: readonly { id: string; type: string; fontFamily?: number; isDeleted?: boolean }[]): string[] {
  return els.filter((e) => e.type === 'text' && e.fontFamily === CLEAN_FONT_FAMILY && !e.isDeleted).map((e) => e.id);
}

type StyleEl = { id: string; type: string; roughness?: number; fontFamily?: number };
type CleanPatch = { roughness?: 0; fontFamily?: number };

/**
 * Hand-drawn shapes made clean: roughness above 0 becomes 0 and handwriting fonts become the clean font.
 * Images are left alone (diagram blocks are images). Returns the same array when nothing needed changing.
 * `apply` builds the changed element; `refit` lists the texts that changed font (their size needs measuring again).
 */
export function cleanElements<T extends StyleEl>(
  els: readonly T[],
  apply: (el: T, patch: CleanPatch) => T = (el, patch) => ({ ...el, ...patch }),
): { elements: readonly T[]; changed: boolean; refit: string[] } {
  let changed = false;
  const refit: string[] = [];
  const elements = els.map((e) => {
    if (e.type === 'image') return e;
    const patch: CleanPatch = {};
    if (typeof e.roughness === 'number' && e.roughness > 0) patch.roughness = 0;
    if (e.type === 'text' && HAND_FONTS.has(e.fontFamily)) {
      patch.fontFamily = CLEAN_FONT_FAMILY;
      refit.push(e.id);
    }
    if (patch.roughness === undefined && patch.fontFamily === undefined) return e;
    changed = true;
    return apply(e, patch);
  });
  return changed ? { elements, changed, refit } : { elements: els, changed, refit };
}
