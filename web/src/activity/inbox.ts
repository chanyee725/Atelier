// The 알림함 (E582, #797): every toast the app shows — app events (appToasts.ts), agent activity and plans waiting for
// 시작하기 — kept as an item in the bell's popover, newest first, at most INBOX_MAX. Read, delete one, read all and
// clear all. Kept per browser (localStorage, inboxStore.ts). Pure (no React or DOM), so it runs under `node --test`.
// Metadata only: the toast's one line (file, session and provider names, PR numbers), when, where it leads, and the
// agent that raised it (session name, role and provider ids, #811).
import { activitySentence, type ActivityEvent, type ActivityLog } from '../../../shared/dispatch/agent-activity.ts';
import { DEDUPE_MS, type AppToast, type ToastCategory, type ToastTarget } from './appEvents.ts';

export const INBOX_MAX = 200;
const TEXT_MAX = 200;

/** What the item is about (picks its icon): an app toast's category, an agent's activity, or a plan to start. */
export type InboxKind = ToastCategory | 'plan';
/** Where a click goes: a document, a session on the board, or a plan's 시작하기 confirm. */
export type InboxTarget = ToastTarget | { plan: string };

/** Who raised the item (#811): an agent session's own name, role id and provider id. Absent: the app itself. */
export interface InboxAgent {
  name: string;
  role: string;
  provider?: string;
}

export interface InboxItem {
  id: string;
  kind: InboxKind;
  error: boolean;
  text: string;
  at: number;
  read: boolean;
  target?: InboxTarget;
  agent?: InboxAgent;
  /** An app toast's key: the same event seen by several tabs within DEDUPE_MS is kept once (#803). */
  key?: string;
}

/**
 * items newest first; agentSeen: the newest agent event already taken in, so a deleted one never comes back;
 * agentSeenIds: the events taken in at exactly agentSeen, so another event of that same ms still comes in (#803).
 */
export interface Inbox {
  items: InboxItem[];
  agentSeen: number;
  agentSeenIds?: string[];
}

export const EMPTY_INBOX: Inbox = { items: [], agentSeen: 0 };

