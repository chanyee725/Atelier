// The 알림함's items in this browser (E582, #797; pure logic in inbox.ts). App toasts come in from notifyApp (the one
// place every app toast goes through), agent activity from the server's activity log (store.ts). Saved to
// localStorage on every change and read back on load; another tab's change comes in over the `storage` event.
// Storage that is off or full is skipped: the inbox then lives in memory only. Metadata only.
import { useSyncExternalStore } from 'react';
import type { AppToast } from './appEvents';
import { addItems, clearInbox, EMPTY_INBOX, itemOfToast, markAllRead, markItemRead, parseInbox, removeItem, takeActivity, type Inbox } from './inbox';
import { onActivityLog, readAll } from './store';

const KEY = 'drawing:inbox';
const subs = new Set<() => void>();
let box: Inbox | null = null;
let started = false;
let seq = 0;

function load(): Inbox {
  try {
    return parseInbox(localStorage.getItem(KEY));
  } catch {
    return EMPTY_INBOX;
  }
}

const read = (): Inbox => (box ??= typeof localStorage === 'undefined' ? EMPTY_INBOX : load());

function set(next: Inbox) {
  if (next === read()) return;
  box = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage off or full: memory only until the page closes.
  }
  for (const f of subs) f();
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    box = parseInbox(e.newValue);
    for (const f of subs) f();
  });
  onActivityLog((log) => set(takeActivity(read(), log)));
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => void subs.delete(f);
};

export const useInbox = () => useSyncExternalStore(subscribe, read, read);

/** An app toast as an inbox item (called by notifyApp once the toast passed its category and dedupe checks). */
export const addToastToInbox = (t: AppToast) => set(addItems(read(), [itemOfToast(t, Date.now(), ++seq)]));

export const readInboxItem = (id: string) => set(markItemRead(read(), id));
export const deleteInboxItem = (id: string) => set(removeItem(read(), id));
export const clearAllInbox = () => set(clearInbox(read()));

/** 모두 읽음: every item, and the server's agent activity log on every page too. */
export function readAllInbox() {
  set(markAllRead(read()));
  readAll();
}
