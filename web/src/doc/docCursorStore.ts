// Live agent cursors in the document (E529) for the whole page, fed by the same `cursor` events as the canvas
// cursors (canvas/cursorStore.ts). Memory only.
import { useSyncExternalStore } from 'react';
import type { CursorEvent } from '../canvas/agentCursor.ts';
import { now } from '../canvas/cursorStore.ts';
import { applyDocCursor, pruneDocGone, type DocCursor } from './docCursor.ts';

let cursors: ReadonlyMap<string, DocCursor> = new Map();
const subs = new Set<() => void>();
const set = (next: ReadonlyMap<string, DocCursor>) => {
  if (next === cursors) return;
  cursors = next;
  for (const f of subs) f();
};

export const subscribeDocCursors = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** One `cursor` event from the server. */
export function applyDocCursorEvent(e: CursorEvent) {
  set(applyDocCursor(cursors, e, now()));
}

/** Drop cursors that have faded out. */
export function pruneDocCursors(at = now()) {
  set(pruneDocGone(cursors, at));
}

/** A run of `file` ended (or the stream reconnected): no agent is editing it any more. */
export function clearDocCursors(file?: string) {
  let next: Map<string, DocCursor> | null = null;
  for (const [sid, c] of cursors) if (file === undefined || c.file === file) (next ??= new Map(cursors)).delete(sid);
  if (next) set(next);
}

export const docCursorsNow = () => cursors;

export const useDocCursors = () => useSyncExternalStore(subscribeDocCursors, docCursorsNow, docCursorsNow);
