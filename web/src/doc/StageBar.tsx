// The scroll bar under a wide diagram in the document (#1043). The stage's own scrollbar is an overlay one on macOS
// and in headless browsers (nothing shows until the user scrolls), so a picture held at its 60% floor looked cut off.
// This bar is always drawn while the picture is wider than the column: the thumb follows the stage's scroll through a
// scroll-driven animation (index.css), dragging it or pressing the track scrolls the stage. Wheel, trackpad and touch
// keep scrolling the stage itself. Hidden from assistive tech: the picture's content is in its alt text and the canvas.
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { barScrollAt, barShare } from './diagramScale';

const cssTimeline = () => typeof CSS !== 'undefined' && CSS.supports('animation-timeline', 'scroll()');

export function StageBar({ stage, pic }: { stage: RefObject<HTMLDivElement | null>; pic: unknown }) {
  const bar = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = stage.current;
    const b = bar.current;
    const t = thumb.current;
    if (!s || !b || !t || !pic) return;
    // Without scroll-driven animations the thumb is moved here, on scroll.
    const fallback = !cssTimeline();
    const place = () => {
      const share = barShare(s.clientWidth, s.scrollWidth);
      b.toggleAttribute('data-shown', share < 1);
      b.style.setProperty('--bar-share', String(share));
      if (fallback) {
        const max = s.scrollWidth - s.clientWidth;
        t.style.transform = `translateX(${(max > 0 ? s.scrollLeft / max : 0) * (1 / share - 1) * 100}%)`;
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(s);
    for (const c of s.children) ro.observe(c);
    if (fallback) s.addEventListener('scroll', place, { passive: true });
    return () => {
      ro.disconnect();
      s.removeEventListener('scroll', place);
    };
  }, [stage, pic]);

  const press = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stage.current;
    const b = bar.current;
    if (!s || !b || e.button !== 0) return;
    e.preventDefault();
    const box = b.getBoundingClientRect();
    // A press on the track jumps there; then (or on the thumb) the stage follows the pointer's travel, scaled from
    // the track to the content.
    if (e.target !== thumb.current) s.scrollLeft = barScrollAt(e.clientX - box.left, box.width, s.clientWidth, s.scrollWidth);
    const x0 = e.clientX;
    const left0 = s.scrollLeft;
    const k = s.scrollWidth / box.width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      s.scrollLeft = left0 + (ev.clientX - x0) * k;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div ref={bar} className="doc-diagram-bar" aria-hidden="true" onPointerDown={press}>
      <div ref={thumb} className="doc-diagram-thumb" />
    </div>
  );
}
