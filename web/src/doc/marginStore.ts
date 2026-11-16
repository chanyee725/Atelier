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
  ago,
  applyMarginEvent,
  blocksOfJson,
  changeLabel,
  clearFile,
  COLLAPSE_KEY,
  doingLines,
  formOf,
  freezePlace,
  marginPhase,
  nextTurnAt,
  PHASE_LABEL,
  placeOf,
  pruneIdle,
  readCollapsed,
  SETTLE_MS,
  type BlockInfo,
  type EditPlace,
  type MarginForm,
  type MarginMap,
  type MarginPhase,
} from './agentMargin.ts';

type Snap = { map: MarginMap; presence: readonly AgentPresence[] };
let snap: Snap = { map: new Map(), presence: [] };
let seq = 0;
let started = false;
const subs = new Set<() => void>();
const put = (next: Partial<Snap>) => {
  if ((next.map ?? snap.map) === snap.map && (next.presence ?? snap.presence) === snap.presence) return;
  snap = { ...snap, ...next };
  for (const f of subs) f();
};
const clock = () => Date.now();

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
  events.subscribeJson<CursorEvent>('cursor', (e) => put({ map: applyMarginEvent(snap.map, e, clock(), ++seq) }));
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
    put({ map: clearFile(snap.map) });
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
export const applyMarginCursor = (e: CursorEvent) => put({ map: applyMarginEvent(snap.map, e, clock(), ++seq) });

// ---- the hook ----

export type MarginChange = {
  id: string;
  /** "02. 화면 지도 · 다이어그램". */
  label: string;
  /** "방금", "12초 전". */
  ago: string;
  at: number;
  spot: DocSpot;
};

export type MarginCard = {
  sid: string;
  name: string;
  role: string;
  roleName?: string;
  /** `#rrggbb`, or '' (use the role colour). */
  color: string;
  /** Model label for display ("Opus 5.5"), null when not known. */
  model: string | null;
  /** claude | openai | gemini, null when not known (ProviderIcon takes it as is). */
  provider: string | null;
  phase: MarginPhase;
  /** "쓰는 중", "생각 중", "기다리는 중". */
  phaseLabel: string;
  /** What it is doing right now, one sentence (the accent line). */
  doing: string;
  /** The step it works on, or what it just changed; null when nothing to add. */
  sub: string | null;
  /** Recent changes, newest first (at most 5). */
  changes: MarginChange[];
};

export type AgentMargin = {
  /** Agents editing this document now, in the order they came. */
  agents: MarginCard[];
  /** The margin is shown (one or more agents). */
  open: boolean;
  form: MarginForm;
  /** Collapsed in this form (remembered per browser). */
  collapsed: boolean;
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

/** Scroll to `spot` in the editor and flash its block (`.doc-margin-flash`), without touching focus or selection. */
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
  el.classList.remove('doc-margin-flash');
  void el.offsetWidth;
  el.classList.add('doc-margin-flash');
  setTimeout(() => el.classList.remove('doc-margin-flash'), 1600);
}

/**
 * The margin of the open document `file`: its agent cards, whether it shows, side panel or bottom sheet (by the
 * container `width`), and the remembered collapse state. `editor` gives the document's blocks for the words.
 */
export function useAgentMargin(file: string, editor: Editor | null, width: number): AgentMargin {
  const { map, presence } = useSyncExternalStore(subscribe, read, read);
  const [now, setNow] = useState(clock);
  // The document's blocks, read again on every editor change (the words follow the text).
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  useEffect(() => {
    if (!editor) return setBlocks([]);
    const read = () => setBlocks(blocksOfJson(editor.getJSON()));
    read();
    editor.on('update', read);
    return () => void editor.off('update', read);
  }, [editor]);

  const mine = useMemo(() => agentsOf(map, file, now), [map, file, now]);
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
      mine.map((a): MarginCard => {
        const live = presence.find((p) => p.sid === a.sid) ?? null;
        const phase = marginPhase(a, now, live);
        const placeOfEdit = (e: (typeof a.edits)[number]): EditPlace | null => e.place ?? placeOf(blocks, e.spot);
        const latest = a.edits[0] ? placeOfEdit(a.edits[0]) : null;
        const lines = doingLines({ phase, place: latest, step: null, tool: live?.activity ?? null });
        return {
          sid: a.sid,
          name: a.name || live?.name || '',
          role: a.role || live?.role || '',
          ...(live?.roleName && { roleName: live.roleName }),
          color: a.color || live?.color || '',
          model: live?.modelLabel || live?.model || null,
          provider: live?.provider || null,
          phase,
          phaseLabel: PHASE_LABEL[phase],
          doing: lines.main,
          sub: lines.sub,
          changes: a.edits.flatMap((e) => {
            const p = placeOfEdit(e);
            return p ? [{ id: e.id, label: changeLabel(p), ago: ago(now - e.at), at: e.at, spot: e.spot }] : [];
          }),
        };
      }),
    [mine, presence, now, blocks],
  );

  const form = formOf(width);
  const [stored, setStored] = useState(readStored);
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
  return { agents, open: agents.length > 0, form, collapsed: stored[form], setCollapsed, jump };
}
