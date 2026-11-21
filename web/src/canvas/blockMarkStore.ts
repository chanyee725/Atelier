// Agent marks in the diagram code panel (E712, issue #1039): the line of a canvas block that a live agent session
// changed, from the `cursor` event's `block` and `line`. A mark stays while that session works on the block: it goes
// when the session leaves (`gone`), moves to another place, or the stream reconnects. Memory only.
import { useSyncExternalStore } from 'react';
import { cursorColor, type CursorEvent } from './agentCursor.ts';

export type BlockMark = { sid: string; name: string; color: string; file: string; line: number };

let marks: ReadonlyMap<string, BlockMark> = new Map(); // block id -> mark (one session per block at a time)
const subs = new Set<() => void>();
const set = (next: ReadonlyMap<string, BlockMark>) => {
  if (next === marks) return;
  marks = next;
  for (const f of subs) f();
};

/** One `cursor` event: a session that changed a block's code marks its line; any other place of it removes its mark. */
export function applyBlockMark(e: CursorEvent) {
  if (!e || typeof e.sid !== 'string') return;
  const next = new Map<string, BlockMark>();
  for (const [id, m] of marks) if (m.sid !== e.sid) next.set(id, m);
  const moved = next.size !== marks.size;
  const line = e.line;
  if (!e.gone && typeof e.block === 'string' && e.block && Number.isInteger(line) && line! >= 1) {
    next.set(e.block, { sid: e.sid, name: e.name ?? '', color: cursorColor(e.color), file: e.file ?? '', line: line! });
    set(next);
  } else if (moved) set(next);
}

/** Forget every mark (the stream reconnected: the server sends the live cursors again). */
export function clearBlockMarks() {
  if (marks.size) set(new Map());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** The agent mark on block `block` of `file`, or null. */
export function markOf(file: string, block: string): BlockMark | null {
  const m = marks.get(block);
  return m && m.file === file ? m : null;
}

/** markOf, live: the code panel re-renders when a mark comes or goes. */
export function useBlockMark(file: string, block: string): BlockMark | null {
  return useSyncExternalStore(subscribe, () => markOf(file, block));
}
