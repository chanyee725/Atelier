import { memo, useCallback } from 'react';
import type { Block } from '../api';
import type { CanvasData, CanvasFocus } from '../canvas/ExcalidrawCanvas';
import { CanvasPane } from '../CanvasPane';
import type { CanvasHandle } from '../export/types';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';
import { NO_BLOCKS } from './noBlocks';
import { usePlanLook } from './usePlanLook';

type CanvasSlotProps = {
  session: FileSession;
  focus: CanvasFocus | null;
  dark: boolean;
  handle: { current: CanvasHandle | null };
  onFail: () => Promise<boolean>;
};
export const CanvasSlot = memo(function CanvasSlot({ session, focus, dark, handle, onFail }: CanvasSlotProps) {
  const fileKey = useSession(session, (s) => (s.file && s.path ? `${s.path}#${s.loadSeq}` : null));
  const canvas = useSession(session, (s) => s.file?.canvas);
  const blocks = useSession(session, (s) => s.file?.blocks ?? NO_BLOCKS);
  const onChange = useCallback((patch: { canvas?: CanvasData; blocks?: Block[] }) => session.edit(patch), [session]);
  const look = usePlanLook(session);
  return <CanvasPane fileKey={fileKey} canvas={canvas} blocks={blocks} focus={focus} dark={dark} onChange={onChange} handle={handle} onFail={onFail} look={look} />;
});
