// Agent activity margin of the document view (E532, issue #622): which agent sessions are editing the open document
// right now, their state (writing, thinking, waiting) and what each one is doing in plain words, plus a short list of
// its recent changes. Fed by the same `cursor` events as the document cursors (E529, doc/docCursor.ts): the place is
// `doc: { index, offset }` (top-level block, text offset in it). Pure (no React or DOM), so it runs under
// `node --test`. Memory only: nothing here is stored, and no transcript is read.
import { cursorColor, type CursorEvent } from '../canvas/agentCursor.ts';
import type { DocSpot } from './docCursor.ts';
import { agentStatus, type AgentTarget } from '../../../shared/dispatch/agent-status.ts';

/** No edit to the file for this long: the agent leaves the margin (and with the last one the margin closes). */
export const IDLE_MS = 20_000;
/** An edit within this long: the agent is "writing"; later it is "thinking" until IDLE_MS. */
export const WRITING_MS = 4_000;
/** Recent changes kept per agent. */
export const RECENT_MAX = 5;
/** Another edit of the same block within this long updates the last change instead of adding one. */
export const MERGE_MS = 15_000;
/** A change's words are frozen this long after it, once the editor has taken the change in. */
export const SETTLE_MS = 1_500;

export type MarginEdit = {
  id: string;
  at: number;
  spot: DocSpot;
  /** Frozen words for the list and the "doing" line (set once the document shows the change). */
  place?: EditPlace;
};

export type MarginAgent = {
  sid: string;
  name: string;
  role: string;
  /** `#rrggbb`, or '' (the stylesheet's role colour). */
  color: string;
  file: string;
  /** First edit seen in this stay (keeps the cards in a stable order). */
  firstAt: number;
  /** Last edit of the file (ms). */
  editAt: number;
  /** Newest first, at most RECENT_MAX. */
  edits: readonly MarginEdit[];
};

export type MarginMap = ReadonlyMap<string, MarginAgent>;

const spotOf = (v: unknown): DocSpot | null => {
  const d = v as { index?: unknown; offset?: unknown } | null | undefined;
  if (!d || typeof d !== 'object') return null;
  const { index, offset } = d;
  if (!Number.isInteger(index) || !Number.isInteger(offset) || (index as number) < 0 || (offset as number) < 0) return null;
  return { index: index as number, offset: offset as number };
};

/** Session id -> its latest status label from `cursor` / `cursor-status` events (#653). Memory only. */
export type Statuses = ReadonlyMap<string, string>;
/** A cursor event as #653 sends it: `status` on edits, and `cursor-status` { sid, status } between them. */
export type StatusEvent = CursorEvent & { status?: string | null };
/** The status map after one event (the same map when nothing changed). */
export function applyStatus(map: Statuses, e: StatusEvent | null | undefined): Statuses {
  if (!e || typeof e.sid !== 'string' || !e.sid) return map;
  if (e.gone || e.status === null) {
    if (!map.has(e.sid)) return map;
    const next = new Map(map);
    next.delete(e.sid);
    return next;
  }
  if (typeof e.status !== 'string' || !e.status || map.get(e.sid) === e.status) return map;
  return new Map(map).set(e.sid, e.status.slice(0, 40));
}

/**
 * Apply one `cursor` event (returns the same map when nothing changed). A document place adds a change (or updates
 * the last one when it is the same block, shortly after); an event of the same file without a place (a canvas edit)
 * keeps the agent awake; `gone` removes it. `seq` makes change ids unique.
 */
export function applyMarginEvent(map: MarginMap, e: CursorEvent, now: number, seq: number): MarginMap {
  if (!e || typeof e.sid !== 'string' || !e.sid) return map;
  const old = map.get(e.sid);
  if (e.gone) {
    if (!old) return map;
    const next = new Map(map);
    next.delete(e.sid);
    return next;
  }
  const spot = spotOf(e.doc);
  const file = typeof e.file === 'string' ? e.file : '';
  if (!spot) {
    if (!old || !file || old.file !== file) return map;
    return new Map(map).set(e.sid, { ...old, editAt: now });
  }
  if (!file) return map;
  // Same stay: same file and not idle yet. Otherwise a fresh card.
  const stay = old && old.file === file && now - old.editAt < IDLE_MS ? old : null;
  const edits = stay?.edits ?? [];
  const last = edits[0];
  const merged = last && last.spot.index === spot.index && now - last.at < MERGE_MS;
  const edit: MarginEdit = { id: merged ? last.id : `${e.sid}:${seq}`, at: now, spot };
  const nextEdits = merged ? [edit, ...edits.slice(1)] : [edit, ...edits].slice(0, RECENT_MAX);
  return new Map(map).set(e.sid, {
    sid: e.sid,
    name: e.name ?? stay?.name ?? old?.name ?? '',
    role: e.role ?? stay?.role ?? old?.role ?? '',
    color: cursorColor(e.color) || old?.color || '',
    file,
    firstAt: stay?.firstAt ?? now,
    editAt: now,
    edits: nextEdits,
  });
}

