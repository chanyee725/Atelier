import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeText, chatTargets, helperBody, helperOffline, sendOnce, sendsOnEnter, sessionGone, unread } from '../web/src/chat/lib/chatDock.ts';
import type { Entry, Session } from '../shared/dispatch/types.ts';

const ses = (id: string, status: Session['status'], startedAt: number, name = id) =>
  ({ id, status, startedAt, name, roleName: '팀원' }) as Session;

test('chatTargets: helper first, then live sessions newest first; ended ones drop out', () => {
  const list = [ses('a', 'running', 1), ses('b', 'done', 3), ses('c', 'idle', 2), ses('h', 'waiting', 0)];
  assert.deepEqual(chatTargets(list, 'h').map(t => [t.key, t.id]), [['helper', 'h'], ['c', 'c'], ['a', 'a']]);
  // No helper yet, or the helper ended: the helper entry has no id, so the next send makes a new one.
  assert.equal(chatTargets(list, null)[0]!.id, null);
  assert.equal(chatTargets([ses('h', 'done', 0)], 'h')[0]!.id, null);
  // Just made, not in the list yet: keep its id so a second send does not make another helper.
  assert.equal(chatTargets([], 'h')[0]!.id, 'h');
});

test('unread counts replies after the last seen count; badge caps at 9+', () => {
  const e = (kind: Entry['kind']) => ({ kind, text: 'x', at: 0 }) as Entry;
  const entries = [e('user'), e('assistant'), e('tool'), e('assistant'), e('assistant')];
  assert.equal(unread(entries, 1), 2);
  assert.equal(unread(entries, 5), 0);
  assert.equal(unread(undefined, 0), 0);
  assert.deepEqual([badgeText(0), badgeText(3), badgeText(12)], ['', '3', '9+']);
});

test('helperBody: lead role, sonnet 5.5, perm auto, no worktree, the project folder', () => {
  assert.deepEqual(helperBody('안녕', 'proj'), {
    commonPrompt: '안녕', worktree: false, folder: 'proj',
    items: [{ role: 'lead', model: 'claude-sonnet-5-5', effort: null, perm: 'auto', n: 1 }],
  });
  assert.equal('folder' in helperBody('x', null), false);
});

test('sendsOnEnter: Enter sends; Shift+Enter and IME composition do not', () => {
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false }), true);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: true }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, isComposing: true }), false);
  assert.equal(sendsOnEnter({ key: 'a', shiftKey: false }), false);
  // A Korean IME's committing Enter (keyCode 229) and a held key (repeat) do not send either (#950).
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 229 }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 13, repeat: true }), false);
  assert.equal(sendsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 13, repeat: false }), true);
});

test('helperOffline: only the not-yet-made helper with Claude known as not connected', () => {
  const [helper] = chatTargets([], null);
  assert.equal(helperOffline(helper!, { claude: { connected: false } }), true);
  assert.equal(helperOffline(helper!, { claude: { connected: true } }), false);
  // Provider list not loaded yet: do not block; the server answers.
  assert.equal(helperOffline(helper!, {}), false);
  // A helper already made, or another session, is not blocked here.
  assert.equal(helperOffline(chatTargets([], 'h')[0]!, { claude: { connected: false } }), false);
  assert.equal(helperOffline({ key: 's1', id: 's1', label: 'x' }, { claude: { connected: false } }), false);
});

test('sendOnce: two Enters before a re-render run the send once; the lock opens again after, also on failure', async () => {
  const lock = { current: false };
  let runs = 0;
  let finish!: () => void;
  const run = () => { runs++; return new Promise<void>(r => { finish = r; }); };
  const first = sendOnce(lock, run);
  const second = sendOnce(lock, run);
  assert.equal(await second, false);
  finish();
  assert.equal(await first, true);
  assert.equal(runs, 1);
  await assert.rejects(sendOnce(lock, async () => { throw new Error('x'); }));
  assert.equal(lock.current, false);
  assert.equal(await sendOnce(lock, async () => {}), true);
});

test('sessionGone: only a 404 forgets the helper', () => {
  assert.equal(sessionGone(Object.assign(new Error('세션이 없어요'), { status: 404 })), true);
  assert.equal(sessionGone(Object.assign(new Error('HTTP 500'), { status: 500 })), false);
  assert.equal(sessionGone(new TypeError('Failed to fetch')), false);
});
