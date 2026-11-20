import { shareAt } from './doc/agentMargin';
import { measureRoom } from './doc/marginRoom';
import { useRef, type ReactNode } from 'react';
import { MAX_SHARE, MIN_SHARE, clampShare, shareAfterKey } from './splitRatio';

type Props = { ratio: number; onRatio: (r: number) => void; onReset: () => void; left: ReactNode; right: ReactNode };

/** Two panes with a draggable divider. `ratio` is the left pane's share (0.3 to 0.7, splitRatio.ts). */
export function Splitter({ ratio, onRatio, onReset, left, right }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const clamp = clampShare;
  // The share when the drag started (shareAt keeps it while the pane sits at the canvas minimum).
  const start = useRef(ratio);
  const onDown = (e: React.PointerEvent) => {
    start.current = ratio;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId) || !box.current) return;
    const r = box.current.getBoundingClientRect();
    // While the agent margin shows (E532), the pane is its share plus the side panel, up to the canvas minimum; pick
    // the share that keeps the divider under the pointer (doc/agentMargin.ts shareAt).
    const x = e.clientX - r.left;
    const host = pane.current?.querySelector<HTMLElement>('.doc-margin[data-margin-mounted]');
    onRatio(clamp(host ? shareAt({ ...measureRoom(host), box: r.width }, x, start.current) : x / r.width));
  };
  return (
    <div ref={box} className="flex min-h-0 flex-1">
      {/* .split-doc: the width is --split, plus the agent margin's while it shows (index.css, E532). */}
      <div ref={pane} className="split-doc min-w-0 overflow-auto" style={{ '--split': `${ratio * 100}%` } as React.CSSProperties}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="문서와 캔버스 사이 분할선"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_SHARE * 100)}
        aria-valuemax={Math.round(MAX_SHARE * 100)}
        aria-valuetext={`문서 ${Math.round(ratio * 100)}%`}
        title="끌어서 비율 바꾸기, 더블클릭하면 처음 비율"
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onDoubleClick={onReset}
        onKeyDown={(e) => {
          const next = shareAfterKey(ratio, e.key, e.shiftKey);
          if (next === null) return;
          e.preventDefault();
          onRatio(next);
        }}
        // A deliberate 1px line at the doc/canvas seam (the dark canvas, ~#121212, can't match the page
        // background, #0a0a0a, through Excalidraw's dark filter). The separator itself is the 6px hit area, laid out
        // between the panes so it covers neither the left pane's scrollbar nor the canvas's left edge (#252); the
        // ::before is the visible line on its canvas side. Forced colors drops backgrounds and box-shadow, so there the
        // line is a CanvasText border and keyboard focus is a Highlight outline.
        className="relative z-10 w-1.5 shrink-0 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:right-0 before:w-px before:bg-border before:transition-colors before:content-[''] hover:before:bg-ring focus-visible:before:bg-ring focus-visible:before:shadow-[0_0_0_1px_var(--ring)] forced-colors:before:border-l forced-colors:before:border-[CanvasText] forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-1 forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-[Highlight]"
      />
      {/* data-split-canvas: the canvas fits its content to this pane (canvas/ExcalidrawCanvas.tsx, #976). */}
      <div data-split-canvas className="min-w-0 flex-1 overflow-auto">
        {right}
      </div>
    </div>
  );
}