/** Freeze the words of one change (returns the same map when the change is gone or already has them). */
export function freezePlace(map: MarginMap, sid: string, id: string, place: EditPlace): MarginMap {
  const a = map.get(sid);
  const i = a?.edits.findIndex((x) => x.id === id) ?? -1;
  if (!a || i < 0 || a.edits[i].place) return map;
  const edits = a.edits.map((x, j) => (j === i ? { ...x, place } : x));
  return new Map(map).set(sid, { ...a, edits });
}

/** Agents of `file` (none for another file), in the order they came, without those idle at `now`. */
export function agentsOf(map: MarginMap, file: string, now: number): MarginAgent[] {
  return [...map.values()].filter((a) => a.file === file && now - a.editAt < IDLE_MS).sort((a, b) => a.firstAt - b.firstAt || a.sid.localeCompare(b.sid));
}

/** Drop agents idle at `now` (returns the same map when none are). */
export function pruneIdle(map: MarginMap, now: number): MarginMap {
  let next: Map<string, MarginAgent> | null = null;
  for (const [sid, a] of map) if (now - a.editAt >= IDLE_MS) (next ??= new Map(map)).delete(sid);
  return next ?? map;
}

/** Drop the agents of `file` (all without one): its run ended, or the event stream reconnected. */
export function clearFile(map: MarginMap, file?: string): MarginMap {
  let next: Map<string, MarginAgent> | null = null;
  for (const [sid, a] of map) if (file === undefined || a.file === file) (next ??= new Map(map)).delete(sid);
  return next ?? map;
}

/** When the margin's view next changes on its own (a state turns, an agent leaves); Infinity when never. */
export function nextTurnAt(agents: readonly Pick<MarginAgent, 'editAt'>[], now: number): number {
  let t = Infinity;
  for (const a of agents) for (const d of [WRITING_MS, IDLE_MS]) if (a.editAt + d > now) t = Math.min(t, a.editAt + d);
  return t;
}

// ---- state ----

export type MarginPhase = 'writing' | 'thinking' | 'waiting';

export const PHASE_LABEL: Record<MarginPhase, string> = { writing: '쓰는 중', thinking: '생각 중', waiting: '기다리는 중' };

/**
 * Writing right after an edit; waiting when the session waits on a person (its monitoring state, else its hub
 * status); thinking otherwise.
 */
export function marginPhase(a: Pick<MarginAgent, 'editAt'>, now: number, live?: { status?: string; state?: string | null } | null): MarginPhase {
  if (now - a.editAt < WRITING_MS) return 'writing';
  if (live && (live.state ? live.state === 'waiting' : live.status === 'waiting')) return 'waiting';
  return 'thinking';
}

// ---- what it is doing ----

/** A top-level block of the document as the summary reads it. */
export type BlockInfo = { type: string; text: string; level?: number };

export type EditKind = 'heading' | 'text' | 'table' | 'diagram' | 'frame' | 'list' | 'tasks' | 'code' | 'quote' | 'rule' | 'image' | 'other';

/** Where a change landed, in words: the section (the heading at or above it), what kind of block, and whether it wrote at the end. */
export type EditPlace = { section: string | null; kind: EditKind; atEnd: boolean; heading?: string };

const KIND: Record<string, EditKind> = {
  heading: 'heading',
  paragraph: 'text',
  table: 'table',
  diagram: 'diagram',
  frameEmbed: 'frame',
  bulletList: 'list',
  orderedList: 'list',
  taskList: 'tasks',
  codeBlock: 'code',
  blockquote: 'quote',
  horizontalRule: 'rule',
  image: 'image',
};

/** Longest section or heading text shown, in characters. */
export const TITLE_MAX = 28;
export const clip = (s: string, max = TITLE_MAX) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const cs = [...t];
  return cs.length > max ? `${cs.slice(0, max - 1).join('').trimEnd()}…` : t;
};

