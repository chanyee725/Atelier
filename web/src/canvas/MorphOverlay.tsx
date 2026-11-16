// Canvas mount of the diagram morph (E520, #543): a MorphLayer over every block image whose code just changed from
// outside, placed with the same frame math as the run board and moved on scroll and zoom only (zoom and pan stay).
// z 3 like RunOverlay: above the drawing, under Excalidraw's toolbar and menus; no pointer events.
import { useEffect, useRef, useState } from 'react';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { Scene } from '../../../shared/render/index.ts';
import { MorphLayer } from './MorphLayer';
import { placeRuns, samePlaced, unplaced, type Pic, type PlaceEl, type Placed } from './runPlace';

/** A block whose picture is turning from `from` into the one now on the canvas. */
export type Morphs = ReadonlyMap<string, { from: Scene; fileId: string }>;

/** The image element is kept at this opacity while its overlay plays (0 would hide it from placement). */
export const MORPH_OPACITY = 1;

type Props = {
  api: ExcalidrawImperativeAPI;
  wrap: HTMLElement;
  morphs: Morphs;
  pictureOf: (fileId: string) => Pic | undefined;
  dark: boolean;
  onDone: (blockId: string) => void;
};

export function MorphOverlay({ api, wrap, morphs, pictureOf, dark, onDone }: Props) {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const frame = useRef(0);
  useEffect(() => {
    if (!morphs.size) {
      setPlaced([]);
      return;
    }
    let last: { els: readonly ExcalidrawElement[]; st: AppState } | null = null;
    const place = () => {
      frame.current = 0;
      if (!last) return;
      const next = placeRuns(last.els as readonly PlaceEl[], last.st, wrap.getBoundingClientRect(), morphs, pictureOf, null);
      setPlaced((old) => (samePlaced(old, next) ? old : next));
      // A block that cannot be placed (rotated, hidden or gone mid-play) gets no layer, so nothing would end its
      // morph and its image would stay at MORPH_OPACITY: end it now (#556).
      for (const b of unplaced(morphs.keys(), next)) onDone(b);
    };
    const queue = (els: readonly ExcalidrawElement[], st: AppState) => {
      last = { els, st };
      if (!frame.current) frame.current = requestAnimationFrame(place);
    };
    last = { els: api.getSceneElements(), st: api.getAppState() };
    place();
    const off = api.onChange(queue);
    return () => {
      off();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [api, wrap, morphs, pictureOf, onDone]);
  if (!placed.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" data-morph-overlay="">
      {placed.map((p) => {
        const m = morphs.get(p.blockId);
        return m ? <MorphLayer key={`${p.blockId}:${m.fileId}`} from={m.from} to={p.scene} dark={dark} left={p.left} top={p.top} scale={p.scale} onDone={() => onDone(p.blockId)} /> : null;
      })}
    </div>
  );
}
