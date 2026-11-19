import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPage, pageCount, pageSlice, pagerItems, rowsThatFit } from '../../web/src/home/paging.ts';

test('pageCount: at least one page, rounds up', () => {
  assert.equal(pageCount(0, 12), 1);
  assert.equal(pageCount(12, 12), 1);
  assert.equal(pageCount(13, 12), 2);
  assert.equal(pageCount(26, 12), 3);
  assert.equal(pageCount(5, 0), 5);
});

test('clampPage keeps the page inside the list after it shrinks', () => {
  assert.equal(clampPage(3, 26, 12), 3);
  assert.equal(clampPage(3, 13, 12), 2);
  assert.equal(clampPage(0, 26, 12), 1);
  assert.equal(clampPage(Number.NaN, 26, 12), 1);
});

test('pageSlice returns the rows of one page', () => {
  const rows = Array.from({ length: 26 }, (_, i) => i + 1);
  assert.deepEqual(pageSlice(rows, 1, 12), rows.slice(0, 12));
  assert.deepEqual(pageSlice(rows, 3, 12), [25, 26]);
  assert.deepEqual(pageSlice(rows, 9, 12), [25, 26]);
  assert.deepEqual(pageSlice([], 1, 12), []);
});

test('rowsThatFit floors to whole rows within min..max', () => {
  assert.equal(rowsThatFit(37 * 8 + 20, 37, 5, 15), 8);
  assert.equal(rowsThatFit(40, 37, 5, 15), 5);
  assert.equal(rowsThatFit(5000, 37, 5, 15), 15);
  assert.equal(rowsThatFit(-100, 37, 5, 15), 5);
  assert.equal(rowsThatFit(Number.NaN, 37, 5, 15), 15);
});

test('pagerItems: all pages up to 7, else ends, neighbours and gaps', () => {
  assert.deepEqual(pagerItems(1, 3), [1, 2, 3]);
  assert.deepEqual(pagerItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pagerItems(1, 12), [1, 2, 3, 4, 5, 'gap', 12]);
  assert.deepEqual(pagerItems(6, 12), [1, 'gap', 5, 6, 7, 'gap', 12]);
  assert.deepEqual(pagerItems(12, 12), [1, 'gap', 8, 9, 10, 11, 12]);
});