/** The place of a change at `spot` in `blocks` (the document as it is now); null when the block is not there (yet). */
export function placeOf(blocks: readonly BlockInfo[], spot: DocSpot): EditPlace | null {
  if (!blocks.length) return null;
  const index = Math.min(spot.index, blocks.length - 1);
  const b = blocks[index];
  const kind = KIND[b.type] ?? 'other';
  let section: string | null = null;
  for (let i = kind === 'heading' ? index - 1 : index; i >= 0; i--) {
    if (blocks[i].type === 'heading' && blocks[i].text.trim()) {
      section = clip(blocks[i].text);
      break;
    }
  }
  const atEnd = spot.offset >= b.text.length;
  return kind === 'heading' ? { section, kind, atEnd, heading: clip(b.text) } : { section, kind, atEnd };
}

/** The thing changed, with its object particle, for the sentence ("표를"). */
const OBJECT: Record<Exclude<EditKind, 'heading'>, string> = {
  text: '글을',
  table: '표를',
  diagram: '다이어그램을',
  frame: '프레임을',
  list: '목록을',
  tasks: '할 일 목록을',
  code: '코드를',
  quote: '인용문을',
  rule: '구분선을',
  image: '그림을',
  other: '내용을',
};
/** Its short name, for the recent-changes list. */
const NOUN: Record<EditKind, string> = {
  heading: '제목',
  text: '글',
  table: '표',
  diagram: '다이어그램',
  frame: '프레임',
  list: '목록',
  tasks: '할 일 목록',
  code: '코드',
  quote: '인용문',
  rule: '구분선',
  image: '그림',
  other: '내용',
};
/** Blocks that are put in whole (no text to write into): always "added". */
const WHOLE = new Set<EditKind>(['diagram', 'frame', 'rule', 'image']);

/**
 * What the agent is doing at `place`, as one plain sentence ("02. 화면 지도 섹션에 다이어그램을 추가하는 중"). Writing
 * at the end of a text block (or putting in a whole block) counts as adding; a change inside counts as fixing.
 */
export function editSentence(place: EditPlace): string {
  if (place.kind === 'heading') {
    if (!place.heading) return '새 제목을 쓰는 중';
    return `‘${place.heading}’ 제목을 ${place.atEnd ? '쓰는' : '고치는'} 중`;
  }
  const where = place.section ? `${place.section} 섹션` : '문서 첫머리';
  const obj = OBJECT[place.kind];
  if (WHOLE.has(place.kind)) return `${where}에 ${obj} 추가하는 중`;
  if (!place.atEnd) return `${where}의 ${obj} 고치는 중`;
  if (place.kind === 'table') return `${where}의 표를 채우는 중`;
  if (place.kind === 'text' || place.kind === 'list' || place.kind === 'tasks') return `${where}에 ${obj} 쓰는 중`;
  return `${where}에 ${obj} 추가하는 중`;
}

/** A change in the recent list: "02. 화면 지도 · 다이어그램"; a heading names itself. */
export function changeLabel(place: EditPlace): string {
  if (place.kind === 'heading') return `제목 · ${place.heading || '새 제목'}`;
  return `${place.section ?? '문서 첫머리'} · ${NOUN[place.kind]}`;
}

/** A tool activity label from the session ("코드 읽기", "e2e 실행") as a "-ing" line. */
export function toolSentence(label: string): string {
  const t = clip(label, 32);
  return /중$/.test(t) ? t : `${t} 중`;
}

/**
 * The two lines of a card: `main`, what it is doing right now in plain words, and `sub`, the step it works on.
 * Writing: from its latest change. Thinking: its tool activity if there is one, else its latest change. Waiting: it
 * waits for a person.
 */
export function doingLines(input: { phase: MarginPhase; place?: EditPlace | null; step?: string | null; tool?: string | null }): { main: string; sub: string | null } {
  const { phase, place, step, tool } = input;
  const sub = step ? `단계: ${clip(step, 40)}` : null;
  if (phase === 'waiting') return { main: '사람의 답을 기다리는 중', sub };
  if (phase === 'writing' && place) return { main: editSentence(place), sub };
  if (tool) return { main: toolSentence(tool), sub: sub ?? (place ? `방금: ${changeLabel(place)}` : null) };
  if (place) return { main: editSentence(place), sub };
  return { main: phase === 'writing' ? '문서를 고치는 중' : '다음 할 일을 생각하는 중', sub };
}

