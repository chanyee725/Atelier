// E582 (#797): the 알림함 keeps every toast — app toasts and agent activity — newest first, capped, with read, delete
// and clear, and survives a round trip through this browser's storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEDUPE_MS, sessionEvents, toastOf } from '../../web/src/activity/appEvents.ts';
import { createInboxSync, INBOX_KEY } from '../../web/src/activity/inboxSync.ts';
import {
  addItems,
  bellCount,
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
  targetGone,
} from '../../web/src/activity/inbox.ts';

const ev = (id: string, at: number, kind: 'start' | 'progress' | 'finish' | 'error' = 'finish') => ({ id, at, kind, sid: 's1', name: 'Jae', file: 'docs/설계.dpx.json' });

test('app toasts and agent events become items, newest first, with their target; read, delete and clear', () => {
  const saved = itemOfToast(toastOf({ type: 'created', kind: 'doc', path: 'a/설계.dpx.json' })!, 10);
  const team = itemOfToast(toastOf({ type: 'session-started', id: 'x1', name: 'Jae', team: true })!, 30);
  const plan = itemOfToast(toastOf({ type: 'plan-waiting', file: 'p.dpx.json', text: '계획이 기다려요' })!, 40);
  const failed = itemOfToast(toastOf({ type: 'save-failed', path: 'a.dpx.json' })!, 50);
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
  const many = Array.from({ length: INBOX_MAX + 5 }, (_, n) => itemOfToast(toastOf({ type: 'saved', path: `f${n}.dpx.json` })!, n));
  const box = addItems(EMPTY_INBOX, many);
  assert.equal(box.items.length, INBOX_MAX);
  assert.equal(box.items[0].at, INBOX_MAX + 4);
  assert.equal(box.items.at(-1)!.at, 5);

  const back = parseInbox(JSON.stringify({ ...box, items: [...box.items.slice(0, 2), { id: 'x', kind: 'nope', text: 'a', at: 1 }, null] }));
  assert.deepEqual(back.items, box.items.slice(0, 2));
  assert.deepEqual(parseInbox('not json'), EMPTY_INBOX);
  assert.deepEqual(parseInbox(null), EMPTY_INBOX);
});

test('a waiting plan counts once on the bell, even with its plan-waiting toast unread (#802)', () => {
  const plan = itemOfToast(toastOf({ type: 'plan-waiting', file: 'p.dpx.json', text: '계획이 기다려요' })!, 40);
  const saved = itemOfToast(toastOf({ type: 'created', kind: 'doc', path: 'a.dpx.json' })!, 10);
  const box = addItems(EMPTY_INBOX, [plan, saved]);
  assert.equal(bellCount(box, ['p.dpx.json']), 2);
  assert.equal(bellCount(addItems(EMPTY_INBOX, [plan]), ['p.dpx.json']), 1);
  // Once started, the plan's item is an ordinary unread item again.
  assert.equal(bellCount(box, []), 2);
  assert.equal(bellCount(markAllRead(box), ['p.dpx.json']), 1);
});

test('items keep who raised them: name, role and provider ids, through storage (#811)', () => {
  const agentEv = { ...ev('e1', 20), role: 'lead', provider: 'claude' };
  let box = takeActivity(EMPTY_INBOX, { events: [agentEv, { ...ev('e0', 5), name: '' }], readAt: 0 });
  assert.deepEqual(box.items[0].agent, { name: 'Jae', role: 'lead', provider: 'claude' });
  assert.equal(box.items[1].agent, undefined);

  const [started] = sessionEvents(undefined, { id: 's9', name: 'Chan', role: 'lead', provider: 'openai', startedAt: 100 }, 100);
  const item = itemOfToast(toastOf(started)!, 30);
  assert.deepEqual(item.agent, { name: 'Chan', role: 'lead', provider: 'openai' });
  // App events with no agent (a save) have none: the Atelier mark is shown.
  assert.equal(itemOfToast(toastOf({ type: 'settings-saved' })!, 31).agent, undefined);

  box = addItems(box, [item]);
  const back = parseInbox(JSON.stringify({ ...box, items: [...box.items, { id: 'b', kind: 'agents', text: 't', at: 1, agent: { role: 'x' } }] }));
  assert.deepEqual(back.items.map((i) => i.agent), [item.agent, { name: 'Jae', role: 'lead', provider: 'claude' }, undefined, undefined]);
});

test('agent events of the same ms that come in separately are all kept; a deleted one still stays out (#803)', () => {
  let box = takeActivity(EMPTY_INBOX, { events: [ev('a', 50)], readAt: 0 });
  box = takeActivity(box, { events: [ev('a', 50), ev('b', 50)], readAt: 0 });
  assert.deepEqual(box.items.map((i) => i.id).sort(), ['agent:a', 'agent:b']);
  const gone = removeItem(box, 'agent:b');
  assert.equal(takeActivity(gone, { events: [ev('a', 50), ev('b', 50)], readAt: 0 }), gone);
  // Survives storage too.
  const back = parseInbox(JSON.stringify(gone));
  assert.equal(takeActivity(back, { events: [ev('b', 50)], readAt: 0 }).items.length, 1);
  // A newer event resets the same-ms list.
  assert.deepEqual(takeActivity(box, { events: [ev('c', 60)], readAt: 0 }).agentSeenIds, ['c']);
});

