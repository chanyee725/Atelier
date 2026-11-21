// Live agent cursor model (E56, issue #226): one cursor per agent session that edits the open diagram, placed at the
// centre of what it changed (scene coordinates from the server's `cursor` event), gliding between places with an
// ease-out, then "thinking" near its last edit and fading out. Pure (no React or DOM), so it runs under `node --test`.
// Memory only: nothing here is stored.

/** The `cursor` SSE event (server/cursor/index.js). Without x/y the session is still editing at its last place. */
export type CursorEvent = {
  sid: string;
  gone?: boolean;
  name?: string;
  role?: string;
  /** The session's cursor colour (`#rrggbb`), picked when the session was created (server/dispatch/colors.js). */
  color?: string;
  file?: string;
  x?: number;
  y?: number;
  /** Where in the document the change ends (E529, #619): top-level block index and text offset in it. */
  doc?: { index: number; offset: number };
  /** The session is at work (E536, #653): its cursor stays until a `gone` event, it does not fade. */
  live?: boolean;
  /** Short status label (shared/dispatch/agent-status.ts), e.g. "글 작성 중…". */
  status?: string | null;
  /** The diagram block the change was in (E712, #1039): its id, the first changed code line (1-based), its node. */
  diagram?: DiagramSpot;
};

/** Where in a diagram block an agent wrote (E712, #1039). */
export type DiagramSpot = { id: string; line?: number; node?: string };

/** A diagram place from an event, checked (it goes into lookups and text), or undefined. */
export function diagramSpot(v: unknown): DiagramSpot | undefined {
  const d = v as { id?: unknown; line?: unknown; node?: unknown } | null | undefined;
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id) return undefined;
  const line = typeof d.line === 'number' && Number.isInteger(d.line) && d.line > 0 ? d.line : undefined;
  const node = typeof d.node === 'string' && d.node.trim() ? d.node.trim().slice(0, 60) : undefined;
  return { id: d.id, ...(line ? { line } : {}), ...(node ? { node } : {}) };
}

/** The `cursor-status` SSE event: only the status label of a session changed; its place and edit time stay. */
export type CursorStatusEvent = { sid: string; status?: string | null };

type Pt = { x: number; y: number };

export type Cursor = {
  sid: string;
  name: string;
  role: string;
  /** `#rrggbb`, or '' (the stylesheet's fallback colour). */
  color: string;
  file: string;
  from: Pt;
  to: Pt;
  /** When the current glide started (ms). */
  moveAt: number;
  /** Last edit (ms): drives thinking and fade. */
  editAt: number;
  /** A live session's cursor (E536): it thinks between edits but never fades; a `gone` event removes it. */
  live: boolean;
  /** Short status label shown in the tag, or '' (then the thinking dots show). */
  status: string;
  /** The diagram block of its last placed change (E712), if it was one. */
  diagram?: DiagramSpot;
};

/** Glide length (ms) with an ease-out. */
export const MOVE_MS = 220;
/** No edit for this long: "thinking" near the last edit. */
export const THINK_MS = 1500;
/** No edit for this long: fade out over FADE_MS, then the cursor is gone. */
export const FADE_AFTER_MS = 6000;
export const FADE_MS = 400;

export type Phase = 'editing' | 'thinking' | 'fading' | 'gone';

/** Cubic ease-out: fast start, soft landing. */
export const easeOut = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

/** Where the cursor is drawn at `now`; with reduced motion it jumps straight to its target. */
export function positionAt(c: Cursor, now: number, reduced: boolean): Pt {
  const t = (now - c.moveAt) / MOVE_MS;
  if (reduced || t >= 1) return c.to;
  const k = easeOut(t);
  return { x: c.from.x + (c.to.x - c.from.x) * k, y: c.from.y + (c.to.y - c.from.y) * k };
}

type Timed = { editAt: number; live?: boolean };

export function phaseOf(c: Timed, now: number): Phase {
  const idle = now - c.editAt;
  if (c.live) return idle >= THINK_MS ? 'thinking' : 'editing';
  if (idle >= FADE_AFTER_MS + FADE_MS) return 'gone';
  if (idle >= FADE_AFTER_MS) return 'fading';
  if (idle >= THINK_MS) return 'thinking';
  return 'editing';
}

