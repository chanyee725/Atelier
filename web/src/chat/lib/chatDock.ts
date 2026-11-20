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
export const sendsOnEnter = (e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean }) =>
  e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !e.repeat;

/**
 * Runs `run` unless a send is already in flight, checked synchronously: a Korean IME can deliver the committing Enter
 * twice before React re-renders `busy`, which sent twice and made two helpers (#937, same bug as #950).
 * Returns whether this call ran.
 */
export async function sendOnce(lock: { current: boolean }, run: () => Promise<void>): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await run();
  } finally {
    lock.current = false;
  }
  return true;
}

/** The session is gone (404): only then does the dock forget its helper; a passing error keeps it. */
export const sessionGone = (e: unknown) => (e as { status?: number } | null)?.status === 404;

/** Shown before the first send when the helper cannot be made yet: Claude is known and not connected here. */
export const HELPER_OFFLINE = 'Claude가 연결되지 않았어요. 연결하기에서 Claude를 연결하면 도우미와 대화할 수 있어요.';

/**
 * Whether sending would fail for the helper that is not made yet: the provider list says Claude is not connected.
 * An unknown state (list not loaded) does not block; the server still refuses and the error shows.
 */
export const helperOffline = (target: ChatTarget, providers: Record<string, { connected?: boolean } | undefined>) =>
  target.key === HELPER_KEY && target.id === null && providers.claude?.connected === false;
