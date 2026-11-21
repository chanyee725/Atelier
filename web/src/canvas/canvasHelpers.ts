import type { BinaryFileData } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { Block } from '../api';
import type { BlockLayout } from '../../../shared/render/index.ts';
import type { BlockPicture, PicTheme } from './render';
import { scaleSvg, svgDataURL, variantId } from './resolution';
import { blockIdOf, rectOf, type Rect, type SceneEl } from './sync';
import type { EditStart } from './LayoutEditOverlay';
import { sessionKey, type LayoutSession } from './layoutSession';
import { fitMinZoom, type FitOptions } from './initialView';

export const theme = (dark: boolean) => (dark ? 'dark' : 'light') as 'dark' | 'light';
// Excalidraw's dark mode puts a filter over the whole canvas, images included: dark pictures are drawn pre-corrected
// for it (shared/render/darkFilter.ts), so they come out in the dark palette instead of an inverted light one.
export const picTheme = (dark: boolean): PicTheme => (dark ? 'dark-canvas' : 'light');
/** Fit options for `live`: the 60% floor only when it is one block alone (frames do not count), #1005. */
export const fitFor = (live: readonly ExcalidrawElement[], base?: FitOptions): FitOptions => ({
  ...base,
  minZoom: fitMinZoom(live.filter((e) => e.type !== 'frame' && e.type !== 'magicframe').map((e) => blockIdOf(e as unknown as SceneEl))),
});
export const newElId = (blockId: string) => `blk_${blockId}_${Math.random().toString(36).slice(2, 8)}`;
export const liveRects = (els: readonly ExcalidrawElement[]): Rect[] => els.filter((e) => !e.isDeleted).map((e) => rectOf(e));

export const fileData = (p: BlockPicture, k = 1): BinaryFileData => ({
  id: variantId(p.fileId, k) as FileId,
  mimeType: 'image/svg+xml',
  dataURL: (k === 1 ? p.dataURL : svgDataURL(scaleSvg(p.svg, k))) as BinaryFileData['dataURL'],
  created: Date.now(),
});

export const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false as const, saveAsImage: false, toggleTheme: false },
  tools: { image: false },
};
// Web embeds load third-party pages in iframes; the canvas makes no outbound requests.
export const NO_EMBEDS = () => false;

/** The layout session made for one block's code (or why there is none). */
export type Sess = { blockId: string; key: string; s: LayoutSession | { reason: string } };
/** Layout edit mode for a block; `start` is the press that entered it on a node, continued as a drag. */
export type Edit = { blockId: string; start: EditStart | null };
/** `b` is the block as drawn (`drawnBlock`), like the code its session was opened for. */
export const ready = (s: Sess | null, b: Block | undefined): LayoutSession | null => (s && b && s.blockId === b.id && s.key === sessionKey(b) && !('reason' in s.s) ? s.s : null);
export const withLayout = (cd: Record<string, unknown> | undefined, layout: BlockLayout | undefined) => {
  const { layout: _old, ...rest } = cd ?? {};
  return layout ? { ...rest, layout } : rest;
};
export const isGraphType = (type: string | undefined) => type === 'architecture' || type === 'flowchart';
