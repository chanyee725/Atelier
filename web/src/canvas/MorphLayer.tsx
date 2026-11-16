// The overlay that animates an outside code change of a diagram (E520, #543): the old scene turns into the new one
// element by element (diagramMotion.ts), placed exactly over the picture it replaces. The real picture below is
// already the new one but hidden by the caller until `onDone`. Used on the canvas (MorphOverlay) and in the document.
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Scene } from '../../../shared/render/index.ts';
import { prefersReducedMotion } from '../lib/liveMotion.ts';
import { morphMarkup } from './diagramMotion.ts';
import { playMorph } from './morphPlay.ts';

export type MorphProps = {
  from: Scene;
  to: Scene;
  dark: boolean;
  /** Where the picture sits in the positioned parent, and its size relative to scene units. */
  left: number;
  top: number;
  scale: number;
  onDone: () => void;
};

/** Whether `from` → `to` would visibly animate (and the user allows motion). */
export const willMorph = (from: Scene | undefined, to: Scene | undefined, dark: boolean) =>
  !!from && !!to && !prefersReducedMotion() && morphMarkup(from, to, { theme: dark ? 'dark' : 'light' }) !== null;

export function MorphLayer({ from, to, dark, left, top, scale, onDone }: MorphProps) {
  const root = useRef<HTMLDivElement>(null);
  const m = useMemo(() => morphMarkup(from, to, { theme: dark ? 'dark' : 'light' }), [from, to, dark]);
  const done = useRef(onDone);
  done.current = onDone;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !m) {
      done.current();
      return;
    }
    const run = playMorph(el, prefersReducedMotion());
    let live = true;
    void run.done.then(() => live && done.current());
    return () => {
      live = false;
      run.cancel();
    };
  }, [m]);
  if (!m) return null;
  return (
    <div
      ref={root}
      className="pointer-events-none"
      style={{ position: 'absolute', left, top, width: m.width * scale, height: m.height * scale }}
      data-morph-layer=""
      aria-hidden="true"
      // Markup from our own scene renderer, which escapes every text.
      dangerouslySetInnerHTML={{ __html: m.svg.replace('<svg ', '<svg style="width:100%;height:100%;display:block;overflow:visible" ') }}
    />
  );
}
