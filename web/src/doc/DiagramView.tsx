// How an embedded diagram looks in the document: the block's live picture, read-only.
// Clicking it shows the block on the canvas, where its code is edited.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { Block } from '../api';
import type { Scene } from '../../../shared/render/index';
import type { ImageKind } from '../export/actions';
import { layoutSig } from '../canvas/sync';
import { renderBlock, type BlockPicture } from '../canvas/render';
import { MorphLayer, willMorph } from '../canvas/MorphLayer';
import { createCoalescer } from '../lib/liveMotion';
import { DIAGRAM_TYPES } from '../dsl/templates';
import { RunEta, RunLayer, RunLegend } from '../run/RunLayer';
import { boardShown } from '../run/overlayModel';
import { useRunSteps } from '../run/runStore';
import { DiagramEmbed } from './extensions';
import { createShownMemory } from './shownMemory';
import type { CanvasEl } from './model';

export type DocCtx = {
  /** Workspace path of the open file (keys the last-shown pictures, #557). */
  path: string;
  blocks: Block[];
  /** Canvas frames and what sits in them (see frameScene), for frame embeds. */
  frameScene: CanvasEl[];
  /** Diagram blocks that sit inside a canvas frame, with their canvas position (see App). */
  frameBlocks: Block[];
  dark: boolean;
  onShow: (blockId: string) => void;
  onShowFrame: (frameId: string) => void;
  onExport: (block: Block, kind: ImageKind) => void;
};
export const DocContext = createContext<DocCtx>({ path: '', blocks: [], frameScene: [], frameBlocks: [], dark: false, onShow: () => {}, onShowFrame: () => {}, onExport: () => {} });

// The picture each block showed last (E520), per file (#557).
const lastShown = createShownMemory<BlockPicture>();

export const typeLabel = (type: string) => DIAGRAM_TYPES.find((t) => t.id === type)?.label ?? type;

function DiagramView({ node, selected }: ReactNodeViewProps) {
  const { path, blocks, dark, onShow, onExport } = useContext(DocContext);
  const id = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : '';
  const block = blocks.find((b) => b.id === id);
  const [pic, setPic] = useState<BlockPicture | null>(null);
  const theme = dark ? 'dark' : 'light';
  // An outside code change animates old → new instead of swapping the picture (E520); a burst of pictures shows its
  // last one once. `shown` is what the user sees now.
  const [morph, setMorph] = useState<{ from: Scene; to: Scene; left: number; top: number; scale: number } | null>(null);
  const shown = useRef<BlockPicture | null>(null);
  shown.current = pic;
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const settle = useMemo(
    () =>
      createCoalescer<BlockPicture>(([p]) => {
        const old = shown.current;
        const s = stageRef.current;
        const i = imgRef.current;
        if (old?.scene && p?.scene && old.fileId !== p.fileId && s && i && willMorph(old.scene, p.scene, dark)) {
          const a = s.getBoundingClientRect();
          const b = i.getBoundingClientRect();
          setMorph({ from: old.scene, to: p.scene, left: b.left - a.left, top: b.top - a.top, scale: b.width / old.width });
        } else setMorph(null);
        setPic(p!);
      }),
    [dark],
  );
  useEffect(() => () => settle.cancel(), [settle]);
  const memKey = lastShown.keyOf(path, id, theme);
  const fromMemory = useRef<Scene | null>(null);
  useLayoutEffect(() => {
    if (!pic) return;
    const from = fromMemory.current;
    fromMemory.current = null;
    const s = stageRef.current;
    const i = imgRef.current;
    if (from && pic.scene && s && i && willMorph(from, pic.scene, dark)) {
      const a = s.getBoundingClientRect();
      const b = i.getBoundingClientRect();
      setMorph({ from, to: pic.scene, left: b.left - a.left, top: b.top - a.top, scale: b.width / pic.width });
    }
    lastShown.set(memKey, pic);
  }, [pic, memKey, dark]);
  useEffect(() => {
    if (!block) return;
    let live = true;
    void renderBlock(block, theme).then((p) => {
      if (!live) return;
      if (shown.current) settle.push('pic', p);
      else {
        const mem = lastShown.get(memKey);
        if (mem?.scene && mem.fileId !== p.fileId) fromMemory.current = mem.scene;
        setPic(p);
      }
    });
    return () => {
      live = false;
    };
    // Redraw only when what the picture depends on changes, not when the block moves on the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, block?.type, block?.code, layoutSig(block?.layout), theme]);

  // The progress board sits over the picture as the button's sibling (not inside it: a button holding another button
  // is invalid and its accessible name would swallow the step labels). It follows the img as the column resizes.
  const steps = useRunSteps(block ? id : undefined);
  const stage = stageRef;
  const img = imgRef;
  const [box, setBox] = useState<{ left: number; top: number; scale: number } | null>(null);
  const scene = pic?.scene;
  // The legend shows exactly when the board draws (a step links to a node), the same rule as on the canvas.
  const board = useMemo(() => (steps && scene && boardShown(scene, steps) ? { scene, steps } : null), [steps, scene]);
  useEffect(() => {
    const s = stage.current;
    const i = img.current;
    if (!steps || !scene || !pic || !s || !i) {
      setBox(null);
      return;
    }
    const place = () => {
      const a = s.getBoundingClientRect();
      const b = i.getBoundingClientRect();
      const next = { left: b.left - a.left, top: b.top - a.top, scale: b.width / pic.width };
      setBox((old) => (old && old.left === next.left && old.top === next.top && old.scale === next.scale ? old : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(s);
    ro.observe(i);
    return () => ro.disconnect();
  }, [steps, scene, pic]);

  const label = block ? `${typeLabel(block.type)} 다이어그램` : '다이어그램';
  return (
    <NodeViewWrapper as="figure" className={`doc-diagram${selected ? ' is-selected' : ''}`} data-diagram="" data-block-id={id} contentEditable={false}>
      {block ? (
        <div ref={stage} className="doc-diagram-stage">
          <button type="button" className="doc-diagram-pic" title="캔버스에서 보기" aria-label={`${label}, 캔버스에서 보기`} onClick={() => onShow(id)}>
            {pic ? <img ref={img} src={pic.dataURL} alt={label} width={pic.width} height={pic.height} draggable={false} style={morph ? { visibility: 'hidden' } : undefined} /> : <span className="doc-diagram-wait">그리는 중이에요…</span>}
          </button>
          {morph && <MorphLayer from={morph.from} to={morph.to} dark={dark} left={morph.left} top={morph.top} scale={morph.scale} onDone={() => setMorph(null)} />}
          {board && box && <RunLayer scene={board.scene} steps={board.steps} left={box.left} top={box.top} scale={box.scale} hideEta />}
        </div>
      ) : (
        <p className="doc-diagram-gone">캔버스에서 지운 다이어그램이에요. 이 줄을 지워도 돼요.</p>
      )}
      {block && board && box && <RunEta steps={board.steps} />}
      {block && board && box && <RunLegend steps={board.steps} />}
      <figcaption>{block ? `${label} · 누르면 캔버스로 가요` : label}</figcaption>
      {block && (
        <div className="doc-diagram-actions" role="group" aria-label="다이어그램 내보내기">
          {(
            [
              ['svg', 'SVG'],
              ['png', 'PNG'],
              ['copy', '이미지 복사'],
              ['pdf', 'PDF'],
            ] as const
          ).map(([kind, text]) => (
            <button key={kind} type="button" data-export-block={kind} onClick={() => onExport(block, kind)}>
              {text}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const DiagramEmbedView = DiagramEmbed.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DiagramView);
  },
});
