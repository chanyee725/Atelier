// Agent live view client helpers (E559, #728): hash sync, the raw-prefix sid filter, display formats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFromHash, withAgent } from '../../web/src/live/store.ts';
import { startsWithId } from '../../web/src/live/useAgentLive.ts';
import { clock, liveStateLabel, middle, span } from '../../web/src/live/format.ts';

test('the agent= hash part is read and written without touching the file part', () => {
  assert.equal(agentFromHash('#file=a.dpx.json&agent=s1'), 's1');
  assert.equal(agentFromHash('#agent=s%2F1'), 's/1');
  assert.equal(agentFromHash('#file=a.dpx.json'), null);
  assert.equal(agentFromHash('#file=x&h=agent=no'), null);
  assert.equal(withAgent('#file=a.dpx.json', 's1'), '#file=a.dpx.json&agent=s1');
  assert.equal(withAgent('#file=a.dpx.json&agent=old', 's2'), '#file=a.dpx.json&agent=s2');
  assert.equal(withAgent('#file=a.dpx.json&agent=s1', null), '#file=a.dpx.json');
  assert.equal(withAgent('', 's1'), '#agent=s1');
  assert.equal(withAgent('#agent=s1', null), '');
});

test('events of other agents are dropped from the raw text, before parsing', () => {
  const sid = 'a1b2';
  assert.ok(startsWithId(JSON.stringify({ sid, current: null }), 'sid', sid));
  assert.ok(!startsWithId(JSON.stringify({ sid: 'a1b2c', current: null }), 'sid', sid));
  assert.ok(startsWithId(JSON.stringify({ id: sid, n: 1 }), 'id', sid));
  assert.ok(!startsWithId(JSON.stringify({ id: 'zz', parent: sid }), 'id', sid));
});

test('display formats', () => {
  assert.equal(span(42_000), '42초');
  assert.equal(span(12 * 60_000), '12분');
  assert.equal(span(64 * 60_000), '1시간 4분');
  assert.equal(clock(42_000), '0:42');
  assert.equal(clock(3_723_000), '1:02:03');
  assert.equal(middle('short'), 'short');
  const m = middle('server/dispatch/very/long/path/to/some/file/app.js', 20);
  assert.equal(m.length, 20);
  assert.ok(m.includes('…') && m.endsWith('app.js'));
  assert.equal(liveStateLabel('working', false), '생각 중');
  assert.equal(liveStateLabel('working', true), '작업 중');
  assert.equal(liveStateLabel('done', false), '끝났어요');
});
