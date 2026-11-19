import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPath, pipelineTemplate, PIPELINE_STEPS, PLAN_FILE_STEM } from '../../web/src/pipelineTemplate.ts';
import { planProblem } from '../../shared/dispatch/plan.ts';
import { planOrderIn } from '../../shared/dispatch/plan-diagram.ts';

test('planPath puts a plan at <area>/<feature>/계획, never under pipelines/ (#782)', () => {
  assert.equal(planPath('Web', 'release'), 'Web/release/계획');
  assert.equal(planPath('Web', ' release.dpx '), 'Web/release/계획');
  assert.equal(planPath('Web', 'Server/release'), 'Server/release/계획');
  assert.equal(planPath('', 'release'), 'release/계획');
  assert.equal(planPath('/Web/', '/release/'), 'Web/release/계획');
  assert.equal(planPath('Web', '  '), '');
  assert.equal(PLAN_FILE_STEM, '계획');
});

test('pipelineTemplate: document sections, one flowchart block, a plan that runs in edge order', () => {
  const t = pipelineTemplate('b_test');
  assert.equal(planProblem(t.plan), null);
  assert.equal(t.blocks.length, 1);
  assert.equal(t.blocks[0]!.type, 'flowchart');
  assert.equal(t.plan!.block, 'b_test');
  const content = (t.document as { content: { type: string; attrs?: Record<string, unknown>; content?: { text: string }[] }[] }).content;
  assert.deepEqual(content.filter((n) => n.type === 'heading').map((n) => n.content![0]!.text), ['목표', '단계', '위험']);
  assert.ok(content.some((n) => n.type === 'diagram' && n.attrs?.blockId === 'b_test'));
  const order = planOrderIn(t.plan!, t.blocks);
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.deepEqual(order.ok && order.order, [...PIPELINE_STEPS]);
});
