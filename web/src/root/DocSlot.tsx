import { lazy, memo, Suspense, useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import type { Block, TreeNode } from '../api';
import { sameDrawing } from '../canvas/sync';
import { blocksInFrame, frameScene as sceneOf, frameSceneSig, type CanvasEl } from '../doc/model';
import type { ImageKind } from '../export/actions';
import type { FileSession } from '../fileSession';
import { LazyBoundary } from '../LazyBoundary';
import { useSession } from '../useSession';
import { NO_BLOCKS } from './noBlocks';
import { usePlanLook } from './usePlanLook';
import { useSettled } from './useSettled';

// TipTap and the diagram renderer are big; they load when a file is first opened.
const DocPane = lazy(() => import('../DocPane').then((m) => ({ default: m.DocPane })));

// The panes read the file from the session themselves, so a canvas drag or a keystroke in the document
// re-renders only the pane that changed, not the whole app.
type DocSlotProps = {
  session: FileSession;
  dark: boolean;
  tree: TreeNode[];
  jump: { id: string; n: number } | null;
  onOpenFile: (path: string) => void;
  onShow: (blockId: string) => void;
  onShowFrame: (frameId: string) => void;
  onExportBlock: (b: Block, kind: ImageKind) => void;
  onFail: () => Promise<boolean>;
  /** The document's editor, for the agent margin (E532). */
  onEditor?: (editor: Editor | null) => void;
};
const elementsOf = (canvas: unknown): CanvasEl[] => {
  const els = (canvas as { elements?: unknown } | null | undefined)?.elements;
  return Array.isArray(els) ? (els as CanvasEl[]) : [];
};
const inFrames = (blocks: Block[], els: CanvasEl[]): Block[] => {
  const frames = els.filter((e) => !e.isDeleted && (e.type === 'frame' || e.type === 'magicframe'));
  if (!frames.length) return NO_BLOCKS;
  return blocks.filter((b) => frames.some((f) => blocksInFrame({ x: f.x ?? 0, y: f.y ?? 0, width: f.width ?? 0, height: f.height ?? 0 }, [b]).length));
};
const sameFrameBlocks = (a: Block[], b: Block[]) => sameDrawing(a, b) && a.every((x, i) => x.x === b[i].x && x.y === b[i].y && x.w === b[i].w && x.h === b[i].h);
export const DocSlot = memo(function DocSlot({ session, dark, tree, jump, onOpenFile, onShow, onShowFrame, onExportBlock, onFail, onEditor }: DocSlotProps) {
  const path = useSession(session, (s) => s.path ?? '');
  const key = useSession(session, (s) => `${s.path}#${s.loadSeq}`);
  const live = useSession(session, (s) => s.live);
  const remount = useCallback(() => session.remount(), [session]);
  // Blocks as drawn: a new array only when a block's id, type or code changes, not when it moves.
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS, sameDrawing);
  // Frames and their contents: a new array only when one of those changes (not when a block or other drawing does).
  const liveFrameScene = useSession(session, (s) => sceneOf(elementsOf(s.file?.canvas)), (a, b) => frameSceneSig(a) === frameSceneSig(b));
  // Blocks inside a frame, with where they sit: the frame preview draws them (they are not canvas elements).
  const liveFrameBlocks = useSession(session, (s) => inFrames(s.file?.blocks ?? NO_BLOCKS, elementsOf(s.file?.canvas)), sameFrameBlocks);
  // A block dragged inside a frame changes this many times a second; the preview (and the pane's context) follows once it settles.
  // Frames and their blocks settle together, so a moved frame and its blocks never draw out of step.
  const framePair = useMemo(() => ({ scene: liveFrameScene, blocks: liveFrameBlocks }), [liveFrameScene, liveFrameBlocks]);
  const { scene: frameScene, blocks: frameBlocks } = useSettled(framePair, 250, key);
  const getBlocks = useCallback(() => session.getState().file?.blocks ?? NO_BLOCKS, [session]);
  const getCanvas = useCallback(() => session.getState().file?.canvas, [session]);
  const look = usePlanLook(session);
  const onDocument = useCallback((d: unknown) => session.edit({ document: d }), [session]);
  const onBlocks = useCallback((b: Block[]) => session.edit({ blocks: b }), [session]);
  return (
    <LazyBoundary key={key} onFail={onFail}>
      <Suspense
        fallback={
          <p className="p-6 text-sm text-muted-foreground">
            문서를 불러오는 중이에요…
          </p>
        }
      >
        <DocPane
          key={key}
          // Read once when the pane starts (it is remounted per load).
          document={session.getState().file?.document}
          live={live}
          onLiveFail={remount}
          blocks={blocks}
          getBlocks={getBlocks}
          getCanvas={getCanvas}
          dark={dark}
          path={path}
          tree={tree}
          onOpenFile={onOpenFile}
          jump={jump}
          onDocument={onDocument}
          onBlocks={onBlocks}
          onShow={onShow}
          frameScene={frameScene}
          frameBlocks={frameBlocks}
          onShowFrame={onShowFrame}
          onExportBlock={onExportBlock}
          onEditor={onEditor}
          look={look}
        />
      </Suspense>
    </LazyBoundary>
  );
});
