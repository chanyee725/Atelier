// Agent margin of the document view (E532, issue #622): a page-wide store of who is editing which document, fed by
// the same `cursor` events as the document cursors, cleared when a run ends or the stream reconnects, plus the live
// agent list (`agents`: model, provider, state, tool activity). It subscribes to the shared event stream itself, on
// first use, so App.tsx's event wiring stays as it is. Memory only: nothing is stored but the collapse choice.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { CursorEvent } from '../canvas/agentCursor.ts';
import { events } from '../lib/events';
import { parseAgents, type AgentPresence } from '../home/agents';
import type { DocSpot } from './docCursor.ts';
import {
  agentsOf,
  applyMarginEvent,
  blocksOfJson,
  clearFile,
  COLLAPSE_KEY,
  formOf,
  marginCard,
  freezePlace,
  nextTurnAt,
  placeOf,
  pruneIdle,
  readCollapsed,
  SETTLE_MS,
  type BlockInfo,
  type MarginForm,
  type MarginMap,
  type MarginRoom,
  type MarginCard,
  applyStatus,
  type StatusEvent,
  type Statuses,
} from './agentMargin.ts';

type Snap = { map: MarginMap; presence: readonly AgentPresence[]; statuses: Statuses };
let snap: Snap = { map: new Map(), presence: [], statuses: new Map() };
let seq = 0;
let started = false;
const subs = new Set<() => void>();
const put = (next: Partial<Snap>) => {
  if ((next.map ?? snap.map) === snap.map && (next.presence ?? snap.presence) === snap.presence && (next.statuses ?? snap.statuses) === snap.statuses) return;
  snap = { ...snap, ...next };
  for (const f of subs) f();
};
const clock = () => Date.now();

const onCursor = (e: StatusEvent) => put({ map: applyMarginEvent(snap.map, e, clock(), ++seq), statuses: applyStatus(snap.statuses, e) });

function loadPresence() {
  void fetch('/api/workspace/agents')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d) put({ presence: parseAgents(d) });
    })
    .catch(() => {});
}

/** Starts listening once, for the page's life (one shared EventSource; the store is tiny). */
function start() {
  if (started) return;
  started = true;
  events.subscribeJson<StatusEvent>('cursor', onCursor);
  events.subscribeJson<StatusEvent>('cursor-status', (e) => put({ statuses: applyStatus(snap.statuses, e) }));
  events.subscribeJson<{ file?: string; run?: { endedAt?: number | null } }>('run', (e) => {
    if (e?.run?.endedAt && typeof e.file === 'string') put({ map: clearFile(snap.map, e.file) });
  });
  events.subscribeJson<unknown>('agents', (e) => put({ presence: parseAgents(e) }));
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) {
      first = false;
      return;
    }
    // Events missed while the stream was down: places from before the gap are stale.
    put({ map: clearFile(snap.map), statuses: new Map() });
    loadPresence();
  });
  loadPresence();
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => subs.delete(f);
};
const read = () => snap;

/** For tests and the e2e hook: apply one `cursor` event as if it came from the stream. */
export const applyMarginCursor = (e: StatusEvent) => onCursor(e);

// ---- the hook ----

export type { MarginCard, MarginChange } from './agentMargin.ts';

export type AgentMargin = {
  /** Agents editing this document now, in the order they came. */
  agents: MarginCard[];
  /** The margin is shown (one or more agents). */
  open: boolean;
  form: MarginForm;
  /** Collapsed in this form (remembered per browser). */
  collapsed: boolean;
  /** The side form's collapse state. DocMargin marks it on the page (`data-side-rail`), where measureRoom reads the
   *  rail's width for the room, so the form and the Splitter's drag both count the same panel. */
  sideCollapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Scroll the document to a change and flash it there. */
  jump: (spot: DocSpot) => void;
};

const readStored = () => {
  try {
    return readCollapsed(localStorage.getItem(COLLAPSE_KEY));
  } catch {
    return readCollapsed(null);
  }
};

