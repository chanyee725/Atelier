// #557: the last picture a document diagram showed is remembered per file, so two files with the same block id never
// morph from each other's picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShownMemory } from '../../web/src/doc/shownMemory.ts';

test('the same block id in two files keeps two pictures', () => {
  const m = createShownMemory<string>();
  m.set(m.keyOf('a.dpx.json', 'b1', 'light'), 'pic A');
  assert.equal(m.get(m.keyOf('b.dpx.json', 'b1', 'light')), undefined);
  m.set(m.keyOf('b.dpx.json', 'b1', 'light'), 'pic B');
  assert.equal(m.get(m.keyOf('a.dpx.json', 'b1', 'light')), 'pic A');
  assert.equal(m.get(m.keyOf('a.dpx.json', 'b1', 'dark')), undefined);
});

test('keeps at most 100 pictures and drops the least recently shown first', () => {
  const m = createShownMemory<number>();
  for (let i = 0; i < 100; i++) m.set(m.keyOf('f', `b${i}`, 'light'), i);
  m.set(m.keyOf('f', 'b0', 'light'), 0); // shown again: now the newest
  m.set(m.keyOf('f', 'b100', 'light'), 100);
  assert.equal(m.size, 100);
  assert.equal(m.get(m.keyOf('f', 'b0', 'light')), 0);
  assert.equal(m.get(m.keyOf('f', 'b1', 'light')), undefined);
});
