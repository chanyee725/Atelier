import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalAction, movedOpenPath } from '../../web/src/externalChange.ts';

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

test('canApplyLive: a writer that only reorders keys applies live instead of restarting the panes (#557)', async () => {
  const { canApplyLive, sameJson } = await import('../../web/src/externalChange.ts');
  const cur = { canvas: { elements: [{ id: 'e1', x: 1, y: 2 }], appState: { a: 1, b: 2 } }, blocks: [{ id: 'b1', x: 0, y: 0, w: 10, h: 10 }] };
  const next = { canvas: { appState: { b: 2, a: 1 }, elements: [{ y: 2, x: 1, id: 'e1' }] }, blocks: [{ h: 10, w: 10, y: 0, x: 0, id: 'b1' }] };
  assert.equal(canApplyLive(cur, next), true);
  assert.equal(canApplyLive(cur, { ...next, canvas: { ...next.canvas, appState: { b: 2, a: 3 } } }), false);
  assert.equal(sameJson({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(sameJson(undefined, null), true);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson({ a: [1] }, { a: { 0: 1 } }), false);
  assert.equal(sameJson({ a: 1 }, { b: 1 }), false);
  assert.equal(sameJson(0, null), false);
});

test('movedOpenPath: an outside move of the open file or its folder gives the new path (#1045)', () => {
  assert.equal(movedOpenPath({ kind: 'tree', from: '기획/로봇 제어', path: 'web/로봇 제어' }, '기획/로봇 제어/계획.dpx.json'), 'web/로봇 제어/계획.dpx.json');
  assert.equal(movedOpenPath({ kind: 'tree', from: 'a/x.dpx.json', path: 'b/x.dpx.json' }, 'a/x.dpx.json'), 'b/x.dpx.json');
  assert.equal(movedOpenPath({ kind: 'tree', from: '기획/로봇', path: 'web/로봇' }, '기획/로봇 제어/계획.dpx.json'), null);
  assert.equal(movedOpenPath({ kind: 'tree', path: 'web/x' }, 'web/x/a.dpx.json'), null);
  assert.equal(movedOpenPath({ kind: 'delete', from: 'a', path: 'a' }, 'a/b.dpx.json'), null);
  assert.equal(movedOpenPath({ kind: 'tree', from: 'a', path: 'b' }, null), null);
});