/** Scroll to `spot` in the editor and flash its block, without touching focus or selection. */
export function jumpTo(editor: Editor | null, spot: DocSpot) {
  const view = editor?.view;
  if (!view || (view as { isDestroyed?: boolean }).isDestroyed) return;
  const top = view.state.doc;
  if (!top.childCount) return;
  const index = Math.min(spot.index, top.childCount - 1);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += top.child(i).nodeSize;
  const el = view.nodeDOM(pos);
  if (!(el instanceof HTMLElement)) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  // Web Animations, not a class: ProseMirror's DOM observer strips attributes it did not render. A colour fade, not
  // a movement, so it plays under reduced motion too.
  el.animate?.([{ backgroundColor: 'color-mix(in oklab, var(--ring) 28%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 1600, easing: 'ease-out' });
}

/**
 * The margin of the open document `file`: its agent cards, whether it shows, side panel or bottom sheet (by the
 * measured `room`, see formOf), and the remembered collapse state. `editor` gives the document's blocks for the words.
 */
export function useAgentMargin(file: string, editor: Editor | null, room: MarginRoom | null): AgentMargin {
  const { map, presence, statuses } = useSyncExternalStore(subscribe, read, read);
  const [now, setNow] = useState(clock);
  // The document's blocks, read again on every editor change (the words follow the text).
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const mine = useMemo(() => agentsOf(map, file, now), [map, file, now]);
  // Only while an agent is here: no reading the whole document on every key otherwise.
  const busy = mine.length > 0;
  useEffect(() => {
    if (!editor || !busy) return setBlocks([]);
    const read = () => setBlocks(blocksOfJson(editor.getJSON()));
    read();
    editor.on('update', read);
    return () => void editor.off('update', read);
  }, [editor, busy]);

  // Wake up when a state turns or an agent leaves; while open, also every 5 s for the "12초 전" times.
  useEffect(() => {
    setNow(clock());
  }, [map]);
  useEffect(() => {
    const t = clock();
    const next = Math.min(nextTurnAt(mine, t), mine.length ? t + 5_000 : Infinity);
    if (next === Infinity) return;
    const id = setTimeout(() => {
      setNow(clock());
      put({ map: pruneIdle(snap.map, clock()) });
    }, Math.max(16, next - t));
    return () => clearTimeout(id);
  }, [mine, now]);

  // Freeze a change's words once it has settled and the editor shows it, so later edits do not rename it.
  useEffect(() => {
    if (!blocks.length) return;
    let next = snap.map;
    let wake = Infinity;
    const t = clock();
    for (const a of mine)
      for (const e of a.edits) {
        if (e.place) continue;
        if (t - e.at < SETTLE_MS) wake = Math.min(wake, e.at + SETTLE_MS);
        else {
          const p = placeOf(blocks, e.spot);
          if (p) next = freezePlace(next, a.sid, e.id, p);
        }
      }
    put({ map: next });
    if (wake === Infinity) return;
    const id = setTimeout(() => setNow(clock()), Math.max(16, wake - t));
    return () => clearTimeout(id);
  }, [mine, blocks]);

  const agents = useMemo(
    () =>
      mine.map((a) => marginCard(a, presence.find((p) => p.sid === a.sid) ?? null, now, blocks, statuses.get(a.sid) ?? null)),
    [mine, presence, statuses, now, blocks],
  );

  const [stored, setStored] = useState(readStored);
  const form: MarginForm = room ? formOf(room) : 'side';
  const setCollapsed = useCallback(
    (v: boolean) =>
      setStored((old) => {
        const next = { ...old, [form]: v };
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
        } catch {
          // Private mode or full storage: the choice lasts for this page only.
        }
        return next;
      }),
    [form],
  );
  const jump = useCallback((spot: DocSpot) => jumpTo(editor, spot), [editor]);
  return { agents, open: agents.length > 0, form, collapsed: stored[form], sideCollapsed: stored.side, setCollapsed, jump };
}
