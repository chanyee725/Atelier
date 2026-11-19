// #727: the document's agent area groups agents by role and caps the rows (+N) until expanded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capDots, layoutAgents, ROWS_MAX } from '../../web/src/doc/marginGroups.ts';

const agent = (sid: string, role: string, roleName?: string) => ({ sid, role, roleName });
const many = (n: number, role: string, from = 0) => Array.from({ length: n }, (_, i) => agent(`${role}${from + i}`, role));
const sids = (rows: { sid: string }[]) => rows.map((r) => r.sid);

test('layoutAgents: one agent is one group with its row, nothing hidden', () => {
  const l = layoutAgents([agent('a', 'impl')]);
  assert.equal(l.groups.length, 1);
  assert.equal(l.groups[0].label, '구현자');
  assert.deepEqual(sids(l.groups[0].shown), ['a']);
  assert.equal(l.hidden, 0);
  assert.equal(l.overflows, false);
});

test('layoutAgents: groups follow the pipeline role order, agents keep the order they came', () => {
  const l = layoutAgents([agent('r1', 'review'), agent('i1', 'impl'), agent('x1', 'custom', '번역가'), agent('i2', 'impl'), agent('l1', 'lead')]);
  assert.deepEqual(l.groups.map((g) => g.role), ['lead', 'impl', 'review', 'custom']);
  assert.deepEqual(l.groups.map((g) => g.label), ['관리자', '구현자', '리뷰어', '번역가']);
  assert.deepEqual(sids(l.groups[1].shown), ['i1', 'i2']);
  assert.equal(l.hidden, 0);
});

test('layoutAgents: an agent without a role goes under 기타', () => {
  assert.equal(layoutAgents([agent('a', '')]).groups[0].label, '기타');
});

test('layoutAgents: 20 agents show ROWS_MAX rows shared round-robin, every role keeps one, the rest is +N', () => {
  const cards = [...many(12, 'impl'), ...many(6, 'review'), ...many(2, 'docs')];
  const l = layoutAgents(cards);
  const shown = l.groups.flatMap((g) => g.shown);
  assert.equal(shown.length, ROWS_MAX);
  assert.equal(l.hidden, 20 - ROWS_MAX);
  assert.equal(l.overflows, true);
  assert.deepEqual(l.groups.map((g) => [g.role, g.shown.length, g.hidden]), [['impl', 2, 10], ['review', 2, 4], ['docs', 2, 0]]);
  // Expanded: all of them, still grouped.
  const all = layoutAgents(cards, { expanded: true });
  assert.equal(all.hidden, 0);
  assert.equal(all.overflows, true);
  assert.deepEqual(all.groups.map((g) => g.shown.length), [12, 6, 2]);
});

test('layoutAgents: one over the cap shows all (no "+1"); the open agent always shows, in its place', () => {
  const seven = many(ROWS_MAX + 1, 'impl');
  assert.equal(layoutAgents(seven).hidden, 0);
  assert.equal(layoutAgents(seven).overflows, false);
  const cards = many(10, 'impl');
  const l = layoutAgents(cards, { keep: 'impl8' });
  assert.deepEqual(sids(l.groups[0].shown), ['impl0', 'impl1', 'impl2', 'impl3', 'impl4', 'impl5', 'impl8']);
  assert.equal(l.hidden, 3);
});

test('capDots: the first dots and +N; one over shows all', () => {
  assert.deepEqual(capDots([1, 2, 3], 6), { shown: [1, 2, 3], more: 0 });
  assert.deepEqual(capDots([1, 2, 3, 4, 5, 6, 7], 6).more, 0);
  const c = capDots(Array.from({ length: 20 }, (_, i) => i), 6);
  assert.equal(c.shown.length, 6);
  assert.equal(c.more, 14);
});
