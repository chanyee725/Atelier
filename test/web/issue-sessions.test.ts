import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totals, type IssueSession } from '../../web/src/home/issueTotals.ts';

const s = (key: string, shared: boolean, cost: number | null, tokens: number): IssueSession => ({
  key, role: shared ? 'lead' : 'impl', provider: 'claude', model: 'm', effort: null, accountLabel: null,
  startedAt: 1, endedAt: 60_001, tokens, cost, shared,
});

test('totals leave shared (lead) sessions out and count them (#756)', () => {
  const list = [s('L', true, 5, 1000), s('I', false, 1, 10), s('J', false, null, 5)];
  assert.deepEqual(totals(list, 0), { shared: 1, ms: 120_000, tokens: 15, cost: 1 });
  assert.equal(totals(list.slice(0, 1), 0).cost, null, 'only shared sessions: no own cost');
});
