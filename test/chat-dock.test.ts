import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeText, chatTargets, helperBody, sendsOnEnter, unread } from '../web/src/chat/lib/chatDock.ts';
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
});