test('one app event seen by two tabs is one item; a repeat after the dedupe window is a new one (#803)', () => {
  const t = toastOf({ type: 'created', kind: 'doc', path: 'a.dpx.json' })!;
  const tabA = itemOfToast(t, 1_000);
  const tabB = itemOfToast(t, 1_030);
  assert.equal(addItems(addItems(EMPTY_INBOX, [tabA]), [tabB]).items.length, 1);
  // Both tabs stored their copy before seeing the other's: they collapse when read back.
  const both = JSON.stringify({ items: [tabB, tabA], agentSeen: 0 });
  assert.deepEqual(parseInbox(both).items.map((i) => i.id), [tabB.id]);
  assert.equal(addItems(addItems(EMPTY_INBOX, [tabA]), [itemOfToast(t, 1_000 + DEDUPE_MS)]).items.length, 2);
  // Different events at the same moment are both kept.
  const other = itemOfToast(toastOf({ type: 'created', kind: 'doc', path: 'b.dpx.json' })!, 1_000);
  assert.equal(addItems(addItems(EMPTY_INBOX, [tabA]), [other]).items.length, 2);
});

/** A fake localStorage shared by syncs; each sync is one tab. */
function fakeStorage() {
  const data = new Map<string, string>();
  const tabs: ReturnType<typeof createInboxSync>[] = [];
  return {
    tabs,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem(k: string, v: string) {
        data.set(k, v);
        // The browser tells every other tab (the `storage` event).
        for (const s of tabs) if (s !== this.from) s.onStorage(k, v);
      },
      from: null as unknown,
    },
  };
}

test('two tabs on one storage: each event stored once, deletes and reads carry over (#803)', () => {
  const fake = fakeStorage();
  let seen = 0;
  const tab = () => {
    const s = createInboxSync(() => fake.storage, () => seen++);
    fake.tabs.push(s);
    return s;
  };
  const a = tab();
  const b = tab();
  const t = toastOf({ type: 'created', kind: 'doc', path: 'a.dpx.json' })!;
  fake.storage.from = a;
  a.addToast(t, 1_000);
  fake.storage.from = b;
  b.addToast(t, 1_020);
  assert.equal(a.read().items.length, 1);
  assert.equal(b.read().items.length, 1);
  assert.equal(JSON.parse(fake.storage.getItem(INBOX_KEY)!).items.length, 1);

  // A read and a delete in one tab show in the other.
  b.set(markItemRead(b.read(), b.read().items[0].id));
  assert.equal(a.read().items[0].read, true);
  fake.storage.from = a;
  a.set(removeItem(a.read(), a.read().items[0].id));
  assert.deepEqual(b.read().items, []);
  assert.ok(seen >= 4);

  // Storage off: the tab keeps its items in memory.
  const mem = createInboxSync(() => null, () => {});
  mem.addToast(t, 5);
  mem.addToast(toastOf({ type: 'saved', path: 'x.dpx.json' })!, 6);
  assert.equal(mem.read().items.length, 2);
});

test('an item whose document left the tree is known as gone; an unloaded tree says nothing (#803)', () => {
  const files = ['docs/설계.dpx.json', 'run/p.dpx.json'];
  assert.equal(targetGone({ file: 'docs/설계.dpx.json' }, files), false);
  assert.equal(targetGone({ plan: 'run/p' }, files), false, 'with or without the extension');
  assert.equal(targetGone({ file: 'docs/지운.dpx.json' }, files), true);
  assert.equal(targetGone({ plan: 'run/q.dpx.json' }, files), true);
  assert.equal(targetGone({ session: 's1' }, files), false);
  assert.equal(targetGone({ file: 'docs/지운.dpx.json' }, []), false);
  assert.equal(targetGone(undefined, files), false);
});

test('a session that starts waiting on a question raises a 알림함 item that opens it (#886)', () => {
  const base = { id: 's1', name: 'Ollie', role: 'lead', provider: 'claude' };
  const prev = { ...base, status: 'running', state: 'working' };
  const next = { ...base, status: 'idle', state: 'waiting', ask: '머지할까요?', stateSince: 500 };
  const [ev] = sessionEvents(prev, next, 600);
  const t = toastOf(ev)!;
  assert.equal(t.text, 'Ollie 세션이 답을 기다려요: 머지할까요?');
  assert.deepEqual(t.target, { session: 's1' });
  assert.equal(t.persist, true);
  assert.deepEqual(itemOfToast(t, 600).target, { session: 's1' });
  // The same question re-sent (a reconnect, a cost update) says nothing new; a new question does.
  assert.deepEqual(sessionEvents(next, { ...next }, 700), []);
  assert.equal(sessionEvents(next, { ...next, ask: '배포할까요?', stateSince: 800 }, 800).length, 1);
  // A permission prompt (no ask) is not a question.
  assert.deepEqual(sessionEvents(prev, { ...base, status: 'waiting', state: 'waiting' }, 600), []);
});
