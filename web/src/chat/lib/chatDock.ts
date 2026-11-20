// Pure parts of the chat dock (#937): who the person can talk to, the unread count, and the body that creates the
// 도우미 (helper). The conversation itself stays in the Dispatch store's memory; nothing here touches storage.
import type { Entry, Session } from '../../../../shared/dispatch/types.ts';

/** The helper is a lead-level session of this project: sonnet 5.5, perm auto, working in the project itself. */
export const HELPER_MODEL = 'claude-sonnet-5-5';
export const HELPER_ROLE = 'lead';
export const HELPER_PERM = 'auto';

/** `id: null` = the helper before its first message (it is made on send). */
export type ChatTarget = { key: string; id: string | null; label: string };
export const HELPER_KEY = 'helper';

const ENDED = new Set(['done', 'error']);
export const isAlive = (s: Pick<Session, 'status'>) => !ENDED.has(s.status);

/**
 * The 대화 상대 list: the helper first (its session when it is alive), then every other live session, newest first.
 * A helper that ended shows as not-made-yet, so the next message makes a new one.
 */
export function chatTargets(sessions: Session[], helperId: string | null): ChatTarget[] {
  // A helper just made may not be in the list yet: keep its id, so a second send does not make another one.
  const found = helperId ? sessions.find(s => s.id === helperId) : undefined;
  const id = !helperId ? null : !found ? helperId : isAlive(found) ? found.id : null;
  const others = sessions
    .filter(s => s.id !== helperId && isAlive(s))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(s => ({ key: s.id, id: s.id, label: `${s.name} · ${s.roleName}` }));
  return [{ key: HELPER_KEY, id, label: '도우미' }, ...others];
}

/** Replies (assistant messages) in a transcript. */
export const replies = (entries: Entry[] | undefined) => (entries ?? []).reduce((n, e) => n + (e.kind === 'assistant' ? 1 : 0), 0);

/** Replies that arrived after the person last saw the conversation. */
export const unread = (entries: Entry[] | undefined, seen: number) => Math.max(0, replies(entries) - seen);

/** Badge text: up to 9, then 9+. Empty when nothing is unread. */
export const badgeText = (n: number) => (n <= 0 ? '' : n > 9 ? '9+' : String(n));

/** POST /api/sessions body for the helper; its first message is the person's first message. */
export function helperBody(text: string, folder: string | null) {
  return {
    commonPrompt: text,
    worktree: false,
    ...(folder ? { folder } : {}),
    items: [{ role: HELPER_ROLE, model: HELPER_MODEL, effort: null, perm: HELPER_PERM, n: 1 }],
  };
}

/** Enter sends; Shift+Enter (and Enter while an IME is composing) adds a line. */
export const sendsOnEnter = (e: { key: string; shiftKey: boolean; isComposing?: boolean }) => e.key === 'Enter' && !e.shiftKey && !e.isComposing;
