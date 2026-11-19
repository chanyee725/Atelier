// One tab's copy of the 알림함 kept in step with this browser's storage (#797, #803). Pure of React and the DOM so
// it runs under `node --test` with a fake storage: two syncs on one storage behave like two tabs.
// An app toast is added on top of what storage holds right now (not this tab's last copy), so another tab's copy of
// the same event is seen and skipped; copies stored by two tabs at once collapse when read back (parseInbox).
import { addItems, EMPTY_INBOX, itemOfToast, parseInbox, type Inbox } from './inbox.ts';
import type { AppToast } from './appEvents';

export const INBOX_KEY = 'drawing:inbox';

export type InboxStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createInboxSync(storage: () => InboxStorage | null, notify: () => void) {
  let box: Inbox | null = null;
  /** What storage holds now; null when storage is off (the inbox then lives in this tab's memory). */
  const load = (): Inbox | null => {
    try {
      const s = storage();
      return s ? parseInbox(s.getItem(INBOX_KEY)) : null;
    } catch {
      return null;
    }
  };
  const read = (): Inbox => (box ??= load() ?? EMPTY_INBOX);
  const set = (next: Inbox) => {
    if (next === box) return;
    box = next;
    try {
      storage()?.setItem(INBOX_KEY, JSON.stringify(next));
    } catch {
      // Storage off or full: memory only until the page closes.
    }
    notify();
  };
  return {
    read,
    set,
    /** Another tab changed the inbox (the `storage` event). */
    onStorage(key: string | null, value: string | null) {
      if (key !== INBOX_KEY) return;
      box = parseInbox(value);
      notify();
    },
    addToast(t: AppToast, at: number) {
      const now = load() ?? read();
      const next = addItems(now, [itemOfToast(t, at)]);
      if (next === now) {
        // Another tab already stored it: take its copy without writing.
        box = now;
        notify();
      } else set(next);
    },
  };
}