/** How long ago, short: "방금", "12초 전", "3분 전". */
export function ago(ms: number): string {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  return `${Math.floor(s / 60)}분 전`;
}

/** The step a session (by name) works on now: an active step whose agents include it, in any shown run. */
export function stepOf(name: string, runs: Iterable<readonly { title?: string; view: string; agents?: readonly { name: string }[] }[]>): string | null {
  if (!name) return null;
  for (const steps of runs) for (const s of steps) if (s.view === 'active' && s.title && s.agents?.some((a) => a.name === name)) return s.title;
  return null;
}

/** The document's top-level blocks as the summary reads them, from ProseMirror JSON (`editor.getJSON()`). */
export function blocksOfJson(doc: unknown): BlockInfo[] {
  const c = (doc as { content?: unknown } | null)?.content;
  if (!Array.isArray(c)) return [];
  const text = (n: unknown): string => {
    const o = n as { type?: string; text?: unknown; content?: unknown } | null;
    if (!o || typeof o !== 'object') return '';
    if (o.type === 'text') return typeof o.text === 'string' ? o.text : '';
    return Array.isArray(o.content) ? o.content.map(text).join('') : '';
  };
  return c.map((b) => {
    const o = b as { type?: unknown; attrs?: { level?: unknown } } | null;
    const type = typeof o?.type === 'string' ? o.type : '';
    const level = typeof o?.attrs?.level === 'number' ? o.attrs.level : undefined;
    return level !== undefined && type === 'heading' ? { type, text: text(b), level } : { type, text: text(b) };
  });
}

// ---- the card ----

/** What the live agent list (shared/dispatch/agent-presence.ts) adds to a card. */
export type LiveAgent = {
  name?: string;
  role?: string;
  roleName?: string;
  color?: string;
  model?: string | null;
  modelLabel?: string;
  provider?: string;
  status?: string;
  state?: string | null;
  activity?: string;
  step?: string;
  /** Short status label the server worked out (presence `statusLabel`, shared/dispatch/agent-status.ts). */
  statusLabel?: string;
};

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
  /** The status line: "다이어그램 작성 중…", "대기 중" (shared/dispatch/agent-status.ts); the phase label as a last resort. */
  status: string;
  /** What it is doing right now and where (its current target), one sentence. */
  doing: string;
  /** The step it works on, or what it just changed; null when nothing to add. */
  sub: string | null;
  /** Recent changes, newest first (at most 5). */
  changes: MarginChange[];
};

/** The agent-status target of a change's block kind: a diagram, a table, else the document text. */
export const statusTarget = (kind: EditKind | null | undefined): AgentTarget =>
  kind == null ? null : kind === 'diagram' || kind === 'frame' ? 'diagram' : kind === 'table' ? 'table' : 'doc';

/**
 * The status line of a card (E537, #654): the cursor event's `status` first, then the live list's `statusLabel`, else
 * worked out from the hub status and the kind of its latest change (no tool known here).
 */
export function cardStatus(input: { phase: MarginPhase; event?: string | null; live?: LiveAgent | null; kind?: EditKind | null }): string {
  const { phase, event, live, kind } = input;
  if (event) return event;
  if (live?.statusLabel) return live.statusLabel;
  const hub = phase === 'waiting' ? 'waiting' : live?.status ?? 'running';
  return agentStatus({ status: hub, tool: null, target: statusTarget(kind) }) ?? PHASE_LABEL[phase];
}

/**
 * One agent's card at `now`: state, what it is doing (its latest change in `blocks`, its tool activity, the pipeline
 * step it works on) and its recent changes. Frozen words win over the document as it is now. `status`: the latest
 * status label from its cursor events (null when none came).
 */
export function marginCard(a: MarginAgent, live: LiveAgent | null, now: number, blocks: readonly BlockInfo[], status: string | null = null): MarginCard {
  const phase = marginPhase(a, now, live);
  const placeOfEdit = (e: MarginEdit): EditPlace | null => e.place ?? placeOf(blocks, e.spot);
  const latest = a.edits[0] ? placeOfEdit(a.edits[0]) : null;
  const lines = doingLines({ phase, place: latest, step: live?.step ?? null, tool: live?.activity ?? null });
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
    status: cardStatus({ phase, event: status, live, kind: latest?.kind }),
    doing: lines.main,
    sub: lines.sub,
    changes: a.edits.flatMap((e) => {
      const p = placeOfEdit(e);
      return p ? [{ id: e.id, label: changeLabel(p), ago: ago(now - e.at), at: e.at, spot: e.spot }] : [];
    }),
  };
}

