import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowOf, teamCost, teamOf, verdict } from '../../web/src/live/issueTeam.ts';
import type { Session } from '../../shared/dispatch/types.ts';
import type { IssuePr } from '../../web/src/home/issueBoard.ts';
import type { Pr } from '../../web/src/home/projectFeeds.ts';

const sess = (id: string, role: string, model: string, cost: number | null, out = 100): Session =>
  ({ id, name: id, role, provider: 'claude', model, modelLabel: model, status: 'running', startedAt: 1_000, updatedAt: 61_000, cost, usage: { input: 10, output: out, cacheRead: 0, cacheWrite: 0 } }) as unknown as Session;
const pr = (n: number, state: IssuePr['state'], branch?: string): IssuePr => ({ number: n, state, branch });
const ans = (m: Record<string, Pr['review']>) => (b: string) => (b in m ? ({ number: 1, state: 'open', ci: 'none', review: m[b] } as Pr) : null);

test('teamOf lists leads before members', () => {
  assert.deepEqual(teamOf({ leads: [sess('L', 'lead', 'a', 1)], members: [sess('M', 'impl', 'b', 1)] }).map((s) => s.id), ['L', 'M']);
});

test('verdict: changes wins, all approved is clear, otherwise waiting', () => {
  const prs = [pr(1, 'open', 'a'), pr(2, 'open', 'b')];
  assert.equal(verdict(prs, ans({ a: 'approved', b: 'changes' })).key, 'must-fix');
  assert.equal(verdict(prs, ans({ a: 'approved', b: 'approved' })).key, 'clear');
  assert.equal(verdict(prs, ans({ a: 'approved' })).key, 'waiting');
  assert.equal(verdict([pr(3, 'merged', 'c')], ans({})).key, 'none');
});

test('flowOf pairs branches with PRs, keeps PRs without a known branch, skips closed', () => {
  const f = flowOf(['feat/1-a', 'feat/1-b'], [pr(5, 'open', 'feat/1-a'), pr(6, 'closed', 'feat/1-b'), pr(7, 'merged')]);
  assert.deepEqual(f.map((x) => [x.branch, x.pr?.number ?? null]), [['feat/1-a', 5], ['feat/1-b', null], ['', 7]]);
});

test('teamCost leaves the lead out of sums and groups by model', () => {
  const c = teamCost([sess('L', 'lead', 'sonnet', 9), sess('A', 'impl', 'opus', 1.5, 90), sess('B', 'impl', 'opus', 0.5, 90), sess('C', 'review', 'sonnet', null, 40)], 61_000);
  assert.equal(c.shared, 1);
  assert.equal(c.cost, 2);
  assert.equal(c.tokens, 100 + 100 + 50);
  assert.equal(c.ms, 60_000 * 3);
  assert.deepEqual(c.byModel.map((m) => [m.model, m.sessions, m.cost]), [['opus', 2, 2], ['sonnet', 1, null]]);
  assert.equal(teamCost([sess('L', 'lead', 'x', 3)]).cost, null);
});
