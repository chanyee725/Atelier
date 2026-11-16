import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshClass, isFresh, noteTree } from '../../web/src/freshPaths.ts';

test('first tree seeds; later new paths are fresh for a short while', () => {
  noteTree([{ path: 'a', children: [{ path: 'a/b' }] }]);
  assert.equal(isFresh('a'), false);
  noteTree([{ path: 'a', children: [{ path: 'a/b' }, { path: 'a/c' }] }], [{ path: 'p', docs: [] }]);
  assert.equal(isFresh('a/c'), true);
  assert.equal(freshClass('p'), 'live-row-enter');
  assert.equal(freshClass('a/b'), '');
  assert.equal(isFresh('a/c', Date.now() + 5000), false);
});
