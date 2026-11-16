// Document layer for live agent cursors (E529, issue #619): a caret and a name tag in the session's colour at the
// place an agent last wrote in the open document, gliding between places, "thinking", then fading out (canvas twin:
// canvas/AgentCursors.tsx).
//
// It only reads the editor (positions and their screen boxes): it never dispatches, never touches the selection or
// focus, and takes no pointer events, so the user's caret and typing are never in its way. It sits beside the editor,
// not in its contenteditable, and scrolls with the text. One animation-frame loop runs while a cursor glides (a timer
// wakes it for phase changes); editor updates and resizes re-measure, since text above a cursor can move it.
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Editor } from '@tiptap/core';
import { roleLabel } from '../run/overlayModel';
import { nextPhaseAt, phaseOf } from '../canvas/agentCursor';
import { now, reducedMotion } from '../canvas/cursorStore';
import { docPos, glideAt, gliding, nextGlide, type DocCursor, type DocGlide } from './docCursor';
import { docCursorsNow, pruneDocCursors, subscribeDocCursors, useDocCursors } from './docCursorStore';

type Props = { editor: Editor; file: string };

/** Caret box of `c` in the layer's coordinates, or null when it has no place in the document now. */
function measure(editor: Editor, c: DocCursor, origin: DOMRect): { x: number; y: number; h: number } | null {
  const view = editor.view;
  if (!view || (view as { isDestroyed?: boolean }).isDestroyed) return null;
  const at = docPos(view.state.doc, c.spot);
  if (!at) return null;
  try {
    if (at.atom) {
      const el = view.nodeDOM(at.pos);
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, h: Math.min(Math.max(r.height, 16), 24) };
    }
    const r = view.coordsAtPos(at.pos);
    return { x: r.left - origin.left, y: r.top - origin.top, h: Math.max(r.bottom - r.top, 14) };
  } catch {
    // The view is not laid out yet (or the position just went away).
    return null;
  }
}

export function DocAgentCursors({ editor, file }: Props) {
  const all = useDocCursors();
  const mine = useMemo(() => [...all.values()].filter((c) => c.file === file), [all, file]);
  // The loop restarts only when cursors come or go; a new place reaches it through the store.
  const sids = mine.map((c) => c.sid).join(' ');
  const layer = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const glides = useRef(new Map<string, DocGlide>());

  useLayoutEffect(() => {
    if (!sids) {
      glides.current.clear();
      return;
    }
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(timer);
      const box = layer.current;
      if (!box) return;
      const t = now();
      const reduced = reducedMotion();
      const origin = box.getBoundingClientRect();
      let glide = false;
      let wake = Infinity;
      for (const c of docCursorsNow().values()) {
        const el = nodes.current.get(c.sid);
        if (!el || c.file !== file) continue;
        const m = measure(editor, c, origin);
        if (!m) {
          el.style.visibility = 'hidden';
          // Look again soon: the editor may not have taken the change in yet.
          wake = Math.min(wake, t + 100);
          continue;
        }
        const g = nextGlide(glides.current.get(c.sid), c, { x: m.x, y: m.y }, t, reduced);
        glides.current.set(c.sid, g);
        const p = glideAt(g, t, reduced);
        el.style.translate = `${Math.round(p.x * 10) / 10}px ${Math.round(p.y * 10) / 10}px`;
        el.style.setProperty('--caret-h', `${Math.round(m.h)}px`);
        el.style.visibility = '';
        const phase = phaseOf(c, t);
        if (el.dataset.phase !== phase) el.dataset.phase = phase;
        if (gliding(g, t, reduced)) glide = true;
        wake = Math.min(wake, nextPhaseAt(c, t));
      }
      for (const sid of glides.current.keys()) if (!docCursorsNow().has(sid)) glides.current.delete(sid);
      pruneDocCursors(t);
      if (glide) frame = requestAnimationFrame(draw);
      else if (wake < Infinity) timer = setTimeout(draw, Math.max(16, wake - t));
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    // New nodes are in the DOM but not painted yet: place (or hide) them now.
    draw();
    const offStore = subscribeDocCursors(soon);
    // A live change or the user's typing moves text under the cursors; so does a resize of the column.
    editor.on('update', soon);
    editor.on('transaction', soon);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    if (layer.current) ro?.observe(layer.current);
    return () => {
      offStore();
      editor.off('update', soon);
      editor.off('transaction', soon);
      ro?.disconnect();
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, file, sids]);

  if (!mine.length) return null;
  return (
    <div ref={layer} className="doc-agent-cursors" data-doc-agent-cursors="" aria-hidden="true">
      {mine.map((c) => (
        <div
          key={c.sid}
          ref={(el) => {
            if (el) nodes.current.set(c.sid, el);
            else nodes.current.delete(c.sid);
          }}
          className="agent-cursor doc-agent-cursor"
          data-doc-agent-cursor={c.sid}
          data-role={c.role}
          data-phase="editing"
          style={{ visibility: 'hidden', ...(c.color ? ({ '--agent': c.color } as CSSProperties) : {}) }}
        >
          <span className="doc-agent-caret" />
          <span className="agent-cursor-tag">
            {c.name || roleLabel(c.role)}
            <span className="agent-cursor-dots">
              <span />
              <span />
              <span />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
