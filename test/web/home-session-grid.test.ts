import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colsThatFit, perCard, rowSizes } from '../../web/src/home/sessionGrid.ts';

test('rowSizes: fewest rows, spread evenly, no ragged row', () => {
  assert.deepEqual(rowSizes(0, 3), []);
  assert.deepEqual(rowSizes(1, 3), [1]);
  assert.deepEqual(rowSizes(4, 3), [2, 2]);
  assert.deepEqual(rowSizes(7, 3), [3, 2, 2]);
  assert.deepEqual(rowSizes(12, 3), [3, 3, 3, 3]);
  assert.deepEqual(rowSizes(5, 4), [3, 2]);
  assert.deepEqual(rowSizes(3, 1), [1, 1, 1]);
  assert.deepEqual(rowSizes(3, 0), [1, 1, 1]);
});

test('colsThatFit keeps cards at their minimum width', () => {
  assert.equal(colsThatFit(700, 224, 8, 4), 3);
  assert.equal(colsThatFit(455, 224, 8, 4), 1);
  assert.equal(colsThatFit(456, 224, 8, 4), 2);
  assert.equal(colsThatFit(2000, 224, 8, 4), 4);
  assert.equal(colsThatFit(0, 224, 8, 4), 1);
  assert.equal(colsThatFit(Number.NaN, 224, 8, 4), 1);
});

test('perCard repeats each row size for its cards', () => {
  assert.deepEqual(perCard([3, 2, 2]), [3, 3, 3, 2, 2, 2, 2]);
  assert.deepEqual(perCard([]), []);
});
