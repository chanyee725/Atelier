// The 알림함's items in this browser (E582, #797; pure logic in inbox.ts). App toasts come in from notifyApp (the one
// place every app toast goes through), agent activity from the server's activity log (store.ts). Saved to
// localStorage on every change and read back on load; another tab's change comes in over the `storage` event.
// Storage that is off or full is skipped: the inbox then lives in memory only. Metadata only.
import { useSyncExternalStore } from 'react';
import type { AppToast } from './appEvents';
import { clearInbox, markAllRead, markItemRead, removeItem, takeActivity } from './inbox';
import { createInboxSync } from './inboxSync';
import { onActivityLog, readAll } from './store';

const subs = new Set<() => void>();
let started = false;
const sync = createInboxSync(
  () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null; // Storage blocked by the browser.
    }
  },
  () => subs.forEach((f) => f()),
);
const { read, set } = sync;

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  addEventListener('storage', (e) => sync.onStorage(e.key, e.newValue));
  onActivityLog((log) => set(takeActivity(read(), log)));
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => void subs.delete(f);
};

export const useInbox = () => useSyncExternalStore(subscribe, read, read);

/** An app toast as an inbox item (called by notifyApp once the toast passed its category and dedupe checks). */
export const addToastToInbox = (t: AppToast) => sync.addToast(t, Date.now());

export const readInboxItem = (id: string) => set(markItemRead(read(), id));
export const deleteInboxItem = (id: string) => set(removeItem(read(), id));
export const clearAllInbox = () => set(clearInbox(read()));

/** 모두 읽음: every item, and the server's agent activity log on every page too. */
export function readAllInbox() {
  set(markAllRead(read()));
  readAll();
}
