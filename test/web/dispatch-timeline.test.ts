import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineLanes } from '../../web/src/dispatch/lib/timeline.ts';

const mk = (id: string, role: string, folder: string | null, startedAt: number, roleName = '') => ({ id, role, roleName, folder, startedAt });
const roles = [{ id: 'lead', name: '관리자' }, { id: 'impl', name: '구현자' }];
const known = new Set(['web', 'server']);
const sessions = [
  mk('b', 'impl', 'web', 20), mk('a', 'impl', 'web', 10), mk('c', 'lead', 'server', 5),
  mk('d', 'tester', 'web', 30, '테스터'), mk('e', 'impl', 'gone', 1), mk('f', 'impl', null, 2),
];
const ids = (lanes: ReturnType<typeof timelineLanes>) => lanes.map(l => [l.name, l.sessions.map(s => s.id)]);

test('timelineLanes keeps only the picked project, roles in order, oldest first', () => {
  assert.deepEqual(ids(timelineLanes(sessions, roles, 'web', known)), [['구현자', ['a', 'b']], ['테스터', ['d']]]);
  assert.deepEqual(ids(timelineLanes(sessions, roles, 'server', known)), [['관리자', ['c']]]);
});

test('timelineLanes files unknown and missing folders under 미분류 and shows everything under 전체', () => {
  assert.deepEqual(ids(timelineLanes(sessions, roles, null, known)), [['구현자', ['e', 'f']]]);
  assert.deepEqual(ids(timelineLanes(sessions, roles, undefined, known)), [['관리자', ['c']], ['구현자', ['e', 'f', 'a', 'b']], ['테스터', ['d']]]);
});

test('timelineLanes shows nothing while 미분류 waits for the project list, and for a project with no sessions', () => {
  assert.deepEqual(timelineLanes(sessions, roles, null, known, true), []);
  assert.deepEqual(timelineLanes(sessions, roles, 'docs', known), []);
});
