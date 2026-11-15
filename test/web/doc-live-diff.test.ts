// E520: block diff of an outside document change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockSig, blocksOf, diffBlocks } from '../../web/src/doc/liveDiff.ts';

const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const h = (t: string, id?: string) => ({ type: 'heading', attrs: { level: 2, ...(id ? { id } : {}) }, content: [{ type: 'text', text: t }] });

test('identical documents produce no edits', () => {
  assert.deepEqual(diffBlocks([p('a'), h('b')], [p('a'), h('b')]), []);
});

test('appended blocks are inserts at the end', () => {
  assert.deepEqual(diffBlocks([p('a')], [p('a'), p('b'), h('c')]), [
    { op: 'insert', to: 1, before: 1 },
    { op: 'insert', to: 2, before: 1 },
  ]);
});

test('changed text of the same block type is an update in place', () => {
  assert.deepEqual(diffBlocks([p('a'), p('b'), p('c')], [p('a'), p('B!'), p('c')]), [{ op: 'update', from: 1, to: 1 }]);
});

test('a paragraph turned into a heading is a remove plus an insert', () => {
  assert.deepEqual(diffBlocks([p('a'), p('b')], [p('a'), h('b')]), [
    { op: 'insert', to: 1, before: 1 },
    { op: 'remove', from: 1 },
  ]);
});

test('removed and inserted blocks in the middle keep the neighbours', () => {
  const edits = diffBlocks([p('a'), p('x'), p('c')], [p('a'), p('c')]);
  assert.deepEqual(edits, [{ op: 'remove', from: 1 }]);
  assert.deepEqual(diffBlocks([p('a'), p('c')], [p('a'), p('x'), p('c')]), [{ op: 'insert', to: 1, before: 1 }]);
});

test('a heading id the editor added is not a change', () => {
  assert.equal(blockSig(h('t', 'abc')), blockSig(h('t')));
  assert.deepEqual(diffBlocks([h('t', 'abc')], [h('t')]), []);
});

test('empty and malformed inputs', () => {
  assert.deepEqual(diffBlocks([], []), []);
  assert.deepEqual(blocksOf(null), []);
  assert.deepEqual(blocksOf({ type: 'doc' }), []);
  assert.equal(diffBlocks([], [p('a')]).length, 1);
});

test('a long burst of appended paragraphs stays cheap and ordered', () => {
  const a = Array.from({ length: 2000 }, (_, i) => p(`p${i}`));
  const b = [...a, ...Array.from({ length: 50 }, (_, i) => p(`n${i}`))];
  const edits = diffBlocks(a, b);
  assert.equal(edits.length, 50);
  assert.ok(edits.every((e) => e.op === 'insert'));
});
