import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan } from '../../shared/dispatch/plan.ts';
import { GAP_X, NODE_W, PAD, planGraph } from '../../web/src/run/planGraphModel.ts';

const plan: Plan = {
  v: 1,
  block: 'b1',
  steps: [
    { id: 'plan', node: 'plan', role: 'lead' },
    { id: 'api', node: 'api', role: 'impl' },
    { id: 'web', node: 'web', role: 'impl' },
    { id: 'review', node: 'review', role: 'review' },
  ],
};
const blocks = [{ id: 'b1', type: 'flowchart', code: 'plan [label: "계획"]\nplan > api\nplan > web\napi > review\nweb > review' }];
const labels = new Map([['plan', '계획']]);

test('steps lay out left to right by dependency depth, rows in plan order', () => {
  const g = planGraph(plan, blocks, [], labels);
  assert.equal(g.problem, null);
  assert.deepEqual(
    g.nodes.map((n) => [n.id, n.col, n.row]),
    [['plan', 0, 0], ['api', 1, 0], ['web', 1, 1], ['review', 2, 0]],
  );
  assert.equal(g.nodes[1]!.x, PAD + NODE_W + GAP_X);
  assert.equal(g.width, PAD * 2 + 3 * NODE_W + 2 * GAP_X);
  assert.equal(g.nodes[0]!.title, '계획');
  assert.equal(g.nodes[1]!.title, 'api');
});

test('one arrow per dependency, from the source right edge to the target left edge', () => {
  const g = planGraph(plan, blocks);
  assert.deepEqual(g.edges.map((e) => e.key).sort(), ['api>review', 'plan>api', 'plan>web', 'web>review']);
  const e = g.edges.find((x) => x.key === 'plan>api')!;
  assert.match(e.d, new RegExp(`^M ${PAD + NODE_W} `));
});

test('without a run every step is 대기; run views paint the #687 tones and badges', () => {
  assert.ok(planGraph(plan, blocks).nodes.every((n) => n.status.tone === 'pending' && n.badges.shown.length === 0));
  const g = planGraph(plan, blocks, [
    { id: 'plan', view: 'done', agents: [{ name: 'Mira', role: 'lead' }] },
    { id: 'api', view: 'active', agents: [{ name: 'Juno', role: 'impl' }] },
    { id: 'web', view: 'blocked', failed: true, agents: [{ name: 'Kai', role: 'impl' }] },
  ]);
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  assert.equal(by.get('plan')!.status.tone, 'done');
  assert.equal(by.get('api')!.status.tone, 'active');
  assert.equal(by.get('api')!.live, true);
  assert.equal(by.get('web')!.status.label, '실패');
  assert.equal(by.get('review')!.status.tone, 'pending');
  assert.equal(by.get('api')!.badges.shown[0]!.initial, 'J');
  assert.equal(by.get('api')!.label, '2 api · 진행 · Juno(구현자)');
  assert.equal(g.edges.find((e) => e.key === 'plan>api')!.done, true);
  assert.equal(g.edges.find((e) => e.key === 'api>review')!.done, false);
});

test('a plan whose order cannot be read shows its steps in plan order without arrows', () => {
  const g = planGraph(plan, [{ id: 'b1', type: 'flowchart', code: 'plan > api\napi > plan' }]);
  assert.match(g.problem ?? '', /cycle/);
  assert.equal(g.edges.length, 0);
  assert.deepEqual(g.nodes.map((n) => n.row), [0, 1, 2, 3]);
});

test('an empty plan draws nothing', () => {
  const g = planGraph({ v: 1, block: 'b1', steps: [] }, blocks);
  assert.deepEqual([g.nodes.length, g.width, g.height], [0, 0, 0]);
});
