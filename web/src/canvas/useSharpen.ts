import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw';
import type { BinaryFileData, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import type { BlockPicture } from './render';
import { baseFileId, pictureScale, variantId } from './resolution';
import { blockIdOf, type SceneEl } from './sync';
import { fileData } from './canvasHelpers';

/** Keeps block images sharp at the size they cover on screen; returns a check to call with the view signature on every change. */
export function useSharpen(apiRef: RefObject<ExcalidrawImperativeAPI | null>, sizes: RefObject<Map<string, BlockPicture>>) {
  // Block pictures follow the zoom and screen scale: each image shows the variant of its picture that is
  // sharp at the size it covers on screen (resolution.ts). Checked shortly after the view or the images change.
  const sharpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharpenView = useRef('');
  const sharpen = useCallback(() => {
    sharpenTimer.current = null;
    const xapi = apiRef.current;
    if (!xapi) return;
    const zoom = xapi.getAppState().zoom.value;
    const dpr = window.devicePixelRatio || 1;
    const files = xapi.getFiles();
    const add = new Map<string, BinaryFileData>();
    const swaps = new Map<string, string>();
    for (const el of xapi.getSceneElements()) {
      if (el.type !== 'image' || blockIdOf(el as unknown as SceneEl) === null) continue;
      const img = el as ExcalidrawImageElement;
      const p = sizes.current.get(baseFileId(img.fileId ?? ''));
      if (!p) continue;
      const k = pictureScale(Math.max(Math.abs(img.width) / p.width, Math.abs(img.height) / p.height) * zoom * dpr, p.width, p.height);
      const id = variantId(p.fileId, k);
      if (id === img.fileId) continue;
      if (!files[id] && !add.has(id)) add.set(id, fileData(p, k));
      swaps.set(img.id, id);
    }
    if (!swaps.size) return;
    // Decode the new variants before showing them, so a block does not flash its loading placeholder.
    void Promise.all(
      [...add.values()].map((f) => {
        const im = new Image();
        im.src = f.dataURL;
        return im.decode().catch(() => undefined);
      }),
    ).then(() => {
      if (apiRef.current !== xapi) return;
      if (add.size) xapi.addFiles([...add.values()]);
      let changed = false;
      const els = xapi.getSceneElementsIncludingDeleted().map((el) => {
        const id = swaps.get(el.id);
        // Skip an image whose picture changed meanwhile (a code edit); the next check handles it.
        const img = el as ExcalidrawImageElement;
        if (!id || el.isDeleted || baseFileId(img.fileId ?? '') !== baseFileId(id)) return el;
        changed = true;
        return newElementWith(img, { fileId: id as FileId });
      });
      if (changed) xapi.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.NEVER });
    });
  }, []);
  const scheduleSharpen = useCallback(() => {
    if (sharpenTimer.current) clearTimeout(sharpenTimer.current);
    sharpenTimer.current = setTimeout(sharpen, 120);
  }, [sharpen]);
  useEffect(() => {
    window.addEventListener('resize', scheduleSharpen);
    return () => {
      window.removeEventListener('resize', scheduleSharpen);
      if (sharpenTimer.current) clearTimeout(sharpenTimer.current);
    };
  }, [scheduleSharpen]);
  /** Checked again only when the view (zoom, block images and their sizes) changed. */
  return useCallback(
    (view: string) => {
      if (view === sharpenView.current) return;
      sharpenView.current = view;
      scheduleSharpen();
    },
    [scheduleSharpen],
  );
}
