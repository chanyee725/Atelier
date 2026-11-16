// Live agent cursors in the document (E529, issue #619): one caret and name tag per agent session that edits the open
// document, at the place the server reports (`doc: { index, offset }` on the `cursor` event: top-level block and text
// offset in it), gliding between places, then "thinking" and fading out like the canvas cursor (canvas/agentCursor.ts);
// a live session's caret (E536) stays at its last place until the session leaves, with its status in the tag.
// Pure (no React or DOM), so it runs under `node --test`. Memory only: nothing here is stored.
import type { Node as PMNode } from '@tiptap/pm/model';
import { cursorColor, easeOut, letGoOf, phaseOf, statusAfter, type CursorEvent } from '../canvas/agentCursor.ts';

export type DocSpot = { index: number; offset: number };

export type DocCursor = {
  sid: string;
  name: string;
  role: string;
  /** `#rrggbb`, or '' (the stylesheet's fallback colour). */
  color: string;
  file: string;
  spot: DocSpot;
  /** When the session last got a new place (ms): a target that moves soon after glides, later it snaps. */
  moveAt: number;
  /** Last edit (ms): drives thinking and fade (phaseOf). */
  editAt: number;
  /** A live session's caret (E536): it thinks between edits but never fades; a `gone` event removes it. */
  live: boolean;
  /** Short status label shown in the tag, or ''. */
  status: string;
};

/** Glide length (ms) with an ease-out. */
export const DOC_MOVE_MS = 280;
/**
 * The cursor event can arrive before the editor has taken the change in (the file is read after the event): a target
 * that moves within this long of a new place is that change landing, and glides. Later moves come from the user's own
 * typing reflowing the text, and snap.
 */
export const SETTLE_MS = 1500;

const spotOf = (v: unknown): DocSpot | null => {
  const d = v as { index?: unknown; offset?: unknown } | null | undefined;
  if (!d || typeof d !== 'object') return null;
  const { index, offset } = d;
  if (typeof index !== 'number' || typeof offset !== 'number' || !Number.isInteger(index) || !Number.isInteger(offset) || index < 0 || offset < 0) return null;
  return { index, offset };
};

/**
 * Apply one `cursor` event; returns a new map (or the same one when nothing changed). An event with a document place
 * moves (or creates) the session's cursor; one with neither a document nor a canvas place keeps a cursor of the same
 * file alive; `gone` removes it. A canvas-only edit (`x`/`y`, no `doc`) leaves the document cursor alone, so it fades
 * out while the agent works on the canvas instead of looking like it is still writing there.
 */
export function applyDocCursor(cursors: ReadonlyMap<string, DocCursor>, e: CursorEvent, now: number): ReadonlyMap<string, DocCursor> {
  if (!e || typeof e.sid !== 'string') return cursors;
  const old = cursors.get(e.sid);
  if (e.gone) {
    if (!old) return cursors;
    const next = new Map(cursors);
    next.delete(e.sid);
    return next;
  }
  const spot = spotOf(e.doc);
  const file = e.file ?? old?.file ?? '';
  if (!spot) {
    // The session works elsewhere (another file, or the canvas): a live caret left here fades out.
    if (!old || old.file !== file || (Number.isFinite(e.x) && Number.isFinite(e.y))) return letGoOf(cursors, e.sid, now);
    return new Map(cursors).set(e.sid, { ...old, color: cursorColor(e.color) || old.color, editAt: now, live: e.live ?? old.live, status: statusAfter(e, old.status) });
  }
  return new Map(cursors).set(e.sid, {
    sid: e.sid,
    name: e.name ?? old?.name ?? '',
    role: e.role ?? old?.role ?? '',
    color: cursorColor(e.color) || old?.color || '',
    file,
    spot,
    moveAt: now,
    editAt: now,
    live: e.live === true,
    status: statusAfter(e, old?.file === file ? old.status : undefined),
  });
}

/** Drop cursors that have faded out; returns the same map when none did. */
export function pruneDocGone(cursors: ReadonlyMap<string, DocCursor>, now: number): ReadonlyMap<string, DocCursor> {
  let next: Map<string, DocCursor> | null = null;
  for (const [sid, c] of cursors) if (phaseOf(c, now) === 'gone') (next ??= new Map(cursors)).delete(sid);
  return next ?? cursors;
}

/**
 * The editor position of a document place: inside top-level block `index` (clamped to the last block), after
 * `offset` characters of its text nodes (clamped to its end; counted like server/cursor/model.js `blockText`).
 * `atom`: the block holds no text (an embedded diagram, a rule): the position is the block itself.
 * The server counts blocks in the saved JSON; the editor's top-level children are the same blocks in the same order
 * (TipTap's content check refuses a document it would have to rewrite: DocPane shows it as broken, without cursors),
 * plus at most a trailing paragraph after the last one (withTrailingParagraph), so an index never shifts.
 */
export function docPos(doc: PMNode, spot: DocSpot): { pos: number; atom: boolean } | null {
  if (!doc.childCount) return null;
  const index = Math.min(spot.index, doc.childCount - 1);
  let start = 0;
  for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
  const block = doc.child(index);
  if (block.isAtom || block.isLeaf) return { pos: start, atom: true };
  let left = spot.offset;
  let found = -1;
  let last = -1;
  block.descendants((n, p) => {
    if (found >= 0) return false;
    if (!n.isText) return true;
    const len = n.text!.length;
    const at = start + 1 + p;
    if (left <= len) found = at + left;
    else left -= len;
    last = at + len;
    return false;
  });
  if (found >= 0) return { pos: found, atom: false };
  if (last >= 0) return { pos: last, atom: false };
  // A text block without text: its start. A container without text (an empty list): its first text block's start.
  let empty = -1;
  block.descendants((n, p) => {
    if (empty >= 0) return false;
    if (n.isTextblock) empty = start + 1 + p + 1;
    return empty < 0;
  });
  if (empty >= 0) return { pos: empty, atom: false };
  return block.isTextblock ? { pos: start + 1, atom: false } : { pos: start, atom: true };
}

type Pt = { x: number; y: number };
/** Where a cursor is drawn: the glide from `from` to `to` that started at `start`. */
export type DocGlide = { from: Pt; to: Pt; start: number };

/** Point of a glide at `now`; with reduced motion it is at its target. */
export function glideAt(g: DocGlide, now: number, reduced: boolean): Pt {
  const t = (now - g.start) / DOC_MOVE_MS;
  if (reduced || t >= 1) return g.to;
  const k = easeOut(t);
  return { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k };
}

/**
 * The glide after the cursor's target is measured at `target` on a frame at `now`. A first place starts at its target.
 * A target that moved soon after a new place (SETTLE_MS) glides on from where the cursor is drawn now; a later move
 * (the user's typing reflowed the text) or reduced motion snaps.
 */
export function nextGlide(g: DocGlide | undefined, c: Pick<DocCursor, 'moveAt'>, target: Pt, now: number, reduced: boolean): DocGlide {
  if (!g) return { from: target, to: target, start: now - DOC_MOVE_MS };
  if (Math.abs(g.to.x - target.x) < 0.5 && Math.abs(g.to.y - target.y) < 0.5) return g;
  if (reduced || now - c.moveAt > SETTLE_MS) return { from: target, to: target, start: now - DOC_MOVE_MS };
  return { from: glideAt(g, now, false), to: target, start: now };
}

/** Whether a glide still needs animation frames at `now`. */
export const gliding = (g: DocGlide, now: number, reduced: boolean) => !reduced && now - g.start < DOC_MOVE_MS;
