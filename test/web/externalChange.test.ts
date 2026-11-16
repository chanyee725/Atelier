import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalAction } from '../../web/src/externalChange.ts';

const open = 'proj/arch.dpx.json';

test('the open file deleted or moved away closes it, so its save timer is cancelled', () => {
  assert.equal(externalAction({ kind: 'delete', path: 'proj/arch.dpx.json' }, open, true), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'x/arch.dpx.json', from: 'proj/arch' }, open, false), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'moved', from: 'proj' }, open, false), 'close');
});

test('a deleted folder closes a file open under it, and only that', () => {
  assert.equal(externalAction({ kind: 'tree', path: 'proj', from: 'proj' }, open, true), 'close');
  assert.equal(externalAction({ kind: 'tree', path: 'proj/sub', from: 'proj/sub' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'tree', path: 'pro', from: 'pro' }, open, false), 'refresh');
});

test('a changed open file reloads only when nothing is unsaved', () => {
  assert.equal(externalAction({ kind: 'change', path: open, revision: 4 }, open, false), 'reload');
  assert.equal(externalAction({ kind: 'change', path: open, revision: 4 }, open, true), 'refresh');
});

test('other files only refresh the list', () => {
  assert.equal(externalAction({ kind: 'delete', path: 'proj/other.dpx.json' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'create', path: open }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'tree', path: 'proj2' }, open, false), 'refresh');
  assert.equal(externalAction({ kind: 'delete', path: open }, null, false), 'refresh');
});

test('canApplyLive: same blocks in place with new code apply live; added, moved blocks or a changed scene restart', async () => {
  const { canApplyLive } = await import('../../web/src/externalChange.ts');
  const scene = { elements: [{ id: 'e1' }] };
  const blk = (code: string, x = 0) => ({ id: 'b1', type: 'flowchart', code, x, y: 0, w: 400, h: 300 });
  assert.equal(canApplyLive({ canvas: scene, blocks: [blk('A')] }, { canvas: { elements: [{ id: 'e1' }] }, blocks: [{ ...blk('A > B'), type: 'sequence', layout: { n: 1 } }] }), true);
  assert.equal(canApplyLive({ canvas: scene, blocks: [blk('A')] }, { canvas: scene, blocks: [blk('A', 50)] }), false);
  assert.equal(canApplyLive({ canvas: scene, blocks: [blk('A')] }, { canvas: scene, blocks: [blk('A'), { ...blk('B'), id: 'b2' }] }), false);
  assert.equal(canApplyLive({ canvas: scene, blocks: [] }, { canvas: { elements: [] }, blocks: [] }), false);
  assert.equal(canApplyLive(null, { canvas: scene }), false);
});
