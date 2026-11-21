// `</>` badges on nodes and shapes that carry code (docs/design/code-linked-nodes.md §3), so the click target is
// discoverable. Placed like the run overlay (z 3, under Excalidraw's toolbar and menus) and moved on scroll and zoom
// once per frame. Only the badges take pointer events; a click opens the "기능 코드" panel for that node or shape.
import { useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { placeBadges, sameBadges, type Badge, type BadgeEl, type BlockCodeInfo, type CodeTarget } from './codeLinks';
import type { Scene } from '../../../shared/render/index.ts';

type Props = {
  api: ExcalidrawImperativeAPI;
  wrap: HTMLElement;
  codeOf: (blockId: string) => BlockCodeInfo | undefined;
  pictureOf: (fileId: string) => { width: number; scene?: Scene } | undefined;
  /** Block in layout edit mode: its overlay draws its own badges. */
  hide: string | null;
  /** Changes when blocks' code changes, so badges are placed again without a scene change. */
  version: unknown;
  active: CodeTarget | null;
  onOpen: (t: CodeTarget) => void;
};

export function CodeBadges({ api, wrap, codeOf, pictureOf, hide, version, active, onOpen }: Props) {
  const [badges, setBadges] = useState<Badge[]>([]);
  const frame = useRef(0);
  useEffect(() => {
    let last: { els: readonly unknown[]; st: ReturnType<typeof api.getAppState> } = { els: api.getSceneElements(), st: api.getAppState() };
    const place = () => {
      frame.current = 0;
      const next = placeBadges(last.els as unknown as readonly BadgeEl[], last.st, wrap.getBoundingClientRect(), codeOf, pictureOf, hide);
      setBadges((old) => (sameBadges(old, next) ? old : next));
    };
    place();
    const off = api.onChange((els, st) => {
      last = { els, st };
      if (!frame.current) frame.current = requestAnimationFrame(place);
    });
    return () => {
      off();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [api, wrap, codeOf, pictureOf, hide, version]);
  if (!badges.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" data-code-badges="">
      {badges.map((b) => {
        const t: CodeTarget = b.blockId ? { kind: 'node', blockId: b.blockId, node: b.node } : { kind: 'shape', id: b.node };
        const on = !!active && (active.kind === 'node' ? t.kind === 'node' && active.blockId === t.blockId && active.node === t.node : t.kind === 'shape' && active.id === t.id);
        return <CodeBadge key={`${b.blockId}\n${b.node}`} x={b.x} y={b.y} on={on} label={b.label} onOpen={() => onOpen(t)} />;
      })}
    </div>
  );
}

/** One badge, centred on the box's top-right corner. Also used by the layout edit overlay. */
export function CodeBadge({ x, y, on, label, onOpen }: { x: number; y: number; on: boolean; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-code-badge={label}
      aria-label={`${label} 코드 보기`}
      aria-pressed={on}
      className="pointer-events-auto absolute flex h-4 cursor-pointer -translate-x-1/2 -translate-y-1/2 items-center rounded-[4px] border border-border bg-popover px-1 font-mono text-2xs leading-none text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground aria-pressed:border-blue-500 aria-pressed:text-blue-500"
      style={{ left: x, top: y }}
      // The press must not reach Excalidraw (it would start a box selection under the badge).
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {'</>'}
    </button>
  );
}
