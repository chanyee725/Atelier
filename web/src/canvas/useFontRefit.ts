import { useCallback, useEffect, useState, type RefObject } from 'react';
import { CaptureUpdateAction, newElementWith, restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { refitTexts, type FitEl } from './refit';
import { RefitQueue } from './refitQueue';

/** Texts measured by Excalidraw (it measures only with repairBindings set). */
const measureTexts = (els: FitEl[]) => restoreElements(els as unknown as ExcalidrawElement[], null, { repairBindings: true, refreshDimensions: true }) as unknown as FitEl[];

/** The texts in `ids` measured again; nothing else changes. */
function refit(els: readonly ExcalidrawElement[], ids: Iterable<string>, apply?: (e: FitEl, patch: Partial<FitEl>) => FitEl) {
  return refitTexts(els as unknown as readonly FitEl[], new Set(ids), measureTexts, apply) as unknown as { elements: readonly ExcalidrawElement[]; changed: boolean };
}

/** A measured element as a new version, so it is saved. */
const bumped = (e: FitEl, patch: Partial<FitEl>) => newElementWith(e as unknown as ExcalidrawElement, patch as never) as unknown as FitEl;

/** Whether Excalidraw's copy of the clean font has loaded; until then text is measured with a fallback font. */
const cleanFontLoaded = () => Array.from(document.fonts).some((f) => f.family.replace(/["']/g, '') === 'Liberation Sans' && f.status === 'loaded');

/**
 * Texts that change font are measured in it. Before the clean font has loaded they would be measured with a fallback
 * (and could grow their shape for good), so they wait in a queue and are measured once it is in.
 */
export function useFontRefit(api: ExcalidrawImperativeAPI | null, apiRef: RefObject<ExcalidrawImperativeAPI | null>) {
  // Texts that changed font before the clean font had loaded: measured once it has. One queue per mount
  // (CanvasPane remounts on file switch), cleared on unmount too.
  const [refitLater] = useState(() => new RefitQueue(cleanFontLoaded));
  useEffect(() => () => refitLater.clear(), [refitLater]);
  /** The texts in `ids` measured now if the clean font is in, else queued for refitPending. `bump`: a new version
   * (a paste, saved then); otherwise versions stay (opening writes nothing). */
  const refitNowOrLater = useCallback(
    (els: readonly ExcalidrawElement[], ids: readonly string[], bump: boolean) => {
      if (cleanFontLoaded()) return refit(els, ids, bump ? bumped : undefined).elements;
      refitLater.wait(ids, bump);
      return els;
    },
    [refitLater],
  );
  /** Queued texts that are in `els` now, measured (bumped); null when nothing waits. */
  const refitWaiting = useCallback(
    (els: readonly ExcalidrawElement[]) => (refitLater.size ? (refitLater.take(els as unknown as readonly FitEl[], measureTexts, bumped) as { elements: readonly ExcalidrawElement[]; changed: boolean } | null) : null),
    [refitLater],
  );

  // Excalidraw loads the clean font after the scene is set: texts that changed font before that are measured once it
  // is in. Opened texts keep their versions (the new size is saved with the next edit); pasted ones are bumped.
  // Texts not in the scene yet keep waiting, and handleChange runs the queue again once they are (#305).
  const refitPending = useCallback(() => {
    const xapi = apiRef.current;
    const out = refitLater.take(xapi ? (xapi.getSceneElementsIncludingDeleted() as unknown as readonly FitEl[]) : null, measureTexts, bumped);
    if (xapi && out?.changed) xapi.updateScene({ elements: out.elements as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.NEVER });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refitLater]);
  useEffect(() => {
    document.fonts.addEventListener('loadingdone', refitPending);
    refitPending();
    return () => document.fonts.removeEventListener('loadingdone', refitPending);
  }, [api, refitPending]);

  return { refitNowOrLater, refitWaiting };
}
