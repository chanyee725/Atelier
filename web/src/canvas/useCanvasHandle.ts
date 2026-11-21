import { useEffect, type RefObject } from 'react';
import { exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { Block } from '../api';
import type { CanvasHandle } from '../export/types';
import { DEFAULT_EXPORT, type ExportOptions } from '../export/options';
import { renderBlock, type BlockPicture, type PicTheme } from './render';
import { exportVariants, variantId } from './resolution';
import { blockIdOf, type SceneEl } from './sync';
import { fileData, isGraphType, picTheme, type Edit } from './canvasHelpers';

/** What the handle reads from the canvas; refs, so the handle always sees the current values. */
type Refs = {
  wrap: RefObject<HTMLDivElement | null>;
  /** The theme the pictures on the canvas are drawn in. */
  shownTheme: RefObject<PicTheme>;
  sizes: RefObject<Map<string, BlockPicture>>;
  blocksRef: RefObject<Block[]>;
  editRef: RefObject<Edit | null>;
  selRef: RefObject<string | null>;
  drawnOf: <B extends Block>(b: B) => B;
};
type LayoutActions = { tryEdit: () => Promise<void>; toFreeform: () => Promise<void>; resetLayout: (blockId: string) => void };

/** Fills `handle` while the canvas is mounted. */
export function useCanvasHandle(
  api: ExcalidrawImperativeAPI | null,
  handle: { current: CanvasHandle | null } | undefined,
  { wrap, shownTheme, sizes, blocksRef, editRef, selRef, drawnOf }: Refs,
  { tryEdit, toFreeform, resetLayout }: LayoutActions,
) {
  // What export, the palette and shortcuts can do with this canvas.
  useEffect(() => {
    if (!api || !handle) return;
    // The selection (with the text bound to selected shapes), or everything when nothing is selected.
    const scope = () => {
      const st = api.getAppState();
      const all = api.getSceneElements();
      const picked = all.filter((e) => st.selectedElementIds[e.id]);
      const ids = new Set(picked.map((e) => e.id));
      const sel = picked.length ? all.filter((e) => ids.has(e.id) || (e.type === 'text' && e.containerId && ids.has(e.containerId))) : [];
      return { selected: sel.length > 0, elements: sel.length ? sel : all };
    };
    // Excalidraw inverts the white background itself in dark mode; a transparent export skips the background.
    const opts = (o: ExportOptions) => ({ exportBackground: !o.transparent, viewBackgroundColor: '#ffffff', exportWithDarkMode: o.dark });
    // Block images show the pictures drawn for the canvas theme. A dark export gets the same filter as the dark canvas,
    // so it needs the pre-corrected pictures, a light one the light pictures: swap them in when the canvas differs.
    const forTheme = async (elements: readonly ExcalidrawElement[], dark: boolean) => {
      const want = picTheme(dark);
      if (want === shownTheme.current) return { elements: [...elements], pictureOf: (id: string) => sizes.current.get(id) };
      const byId = new Map(blocksRef.current.map((b) => [b.id, b]));
      const pics = new Map<string, BlockPicture>();
      const out = await Promise.all(
        elements.map(async (el) => {
          const bid = el.type === 'image' ? blockIdOf(el as unknown as SceneEl) : null;
          const b = bid === null ? undefined : byId.get(bid);
          if (!b) return el;
          const p = await renderBlock(drawnOf(b), want);
          pics.set(p.fileId, p);
          return { ...el, fileId: p.fileId as FileId } as ExcalidrawElement;
        }),
      );
      return { elements: out, pictureOf: (id: string) => pics.get(id) };
    };
    handle.current = {
      scope: () => {
        const s = scope();
        return { selected: s.selected, count: s.elements.length };
      },
      svg: async (o = DEFAULT_EXPORT) => {
        const { elements } = scope();
        if (!elements.length) return null;
        const t = await forTheme(elements, o.dark);
        const files = { ...api.getFiles() };
        for (const e of t.elements) {
          const p = e.type === 'image' && e.fileId ? t.pictureOf(e.fileId) : undefined;
          if (p && !files[p.fileId]) files[p.fileId] = fileData(p);
        }
        const el = await exportToSvg({ elements: t.elements, appState: opts(o), files, exportPadding: 16 });
        el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return { svg: new XMLSerializer().serializeToString(el), width: parseFloat(el.getAttribute('width') ?? '0'), height: parseFloat(el.getAttribute('height') ?? '0') };
      },
      png: async (o = DEFAULT_EXPORT) => {
        const { elements } = scope();
        if (!elements.length) return null;
        // Block images carry the variant picked for the view; the export uses the one sharp at its own scale.
        const t = await forTheme(elements, o.dark);
        const ex = exportVariants(t.elements, o.scale, t.pictureOf);
        const files = { ...api.getFiles() };
        for (const { picture, k } of ex.need) {
          const p = t.pictureOf(picture.fileId);
          const id = variantId(picture.fileId, k);
          if (p && !files[id]) files[id] = fileData(p, k);
        }
        return await exportToBlob({ elements: ex.elements, appState: opts(o), files, mimeType: 'image/png', exportPadding: 16, getDimensions: (w: number, h: number) => ({ width: w * o.scale, height: h * o.scale, scale: o.scale }) });
      },
      key: ({ key, code, ctrl, meta, shift, alt }) => {
        const target = wrap.current?.querySelector<HTMLElement>('.excalidraw');
        if (!target) return;
        target.focus({ preventScroll: true });
        target.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: !!ctrl, metaKey: !!meta, shiftKey: !!shift, altKey: !!alt, bubbles: true, cancelable: true }));
      },
      layout: {
        state: () => {
          const id = editRef.current?.blockId ?? selRef.current;
          const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
          return { block: !!b, graph: isGraphType(b?.type), editing: !!editRef.current, moved: !!b?.layout };
        },
        edit: () => void tryEdit(),
        freeform: () => void toFreeform(),
        reset: () => {
          const id = editRef.current?.blockId ?? selRef.current;
          if (id) resetLayout(id);
        },
      },
    };
    return () => {
      handle.current = null;
    };
  }, [api, handle, tryEdit, resetLayout, toFreeform]);
}