const byNewest = (a: InboxItem, b: InboxItem) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** True when an app item with this key is already there within DEDUPE_MS of `at` (another tab's copy). */
const echoOf = (items: readonly InboxItem[], i: InboxItem) => i.key !== undefined && items.some((o) => o.key === i.key && Math.abs(o.at - i.at) < DEDUPE_MS);

/**
 * The inbox with these items added, newest first, capped. Skipped: ids already there, and an app event another tab
 * already stored (same key within DEDUPE_MS, #803). Same inbox when none is new.
 */
export function addItems(box: Inbox, add: InboxItem[]): Inbox {
  const have = new Set(box.items.map((i) => i.id));
  const kept: InboxItem[] = [...box.items];
  const fresh: InboxItem[] = [];
  for (const i of add) {
    if (have.has(i.id) || echoOf(kept, i)) continue;
    have.add(i.id);
    kept.push(i);
    fresh.push(i);
  }
  if (!fresh.length) return box;
  return { ...box, items: [...fresh, ...box.items].sort(byNewest).slice(0, INBOX_MAX) };
}

export const markItemRead = (box: Inbox, id: string): Inbox =>
  box.items.some((i) => i.id === id && !i.read) ? { ...box, items: box.items.map((i) => (i.id === id ? { ...i, read: true } : i)) } : box;

export const markAllRead = (box: Inbox): Inbox =>
  box.items.some((i) => !i.read) ? { ...box, items: box.items.map((i) => (i.read ? i : { ...i, read: true })) } : box;

export const removeItem = (box: Inbox, id: string): Inbox =>
  box.items.some((i) => i.id === id) ? { ...box, items: box.items.filter((i) => i.id !== id) } : box;

export const clearInbox = (box: Inbox): Inbox => (box.items.length ? { ...box, items: [] } : box);

export const inboxUnread = (box: Inbox) => box.items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

/** The bell's badge number: unread items plus waiting plans, a waiting plan counted once even when its
 * 'plan-waiting' toast is also an unread item (#802). */
export function bellCount(box: Inbox, waiting: readonly string[]): number {
  const plans = new Set(waiting);
  const unread = box.items.reduce((n, i) => n + (i.read || (i.target && 'plan' in i.target && plans.has(i.target.plan)) ? 0 : 1), 0);
  return unread + plans.size;
}

const stem = (p: string) => p.replace(/\.dpx(\.json)?$/i, '');

/**
 * True when the item leads to a document (or plan) that is no longer in the workspace tree (deleted or moved), so a
 * click says so instead of opening nothing (#803). `files`: every file path in the tree; empty means not loaded yet.
 */
export function targetGone(target: InboxTarget | undefined, files: readonly string[]): boolean {
  const path = target && ('file' in target ? target.file : 'plan' in target ? target.plan : null);
  if (!path || !files.length) return false;
  const want = stem(path);
  return !files.some((f) => stem(f) === want);
}

const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** The item for an app toast shown (or sent as a browser notification) at `at`. Its id comes from the event, not the tab. */
export function itemOfToast(t: AppToast, at: number): InboxItem {
  const plan = t.key.startsWith('plan-waiting:') && t.target && 'file' in t.target;
  return {
    id: `app:${t.key}@${at}`,
    key: t.key,
    kind: plan ? 'plan' : t.category,
    error: t.tone === 'error',
    text: clip(t.inboxText ?? t.text),
    at,
    read: false,
    ...(plan ? { target: { plan: (t.target as { file: string }).file } } : t.target ? { target: t.target } : {}),
    ...(t.agent ? { agent: t.agent } : {}),
  };
}

/**
 * The server's agent activity log taken in: events newer than agentSeen become items (read when the log says so).
 * The first time, the whole log comes in, so the history the bell showed before is still there.
 */
export function takeActivity(box: Inbox, log: ActivityLog): Inbox {
  const seenIds = new Set(box.agentSeenIds ?? []);
  const news = log.events.filter((e) => e.at > box.agentSeen || (e.at === box.agentSeen && !seenIds.has(e.id)));
  if (!news.length) return box;
  const items = news.map(
    (e: ActivityEvent): InboxItem => ({
      id: `agent:${e.id}`,
      kind: 'agents',
      error: e.kind === 'error',
      text: clip(activitySentence(e)),
      at: e.at,
      read: e.at <= log.readAt,
      target: { file: e.file },
      ...(e.name ? { agent: { name: e.name, role: e.role ?? '', ...(e.provider ? { provider: e.provider } : {}) } } : {}),
    }),
  );
  const agentSeen = Math.max(box.agentSeen, ...news.map((e) => e.at));
  const atSeen = news.filter((e) => e.at === agentSeen).map((e) => e.id);
  const agentSeenIds = agentSeen === box.agentSeen ? [...seenIds, ...atSeen] : atSeen;
  return { ...addItems(box, items), agentSeen, agentSeenIds };
}

function agentOf(x: unknown): InboxAgent | undefined {
  const a = x as Record<string, unknown> | null;
  if (!a || typeof a !== 'object' || !str(a.name)) return undefined;
  return { name: a.name.slice(0, 40), role: typeof a.role === 'string' ? a.role : '', ...(str(a.provider) ? { provider: a.provider } : {}) };
}

const KINDS = new Set<InboxKind>(['agents', 'files', 'sessions', 'models', 'runs', 'settings', 'plan']);
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

function targetOf(x: unknown): InboxTarget | undefined {
  const t = x as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return undefined;
  if (str(t.file)) return { file: t.file };
  if (str(t.session)) return { session: t.session };
  if (str(t.plan)) return { plan: t.plan };
  return undefined;
}

/** What this browser stored (anything malformed is dropped; nothing usable → empty). */
export function parseInbox(raw: string | null): Inbox {
  try {
    const v = JSON.parse(raw ?? 'null') as { items?: unknown; agentSeen?: unknown; agentSeenIds?: unknown } | null;
    if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return EMPTY_INBOX;
    const items: InboxItem[] = [];
    for (const x of v.items as Record<string, unknown>[]) {
      if (!x || !str(x.id) || !KINDS.has(x.kind as InboxKind) || !str(x.text) || typeof x.at !== 'number' || !Number.isFinite(x.at)) continue;
      const target = targetOf(x.target);
      const agent = agentOf(x.agent);
      const key = str(x.key) ? x.key : undefined;
      items.push({ id: x.id, kind: x.kind as InboxKind, error: x.error === true, text: clip(x.text), at: x.at, read: x.read === true, ...(target ? { target } : {}), ...(agent ? { agent } : {}), ...(key ? { key } : {}) });
    }
    const seen = typeof v.agentSeen === 'number' && Number.isFinite(v.agentSeen) ? v.agentSeen : 0;
    const seenIds = Array.isArray(v.agentSeenIds) ? v.agentSeenIds.filter(str).slice(0, INBOX_MAX) : [];
    // Two tabs' copies of one event stored before either saw the other's collapse here (addItems skips echoes).
    return addItems({ items: [], agentSeen: seen, ...(seenIds.length ? { agentSeenIds: seenIds } : {}) }, items);
  } catch {
    return EMPTY_INBOX;
  }
}
