// E537 (#654): the app's activity feed — unread count, badge, which events pop up, feed order and words, feed placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEvent, alertRoute, badgeText, feedOf, markRead, placeFeed, unreadCount, whenText } from '../../web/src/activity/activity.ts';
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

test('alertRoute: no toast in view (#811), notification when hidden and on, progress never pops up', () => {
  assert.equal(alertRoute({ kind: 'start' }, { visible: true, notify: true }), null);
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

test('whenText: 방금, minutes, hours, days within a week, then a date', () => {
  assert.equal(whenText(10_000, 0), '방금');
  assert.equal(whenText(2 * 3600_000, 0), '2시간 전');
  assert.equal(whenText(3 * 86_400_000, 0), '3일 전');
  assert.equal(whenText(7 * 86_400_000 - 1000, 0), '6일 전');
  assert.match(whenText(7 * 86_400_000, Date.UTC(2026, 10, 16, 12)), /^11월 1[67]일$/);
});

test('placeFeed: under the bell with right edges lined up (top-right bell, #786), flipped above near the bottom, kept inside the viewport', () => {
  const view = { width: 1200, height: 600 };
  assert.deepEqual(placeFeed({ right: 1188, top: 10, bottom: 40 }, { width: 360, height: 300 }, view), { left: 828, top: 46 }, 'opens down and to the left');
  assert.deepEqual(placeFeed({ right: 200, top: 10, bottom: 40 }, { width: 360, height: 300 }, view), { left: 8, top: 46 }, 'shifted in at the left edge');
  assert.deepEqual(placeFeed({ right: 1198, top: 10, bottom: 40 }, { width: 360, height: 300 }, view), { left: 832, top: 46 }, 'kept off the right edge');
  assert.deepEqual(placeFeed({ right: 110, top: 500, bottom: 530 }, { width: 100, height: 300 }, view), { left: 10, top: 194 });
});
