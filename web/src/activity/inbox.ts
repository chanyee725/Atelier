// The 알림함 (E582, #797): every toast the app shows — app events (appToasts.ts), agent activity and plans waiting for
// 시작하기 — kept as an item in the bell's popover, newest first, at most INBOX_MAX. Read, delete one, read all and
// clear all. Kept per browser (localStorage, inboxStore.ts). Pure (no React or DOM), so it runs under `node --test`.
// Metadata only: the toast's one line (file, session and provider names, PR numbers), when, and where it leads.
import { activitySentence, type ActivityEvent, type ActivityLog } from '../../../shared/dispatch/agent-activity.ts';
import type { AppToast, ToastCategory, ToastTarget } from './appEvents';

export const INBOX_MAX = 200;
const TEXT_MAX = 200;

/** What the item is about (picks its icon): an app toast's category, an agent's activity, or a plan to start. */
export type InboxKind = ToastCategory | 'plan';
/** Where a click goes: a document, a session on the board, or a plan's 시작하기 confirm. */
export type InboxTarget = ToastTarget | { plan: string };

export interface InboxItem {
  id: string;
  kind: InboxKind;
  error: boolean;
  text: string;
  at: number;
  read: boolean;
  target?: InboxTarget;
}

/** items newest first; agentSeen: the newest agent event already taken in, so a deleted one never comes back. */
export interface Inbox {
  items: InboxItem[];
  agentSeen: number;
}

export const EMPTY_INBOX: Inbox = { items: [], agentSeen: 0 };

const byNewest = (a: InboxItem, b: InboxItem) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The inbox with these items added (ids already there are skipped), newest first, capped. Same inbox when none is new. */
export function addItems(box: Inbox, add: InboxItem[]): Inbox {
  const have = new Set(box.items.map((i) => i.id));
  const fresh = add.filter((i) => !have.has(i.id) && have.add(i.id));
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

const clip = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** The item for an app toast shown (or sent as a browser notification) at `at`. */
export function itemOfToast(t: AppToast, at: number, seq: number): InboxItem {
  const plan = t.key.startsWith('plan-waiting:') && t.target && 'file' in t.target;
  return {
    id: `app:${at}:${seq}`,
    kind: plan ? 'plan' : t.category,
    error: t.tone === 'error',
    text: clip(t.text),
    at,
    read: false,
    ...(plan ? { target: { plan: (t.target as { file: string }).file } } : t.target ? { target: t.target } : {}),
  };
}

/**
 * The server's agent activity log taken in: events newer than agentSeen become items (read when the log says so).
 * The first time, the whole log comes in, so the history the bell showed before is still there.
 */
export function takeActivity(box: Inbox, log: ActivityLog): Inbox {
  const news = log.events.filter((e) => e.at > box.agentSeen);
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
    }),
  );
  const agentSeen = Math.max(box.agentSeen, ...news.map((e) => e.at));
  return { ...addItems(box, items), agentSeen };
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
    const v = JSON.parse(raw ?? 'null') as { items?: unknown; agentSeen?: unknown } | null;
    if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return EMPTY_INBOX;
    const items: InboxItem[] = [];
    for (const x of v.items as Record<string, unknown>[]) {
      if (!x || !str(x.id) || !KINDS.has(x.kind as InboxKind) || !str(x.text) || typeof x.at !== 'number' || !Number.isFinite(x.at)) continue;
      const target = targetOf(x.target);
      items.push({ id: x.id, kind: x.kind as InboxKind, error: x.error === true, text: clip(x.text), at: x.at, read: x.read === true, ...(target ? { target } : {}) });
    }
    const seen = typeof v.agentSeen === 'number' && Number.isFinite(v.agentSeen) ? v.agentSeen : 0;
    return addItems({ items: [], agentSeen: seen }, items);
  } catch {
    return EMPTY_INBOX;
  }
}
