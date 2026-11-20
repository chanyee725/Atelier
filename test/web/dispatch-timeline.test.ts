import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpans, teamBusy, timelineTeams } from '../../web/src/dispatch/lib/timeline.ts';

const mk = (id: string, role: string, folder: string | null, startedAt: number, parent: string | null = null) => ({ id, role, folder, startedAt, parent });
const roles = [{ id: 'lead' }, { id: 'impl' }, { id: 'review' }];
const known = new Set(['web', 'server']);
const sessions = [
  mk('L2', 'lead', 'web', 50),
  mk('rv', 'review', 'web', 12, 'L1'),
  mk('i2', 'impl', 'web', 20, 'L1'),
  mk('L1', 'lead', 'web', 10),
  mk('i1', 'impl', 'web', 11, 'L1'),
  mk('x', 'tester', 'web', 13, 'i1'),
  mk('s', 'lead', 'server', 5),
  mk('orphan', 'impl', 'web', 30, 'gone'),
  mk('e', 'impl', null, 2),
];
const ids = (teams: ReturnType<typeof timelineTeams>) => teams.map(t => [t.lead.id, t.members.map(s => s.id)]);

test('timelineTeams groups a project by lead, members in role order then oldest first', () => {
  assert.deepEqual(ids(timelineTeams(sessions, roles, 'web', known)), [
    ['L1', ['i1', 'i2', 'rv', 'x']],
    ['orphan', []],
    ['L2', []],
  ]);
});

test('timelineTeams heads a team with a session whose parent is out of view, and keeps scopes apart', () => {
  assert.deepEqual(ids(timelineTeams(sessions, roles, 'server', known)), [['s', []]]);
  assert.deepEqual(ids(timelineTeams(sessions, roles, null, known)), [['e', []]]);
  assert.equal(timelineTeams(sessions, roles, undefined, known).length, 5);
});

test('timelineTeams shows nothing while 미분류 waits, and survives a parent loop', () => {
  assert.deepEqual(timelineTeams(sessions, roles, null, known, true), []);
  const loop = [mk('a', 'impl', 'web', 1, 'b'), mk('b', 'impl', 'web', 2, 'a')];
  const shown = timelineTeams(loop, roles, 'web', known).flatMap(t => [t.lead, ...t.members]).map(s => s.id).sort();
  assert.deepEqual(shown, ['a', 'b']);
});

test('teamBusy opens teams with someone working, waiting or stuck', () => {
  assert.equal(teamBusy(['resting', 'working']), true);
  assert.equal(teamBusy(['waiting']), true);
  assert.equal(teamBusy(['resting', 'done', 'failed']), false);
  assert.equal(teamBusy([]), false);
});

test('mergeSpans keeps the strongest state at each moment and joins neighbours', () => {
  const lead = { spans: [{ state: 'resting', from: 0, to: 100 }], fails: [] };
  const a = { spans: [{ state: 'working', from: 10, to: 30 }, { state: 'resting', from: 30, to: 100 }], fails: [40] };
  const b = { spans: [{ state: 'waiting', from: 20, to: 50 }, { state: 'failed', from: 50, to: 100 }], fails: [50, 40] };
  assert.deepEqual(mergeSpans([lead, a, b]), {
    spans: [
      { state: 'resting', from: 0, to: 10 },
      { state: 'working', from: 10, to: 30 },
      { state: 'waiting', from: 30, to: 50 },
      { state: 'failed', from: 50, to: 100 },
    ],
    fails: [40, 50],
  });
});

test('mergeSpans leaves gaps no member covers empty', () => {
  const a = { spans: [{ state: 'working', from: 0, to: 10 }], fails: [] };
  const b = { spans: [{ state: 'working', from: 20, to: 30 }], fails: [] };
  assert.deepEqual(mergeSpans([a, b]).spans, [{ state: 'working', from: 0, to: 10 }, { state: 'working', from: 20, to: 30 }]);
  assert.deepEqual(mergeSpans([]), { spans: [], fails: [] });
});