/** When `c`'s phase next changes after `now` (Infinity once it is gone). */
export function nextPhaseAt(c: Timed, now: number): number {
  for (const d of c.live ? [THINK_MS] : [THINK_MS, FADE_AFTER_MS, FADE_AFTER_MS + FADE_MS]) if (c.editAt + d > now) return c.editAt + d;
  return Infinity;
}

/** Whether `c` is still gliding at `now` (needs animation frames). */
export const moving = (c: Cursor, now: number, reduced: boolean) => !reduced && now - c.moveAt < MOVE_MS;

/** At most this much of a glide passes per drawn frame: a stalled main thread slows a glide instead of skipping it. */
export const MAX_FRAME_MS = 50;
/** A glide first drawn this long after it started is over (the file was not open): it is not replayed. */
export const STALE_GLIDE_MS = 2000;

/** How much of a cursor's current glide has been drawn on screen (kept per session by the layer that draws it). */
export type GlideClock = { moveAt: number; shown: number; last: number };

/**
 * `c` as it is drawn on a visible frame at `now`. Its glide's clock starts at the first frame the cursor is actually
 * drawn, not when the event arrived, and advances at most MAX_FRAME_MS per frame. So a canvas remount (no frames for
 * a while, then hidden while it loads) or a busy main thread cannot use up the glide unseen and make the cursor jump.
 */
export function shownCursor(clocks: Map<string, GlideClock>, c: Cursor, now: number): Cursor {
  let k = clocks.get(c.sid);
  if (!k || k.moveAt !== c.moveAt) {
    k = { moveAt: c.moveAt, shown: now - c.moveAt > STALE_GLIDE_MS ? MOVE_MS : 0, last: now };
    clocks.set(c.sid, k);
  } else {
    k.shown += Math.min(Math.max(now - k.last, 0), MAX_FRAME_MS);
    k.last = now;
  }
  return { ...c, moveAt: now - Math.min(k.shown, MOVE_MS) };
}

/** `c` with its glide where it was last drawn (no clock: its own); for working out where a new glide starts. */
export function lastDrawn(clocks: ReadonlyMap<string, GlideClock>, c: Cursor, now: number): Cursor {
  const k = clocks.get(c.sid);
  return k && k.moveAt === c.moveAt ? { ...c, moveAt: now - Math.min(k.shown, MOVE_MS) } : c;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A colour from the event goes into an inline style: only plain `#rrggbb` passes. */
export const cursorColor = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '');

/** A status label from an event goes into the tag as text: a short single line, or '' (none). */
export const cursorStatus = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '');

/** The status of a cursor after event `e`: the event's (null clears it), else the old one. */
export const statusAfter = (e: { status?: unknown }, old: string | undefined): string =>
  e.status === undefined ? (old ?? '') : cursorStatus(e.status);

/** `sid`'s live cursor stops being live and starts fading out now (the session works elsewhere). */
export function letGoOf<C extends { live: boolean; editAt: number }>(cursors: ReadonlyMap<string, C>, sid: string, now: number): ReadonlyMap<string, C> {
  const old = cursors.get(sid);
  if (!old?.live) return cursors;
  return new Map(cursors).set(sid, { ...old, live: false, editAt: Math.max(old.editAt, now - FADE_AFTER_MS) });
}

/**
 * Apply a `cursor-status` event to any cursor map: only the status label changes (not the place, not editAt, so the
 * phase does not restart). Returns the same map when nothing changed.
 */
export function applyStatus<C extends { status: string }>(cursors: ReadonlyMap<string, C>, e: CursorStatusEvent): ReadonlyMap<string, C> {
  if (!e || typeof e.sid !== 'string') return cursors;
  const old = cursors.get(e.sid);
  if (!old) return cursors;
  const status = cursorStatus(e.status);
  if (old.status === status) return cursors;
  return new Map(cursors).set(e.sid, { ...old, status });
}

/**
 * Apply one event; returns a new map (or the same one when nothing changed). A new place glides from wherever the
 * cursor is drawn now; a cursor that moved to another file, or a first appearance, starts at its target.
 */
