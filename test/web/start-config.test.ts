import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Plan } from '../../shared/dispatch/plan.ts';
import { startBody } from '../../web/src/run/planStripModel.ts';
import { claudeSessions, recommendModel, sessionCount, startRows, toOverrides } from '../../web/src/run/startConfig.ts';
import type { ModelCatalog } from '../../web/src/run/stepModels.ts';

const model = (id: string, provider = 'claude') => ({ id, label: id, provider, efforts: ['low', 'high'], defaultEffort: 'high', contextWindow: 1 });
const prov = (connected: boolean) => ({ name: 'x', installed: true, cliLoggedIn: connected, cli: null, connected, method: null, busy: false });
const cat = (over: Partial<ModelCatalog> = {}): ModelCatalog => ({
  models: [model('claude-opus-5-5'), model('claude-sonnet-5-5'), model('gpt-5', 'openai')],
  roles: [
    { id: 'impl', name: '구현자', model: 'claude-sonnet-5-5', perm: 'acceptEdits', prompt: '' },
    { id: 'review', name: '리뷰어', model: 'claude-opus-5-5', perm: 'plan', prompt: '' },
  ],
  perms: ['manual', 'acceptEdits', 'auto', 'plan'],
  providers: { claude: prov(true), openai: prov(false) },
  ...over,
});
const plan: Plan = {
  v: 1,
  block: 'b',
  steps: [
    { id: 'auth', node: 'auth', role: 'impl', task: '로그인 인증 고치기' },
    { id: 'ui', node: 'ui', role: 'impl', model: 'claude-sonnet-5-5', n: 2 },
    { id: 'review', node: 'review', role: 'review', after: ['auth', 'ui'] },
  ],
};

test('recommends Opus for implementers and Sonnet for reviewers, two reviewers on a risky step (#972)', () => {
  const rows = startRows(plan, cat());
  assert.equal(rows[0]!.model, 'claude-opus-5-5');
  assert.equal(rows[1]!.model, 'claude-sonnet-5-5', "the plan's own model stays");
  assert.equal(rows[2]!.model, 'claude-sonnet-5-5');
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 2]);
  assert.equal(rows[2]!.risky, true);
  assert.equal(sessionCount(rows), 5);
});

test('a provider that is not connected is never recommended', () => {
  const c = cat({ providers: { claude: prov(false), openai: prov(true) } });
  assert.equal(recommendModel('impl', 'claude-sonnet-5-5', c), 'gpt-5');
  // Codex runs plan and auto only: an acceptEdits role fits to the strictest it can run.
  assert.equal(startRows(plan, c)[0]!.perm, 'plan');
});

test('only what differs from the plan file goes along as overrides', () => {
  const c = cat();
  const rows = startRows(plan, c);
  // Recommendation: the auth step moves from the role model (sonnet) to opus, and review runs two sessions.
  assert.deepEqual(toOverrides(plan, rows, c), { auth: { model: 'claude-opus-5-5' }, review: { model: 'claude-sonnet-5-5', n: 2 } });
  // The person puts everything back: nothing to send.
  const asPlanned = rows.map((r) => (r.id === 'auth' ? { ...r, model: 'claude-sonnet-5-5' } : r.id === 'review' ? { ...r, model: 'claude-opus-5-5', n: 1 } : r));
  assert.deepEqual(toOverrides(plan, asPlanned, c), {});
  assert.equal(claudeSessions(rows, c), 5);
});

test('the start request carries overrides only when there are some', () => {
  assert.deepEqual(startBody('a', { revision: 2 }), { path: 'a', revision: 2 });
  assert.deepEqual(startBody('a', { revision: 2 }, {}), { path: 'a', revision: 2 });
  assert.deepEqual(startBody('a', { revision: 2 }, { s: { n: 2 } }), { path: 'a', revision: 2, overrides: { s: { n: 2 } } });
});
