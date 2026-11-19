import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODE_TONES, nodeStatus } from '../../web/src/run/nodeStatus.ts';

test('each view maps to its tone: gray pending, blue active and review, green done, purple blocked', () => {
  assert.equal(nodeStatus({ view: 'pending' }).tone, 'pending');
  assert.equal(nodeStatus({ view: 'active' }).tone, 'active');
  assert.equal(nodeStatus({ view: 'review' }).tone, 'active');
  assert.equal(nodeStatus({ view: 'review' }).label, '리뷰');
  assert.equal(nodeStatus({ view: 'done' }).tone, 'done');
  assert.equal(nodeStatus({ view: 'blocked' }).tone, 'blocked');
  assert.equal(nodeStatus({ view: 'active' }).color, 'var(--step-active)');
  assert.equal(nodeStatus({ view: 'done' }).color, 'var(--step-done)');
});

test('a failed session paints red; a done step stays green', () => {
  const s = nodeStatus({ view: 'blocked', failed: true });
  assert.deepEqual(s, { tone: 'failed', color: 'var(--step-failed)', glyph: '✕', label: '실패' });
  assert.equal(nodeStatus({ view: 'done', failed: true }).tone, 'done');
});

test('waiting on a person is purple "결정 필요" while the step runs', () => {
  const s = nodeStatus({ view: 'active', waiting: true });
  assert.equal(s.tone, 'blocked');
  assert.equal(s.label, '결정 필요');
  assert.equal(s.color, 'var(--step-blocked)');
  assert.equal(nodeStatus({ view: 'pending', waiting: true }).tone, 'pending');
});

test('never colour alone: every tone has a distinct glyph and text', () => {
  const tones = Object.values(NODE_TONES);
  assert.equal(new Set(tones.map((t) => t.glyph)).size, tones.length);
  assert.equal(new Set(tones.map((t) => t.label)).size, tones.length);
  assert.equal(new Set(tones.map((t) => t.color)).size, tones.length);
});