export function applyCursor(cursors: ReadonlyMap<string, Cursor>, e: CursorEvent, now: number, reduced: boolean): ReadonlyMap<string, Cursor> {
  if (!e || typeof e.sid !== 'string') return cursors;
  const old = cursors.get(e.sid);
  if (e.gone) {
    if (!old) return cursors;
    const next = new Map(cursors);
    next.delete(e.sid);
    return next;
  }
  const hasPlace = finite(e.x) && finite(e.y);
  const sameFile = !!old && old.file === (e.file ?? old.file);
  // Nothing to place here: a live cursor left behind (the session works elsewhere now) stops being live and fades.
  const letGo = () => letGoOf(cursors, e.sid, now);
  if (!hasPlace && !sameFile) return letGo(); // nothing to show yet
  // A document-only edit (E529) leaves the canvas cursor alone: it fades out while the agent writes in the document.
  if (!hasPlace && e.doc) return letGo();
  const next = new Map(cursors);
  if (!hasPlace) {
    const diagram = diagramSpot(e.diagram) ?? old!.diagram;
    next.set(e.sid, { ...old!, color: cursorColor(e.color) || old!.color, editAt: now, live: e.live ?? old!.live, status: statusAfter(e, old!.status), ...(diagram ? { diagram } : {}) });
    return next;
  }
  const to = { x: e.x!, y: e.y! };
  const from = old && sameFile && phaseOf(old, now) !== 'gone' ? positionAt(old, now, reduced) : to;
  const diagram = diagramSpot(e.diagram);
  next.set(e.sid, {
    sid: e.sid,
    name: e.name ?? old?.name ?? '',
    role: e.role ?? old?.role ?? '',
    color: cursorColor(e.color) || old?.color || '',
    file: e.file ?? old?.file ?? '',
    from,
    to,
    moveAt: now,
    editAt: now,
    live: e.live === true,
    status: statusAfter(e, sameFile ? old?.status : undefined),
    ...(diagram ? { diagram } : {}),
  });
  return next;
}

/** One agent's mark on a line of a diagram's code (the code panel, E712 #1039). */
export type CodeLineMark = { sid: string; name: string; role: string; color: string; status: string; line: number };

/**
 * Agents whose last change was in diagram block `blockId` of `file` and named a code line, and that are still shown
 * at `now` (not gone), in a stable order. One mark per agent: its latest line.
 */
export function codeLineMarks(cursors: ReadonlyMap<string, Cursor>, file: string, blockId: string, now: number): CodeLineMark[] {
  const out: CodeLineMark[] = [];
  for (const c of cursors.values()) {
    const d = c.diagram;
    if (c.file !== file || d?.id !== blockId || !d.line || phaseOf(c, now) === 'gone') continue;
    out.push({ sid: c.sid, name: c.name, role: c.role, color: c.color, status: c.status, line: d.line });
  }
  return out.sort((a, b) => a.line - b.line || a.sid.localeCompare(b.sid));
}

/**
 * applyCursor as the page does it: a new place glides on from where the cursor was last drawn (`clocks`, which may
 * lag the event clock, see shownCursor). An event without a place keeps the glide as it is: rewriting its moveAt
 * would restart the drawn glide from its start.
 */
export function applyCursorDrawn(
  cursors: ReadonlyMap<string, Cursor>,
  clocks: ReadonlyMap<string, GlideClock>,
  e: CursorEvent,
  now: number,
  reduced: boolean,
): ReadonlyMap<string, Cursor> {
  const old = e && typeof e.sid === 'string' ? cursors.get(e.sid) : undefined;
  const hasPlace = !!e && finite(e.x) && finite(e.y);
  const base = old && hasPlace ? new Map(cursors).set(old.sid, lastDrawn(clocks, old, now)) : cursors;
  const next = applyCursor(base, e, now, reduced);
  return next === base ? cursors : next;
}

/** Drop cursors that have faded out; returns the same map when none did. */
export function pruneGone(cursors: ReadonlyMap<string, Cursor>, now: number): ReadonlyMap<string, Cursor> {
  let next: Map<string, Cursor> | null = null;
  for (const [sid, c] of cursors)
    if (phaseOf(c, now) === 'gone') (next ??= new Map(cursors)).delete(sid);
  return next ?? cursors;
}

/** The fields of Excalidraw's app state that place scene points on screen. */
export type ScreenView = { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number };

/** A scene point in the overlay's coordinates (the overlay covers `wrap`, whose page box is `wrapRect`). */
export function toScreen(p: Pt, st: ScreenView, wrapRect: { left: number; top: number }): Pt {
  const z = st.zoom.value;
  return { x: (p.x + st.scrollX) * z + st.offsetLeft - wrapRect.left, y: (p.y + st.scrollY) * z + st.offsetTop - wrapRect.top };
}
