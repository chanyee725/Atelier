// Agent activity feed of the app (E537, issue #654): the server's activity log (shared/dispatch/agent-activity.ts)
// as the page shows it — the bell's unread count and feed, toasts while the page is in view and browser notifications
// while it is hidden. Pure (no React or DOM), so it runs under `node --test`. Metadata only: who, which file, when.
import { activitySentence, ACTIVITY_MAX, isActivityEvent, type ActivityEvent, type ActivityLog } from '../../../shared/dispatch/agent-activity.ts';

export type { ActivityEvent, ActivityLog };

/** The log with one new event (the same log when it is already there or malformed). Oldest first, capped. */
export function addEvent(log: ActivityLog, e: unknown): ActivityLog {
  if (!isActivityEvent(e) || log.events.some((x) => x.id === e.id)) return log;
  const events = [...log.events, e].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-ACTIVITY_MAX);
  return { ...log, events };
}

/** The log after a read mark from any page (never moves back). */
export const markRead = (log: ActivityLog, readAt: unknown): ActivityLog =>
  typeof readAt === 'number' && Number.isFinite(readAt) && readAt > log.readAt ? { ...log, readAt } : log;

/** Unread events. */
export const unreadCount = (log: ActivityLog) => log.events.reduce((n, e) => n + (e.at > log.readAt ? 1 : 0), 0);

/** The badge text: up to 99, then "99+"; '' with nothing unread. */
export const badgeText = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));

/** Progress events come often (one per section): they stay in the feed and never pop up. */
export const alerts = (e: Pick<ActivityEvent, 'kind'>) => e.kind !== 'progress';

/** How to tell the user about a new event: a toast in view, a browser notification when hidden and turned on. */
export function alertRoute(e: Pick<ActivityEvent, 'kind'>, page: { visible: boolean; notify: boolean }): 'toast' | 'notification' | null {
  if (!alerts(e)) return null;
  if (page.visible) return 'toast';
  return page.notify ? 'notification' : null;
}

/**
 * A modal dialog that makes the page behind it inert: a native one (showModal), the Radix one in
 * components/ui/dialog.tsx, or any aria-modal dialog. Toasts wait while one is open (persistent-toast-notifications).
 * The bell's own feed is a non-modal role="dialog" popover and does not match.
 */
export const MODAL_SELECTOR = 'dialog:modal, [data-slot="dialog-content"][data-state="open"], [role="dialog"][aria-modal="true"]';

export type FeedItem = { id: string; text: string; when: string; unread: boolean; file: string; color?: string; kind: ActivityEvent['kind'] };

/** "방금", "3분 전", "2시간 전", else the date ("11월 16일"). */
export function whenText(ms: number, at: number): string {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  if (s < 30) return '방금';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분 전`;
  if (s < 86_400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** The feed, newest first. */
export function feedOf(log: ActivityLog, now: number): FeedItem[] {
  return [...log.events].reverse().map((e) => ({
    id: e.id,
    text: activitySentence(e),
    when: whenText(now - e.at, e.at),
    unread: e.at > log.readAt,
    file: e.file,
    kind: e.kind,
    ...(e.color && /^#[0-9a-f]{6}$/i.test(e.color) ? { color: e.color } : {}),
  }));
}

const GAP = 6;
const EDGE = 8;

/** Where the feed goes: under the bell, left-aligned, flipped above or shifted in when it would leave the viewport. */
export function placeFeed(bell: { left: number; top: number; bottom: number }, feed: { width: number; height: number }, view: { width: number; height: number }) {
  const left = Math.max(EDGE, Math.min(bell.left, view.width - feed.width - EDGE));
  const below = bell.bottom + GAP;
  const top = below + feed.height <= view.height - EDGE ? below : Math.max(EDGE, bell.top - GAP - feed.height);
  return { left, top };
}