// ---- layout ----

/** Narrowest text column (px) the side panel may leave beside it; any narrower and the margin is a bottom sheet. */
export const TEXT_MIN = 360;
/** Narrowest the canvas gets in the 둘 다 view while the document pane widens for the panel (index.css). */
export const CANVAS_MIN = 430;
/** Width of the collapsed side panel (its rail). */
export const RAIL_W = 44;
/**
 * The document's share of the margin row while the side panel is open (E537, #654): text 6, panel 4 (index.css flex
 * 6 / 4). In 둘 다 the pane widens so the text keeps its split share: pane = share / DOC_SHARE (×5/3), up to the
 * canvas minimum.
 */
export const DOC_SHARE = 0.6;
export type MarginForm = 'side' | 'sheet';
/**
 * What the margin's layout has to work with, measured from the page (not the window: the app sidebar and the split
 * take their share). `box`: the split's whole width in 둘 다, else the document column's. `share`: the document's
 * split share (null without a split). `chrome`: the document pane's width outside the margin row. `rail`: the side
 * panel is collapsed to its rail (RAIL_W) instead of taking 4 of the row's 10 parts.
 */
export type MarginRoom = { box: number; share: number | null; chrome: number; rail: boolean };
/** The document pane's width in the side form (the margin row plus chrome); the whole box without a split. */
const sidePane = (r: MarginRoom) => {
  if (r.share == null) return r.box;
  const want = r.rail ? r.share * r.box + RAIL_W : (r.share * r.box) / DOC_SHARE;
  return Math.min(want, r.box - CANVAS_MIN);
};
/** The text column's width in a pane of `pane` px: the row less the rail, or its 6 parts of 10. */
const textIn = (r: Pick<MarginRoom, 'chrome' | 'rail'>, pane: number) => (r.rail ? pane - r.chrome - RAIL_W : (pane - r.chrome) * DOC_SHARE);
/** Side panel only when the text keeps TEXT_MIN beside it (and, in 둘 다, the canvas keeps CANVAS_MIN); else a sheet. */
export const formOf = (r: MarginRoom): MarginForm => (textIn(r, sidePane(r)) >= TEXT_MIN - 0.01 ? 'side' : 'sheet');
/** Where the split's divider sits (px from the split's left) for a share, as index.css lays it out. */
export const dividerAt = (r: MarginRoom & { share: number }): number => (formOf(r) === 'side' ? sidePane(r) : r.share * r.box);
/**
 * The share that puts the divider under a pointer at `x` (px from the split's left), so a drag never makes it jump.
 * Past the canvas minimum the divider stops there. Between the widest sheet layout and the narrowest side layout no
 * share puts it at `x` (the panel appears or goes); it snaps to the nearer of the two.
 */
export function shareAt(r: Omit<MarginRoom, 'share'>, x: number): number {
  const sheet = x / r.box;
  if (formOf({ ...r, share: sheet }) === 'sheet') return sheet;
  const pane = Math.min(x, r.box - CANVAS_MIN);
  const side = (r.rail ? pane - RAIL_W : pane * DOC_SHARE) / r.box;
  if (formOf({ ...r, share: side }) === 'side') return side;
  // The narrowest side layout: the text exactly TEXT_MIN.
  const edgePane = r.rail ? TEXT_MIN + r.chrome + RAIL_W : TEXT_MIN / DOC_SHARE + r.chrome;
  const edge = (r.rail ? edgePane - RAIL_W : edgePane * DOC_SHARE) / r.box;
  return x - edge * r.box < (edgePane - edge * r.box) / 2 ? edge - 0.5 / r.box : edge;
}

/** Per-browser collapse state (one per form), from localStorage text. A sheet starts collapsed, the side panel open. */
export const COLLAPSE_KEY = 'drawing.docMargin.collapsed';
export function readCollapsed(raw: string | null): Record<MarginForm, boolean> {
  const d = { side: false, sheet: true };
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Record<MarginForm, unknown>>) : null;
    if (v && typeof v === 'object') return { side: typeof v.side === 'boolean' ? v.side : d.side, sheet: typeof v.sheet === 'boolean' ? v.sheet : d.sheet };
  } catch {
    // Bad JSON: the defaults.
  }
  return d;
}
