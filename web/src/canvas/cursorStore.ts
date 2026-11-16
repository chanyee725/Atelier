// Live agent cursors (E56) for the whole page, fed by `cursor` events from the shared event stream. Memory only.
import { useSyncExternalStore } from 'react';
import { applyCursorDrawn, applyStatus, pruneGone, type Cursor, type CursorEvent, type CursorStatusEvent, type GlideClock } from './agentCursor.ts';

let cursors: ReadonlyMap<string, Cursor> = new Map();
/** How much of each cursor's glide has been drawn (AgentCursors). Here, not in the layer: it outlives a remount. */
export const glideClocks = new Map<string, GlideClock>();
const subs = new Set<() => void>();
const set = (next: ReadonlyMap<string, Cursor>) => {
  if (next === cursors) return;
  cursors = next;
  for (const sid of glideClocks.keys()) if (!cursors.has(sid)) glideClocks.delete(sid);
  for (const f of subs) f();
};
/** f() after every change of the cursors; returns an unsubscribe function. */
export const subscribeCursors = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One `cursor` event from the server. */
export function applyCursorEvent(e: CursorEvent) {
  set(applyCursorDrawn(cursors, glideClocks, e, now(), reducedMotion()));
}

/** One `cursor-status` event: the status label changes, the place and phase stay (E536). */
export function applyCursorStatusEvent(e: CursorStatusEvent) {
  set(applyStatus(cursors, e));
}

/** Drop cursors that have faded out. */
export function pruneCursors(at = now()) {
  set(pruneGone(cursors, at));
}

/** A run of `file` ended (or the stream reconnected): no agent is editing it any more. */
export function clearCursors(file?: string) {
  let next: Map<string, Cursor> | null = null;
  for (const [sid, c] of cursors) if (file === undefined || c.file === file) (next ??= new Map(cursors)).delete(sid);
  if (next) set(next);
}

export const cursorsNow = () => cursors;

export const useCursors = () => useSyncExternalStore(subscribeCursors, cursorsNow, cursorsNow);
