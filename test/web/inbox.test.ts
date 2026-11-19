// E582 (#797): the 알림함 keeps every toast — app toasts and agent activity — newest first, capped, with read, delete
// and clear, and survives a round trip through this browser's storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toastOf } from '../../web/src/activity/appEvents.ts';
import {
  addItems,
  clearInbox,
  EMPTY_INBOX,
  INBOX_MAX,
  inboxUnread,
  itemOfToast,
  markAllRead,
  markItemRead,
  parseInbox,
  removeItem,
  takeActivity,
} from '../../web/src/activity/inbox.ts';

const ev = (id: string, at: number, kind: 'start' | 'progress' | 'finish' | 'error' = 'finish') => ({ id, at, kind, sid: 's1', name: 'Jae', file: 'docs/설계.dpx.json' });

test('app toasts and agent events become items, newest first, with their target; read, delete and clear', () => {
  const saved = itemOfToast(toastOf({ type: 'created', kind: 'doc', path: 'a/설계.dpx.json' })!, 10, 1);
  const team = itemOfToast(toastOf({ type: 'session-started', id: 'x1', name: 'Jae', team: true })!, 30, 2);
  const plan = itemOfToast(toastOf({ type: 'plan-waiting', file: 'p.dpx.json', text: '계획이 기다려요' })!, 40, 3);
  const failed = itemOfToast(toastOf({ type: 'save-failed', path: 'a.dpx.json' })!, 50, 4);
  let box = addItems(EMPTY_INBOX, [saved, team]);
  box = takeActivity(box, { events: [ev('e1', 20), ev('e2', 45, 'error')], readAt: 20 });
  box = addItems(box, [plan, failed]);
  assert.deepEqual(box.items.map((i) => [i.kind, i.at, i.read]), [
    ['files', 50, false],
    ['agents', 45, false],
    ['plan', 40, false],
    ['sessions', 30, false],
    ['agents', 20, true],
    ['files', 10, false],
  ]);
  assert.equal(box.items[0].error, true);
  assert.deepEqual(box.items[2].target, { plan: 'p.dpx.json' });
  assert.deepEqual(box.items[3].target, { session: 'x1' });
  assert.deepEqual(box.items[5].target, { file: 'a/설계.dpx.json' });
  assert.equal(inboxUnread(box), 5);

  // The same log again (a reconnect) adds nothing; a deleted agent event never comes back.
  assert.equal(takeActivity(box, { events: [ev('e1', 20), ev('e2', 45, 'error')], readAt: 20 }), box);
  const gone = removeItem(box, 'agent:e2');
  assert.equal(takeActivity(gone, { events: [ev('e2', 45, 'error')], readAt: 0 }).items.length, 5);

  assert.equal(inboxUnread(markItemRead(box, box.items[0].id)), 4);
  assert.equal(inboxUnread(markAllRead(box)), 0);
  assert.equal(markAllRead(markAllRead(box)).items.length, 6);
  assert.deepEqual(clearInbox(box).items, []);
  assert.equal(clearInbox(box).agentSeen, 45);
});

test('the inbox keeps the newest INBOX_MAX and round-trips through storage, dropping malformed items', () => {
  const many = Array.from({ length: INBOX_MAX + 5 }, (_, n) => itemOfToast(toastOf({ type: 'settings-saved' })!, n, n));
  const box = addItems(EMPTY_INBOX, many);
  assert.equal(box.items.length, INBOX_MAX);
  assert.equal(box.items[0].at, INBOX_MAX + 4);
  assert.equal(box.items.at(-1)!.at, 5);

  const back = parseInbox(JSON.stringify({ ...box, items: [...box.items.slice(0, 2), { id: 'x', kind: 'nope', text: 'a', at: 1 }, null] }));
  assert.deepEqual(back.items, box.items.slice(0, 2));
  assert.deepEqual(parseInbox('not json'), EMPTY_INBOX);
  assert.deepEqual(parseInbox(null), EMPTY_INBOX);
});
