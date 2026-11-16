// E537 (#654): the app's activity feed — unread count, badge, which events pop up, feed order and words, feed placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEvent, alertRoute, badgeText, feedOf, markRead, nextToasts, placeFeed, unreadCount, whenText, type ToastQueue } from '../../web/src/activity/activity.ts';
import type { ActivityEvent, ActivityLog } from '../../shared/dispatch/agent-activity.ts';

const ev = (id: string, at: number, kind: ActivityEvent['kind'] = 'start', extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id, at, kind, sid: 's1', name: 'Jude', role: 'impl', file: 'P/07 서버.dpx.json', ...extra });
const empty: ActivityLog = { events: [], readAt: 0 };

test('addEvent: oldest first, no duplicates, malformed dropped', () => {
  let log = addEvent(empty, ev('b', 2000));
  log = addEvent(log, ev('a', 1000));
  assert.deepEqual(log.events.map((e) => e.id), ['a', 'b']);
  assert.equal(addEvent(log, ev('a', 1000)), log, 'same id: same log');
  assert.equal(addEvent(log, { id: 'x' }), log, 'malformed: same log');
});

test('markRead and unreadCount: the mark never moves back', () => {
  const log = addEvent(addEvent(empty, ev('a', 1000)), ev('b', 2000));
  assert.equal(unreadCount(log), 2);
  const read = markRead(log, 1000);
  assert.equal(unreadCount(read), 1);
  assert.equal(markRead(read, 500), read);
  assert.equal(markRead(read, 'x'), read);
});

test('badgeText: empty at 0, capped at 99+', () => {
  assert.deepEqual([badgeText(0), badgeText(3), badgeText(99), badgeText(120)], ['', '3', '99', '99+']);
});

test('alertRoute: toast in view, notification when hidden and on, progress never pops up', () => {
  assert.equal(alertRoute({ kind: 'start' }, { visible: true, notify: true }), 'toast');
  assert.equal(alertRoute({ kind: 'finish' }, { visible: false, notify: true }), 'notification');
  assert.equal(alertRoute({ kind: 'error' }, { visible: false, notify: false }), null);
  assert.equal(alertRoute({ kind: 'progress' }, { visible: true, notify: true }), null);
});

test('feedOf: newest first, sentence, unread flag, only a safe colour', () => {
  const log: ActivityLog = { events: [ev('a', 1000, 'start', { color: '#0f766e' }), ev('b', 100_000, 'progress', { section: '저장', color: 'red;x' })], readAt: 1000 };
  const [b, a] = feedOf(log, 100_000 + 5 * 60_000);
  assert.equal(b.id, 'b');
  assert.equal(b.unread, true);
  assert.equal(b.when, '5분 전');
  assert.match(b.text, /‘저장’ 섹션을 진행했어요/);
  assert.equal('color' in b, false);
  assert.equal(a.unread, false);
  assert.equal(a.color, '#0f766e');
  assert.match(a.text, /^Jude가 07 서버 작성을 시작했어요$/);
});

test('whenText: 방금, minutes, hours, then a date', () => {
  assert.equal(whenText(10_000, 0), '방금');
  assert.equal(whenText(2 * 3600_000, 0), '2시간 전');
  assert.match(whenText(3 * 86_400_000, Date.UTC(2026, 10, 16, 12)), /^11월 1[67]일$/);
});

test('placeFeed: under the bell, flipped above near the bottom, kept inside the viewport', () => {
  const view = { width: 400, height: 600 };
  assert.deepEqual(placeFeed({ left: 200, top: 10, bottom: 40 }, { width: 360, height: 300 }, view), { left: 32, top: 46 });
  assert.deepEqual(placeFeed({ left: 10, top: 500, bottom: 530 }, { width: 100, height: 300 }, view), { left: 10, top: 194 });
});

test('nextToasts: toasts waiting behind a modal are all kept and shown in order, at most max at once (#666)', () => {
  const t = (id: string) => ({ id });
  const ids = (q: ToastQueue<{ id: string }>) => [q.shown.map((x) => x.id), q.waiting.map((x) => x.id)];
  let q: ToastQueue<{ id: string }> = { shown: [], waiting: [] };
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) q = nextToasts(q, { type: 'add', toast: t(id), blocked: true }, 3);
  assert.deepEqual(ids(q), [[], ['a', 'b', 'c', 'd', 'e', 'f', 'g']], 'none dropped while a sheet is open');
  assert.equal(nextToasts(q, { type: 'fill', blocked: true }, 3), q, 'still blocked: same queue');
  q = nextToasts(q, { type: 'fill', blocked: false }, 3);
  assert.deepEqual(ids(q), [['a', 'b', 'c'], ['d', 'e', 'f', 'g']], 'oldest first, three on screen');
  assert.equal(nextToasts(q, { type: 'fill', blocked: false }, 3), q, 'full: same queue');
  q = nextToasts(q, { type: 'close', id: 'b', blocked: false }, 3);
  assert.deepEqual(ids(q), [['a', 'c', 'd'], ['e', 'f', 'g']], 'a closed toast makes room for the next');
  q = nextToasts(q, { type: 'close', id: 'a', blocked: true }, 3);
  assert.deepEqual(ids(q), [['c', 'd'], ['e', 'f', 'g']], 'nothing new appears while a modal is open again');
  q = nextToasts(q, { type: 'add', toast: t('e'), blocked: false }, 3);
  assert.deepEqual(ids(q), [['c', 'd', 'e'], ['f', 'g']], 'a duplicate is not queued twice');
  q = nextToasts(q, { type: 'add', toast: t('h'), blocked: false }, 3);
  assert.deepEqual(ids(q), [['c', 'd', 'e'], ['f', 'g', 'h']], 'with the screen full a new toast waits instead of pushing one out');
});
