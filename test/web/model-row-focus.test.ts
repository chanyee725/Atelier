// #550: sidebar model-row focus following ends once the user leaves the row and its ⋯ menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterSwap, leftRow, type Area } from '../../web/src/modelRowFocus.ts';

type El = { name: string; isConnected: boolean };
const el = (name: string, isConnected = true): El => ({ name, isConnected });
const area = (...kids: El[]): Area => ({ contains: (n) => kids.includes(n as unknown as El) });
const t = (e: El) => e as unknown as EventTarget;

const connect = el('connect');
const more = el('more');
const item = el('menu item');
const outside = el('theme');
const row = area(connect, more);
const menu = area(item);

test('focusout to an element outside the row and menu ends tracking', () => {
  assert.equal(leftRow('focusout', t(outside), [row, menu]), true);
  assert.equal(leftRow('focusout', t(more), [row, menu]), false, 'moving within the row');
  assert.equal(leftRow('focusout', t(item), [row, null, menu]), false, 'into the portalled ⋯ menu');
});

test('focusout to <body> (relatedTarget null) keeps tracking: it is also what a removed button does', () => {
  assert.equal(leftRow('focusout', null, [row, menu]), false);
});

test('a press outside ends tracking, a press in the row or menu does not', () => {
  assert.equal(leftRow('pointerdown', t(outside), [row, menu]), true);
  assert.equal(leftRow('pointerdown', null, [row, menu]), true);
  assert.equal(leftRow('pointerdown', t(connect), [row, menu]), false);
  assert.equal(leftRow('pointerdown', t(item), [row, menu]), false);
});

test('afterSwap: removed button with focus on <body> moves focus to the new button and tracks it', () => {
  const body = el('body');
  const gone = el('connect', false);
  assert.deepEqual(afterSwap(gone, body, body, row, () => more), { focus: more, track: more });
  assert.deepEqual(afterSwap(gone, null, body, row, () => more), { focus: more, track: more });
});

test('afterSwap: nothing tracked or tracked button still there changes nothing', () => {
  const body = el('body');
  assert.deepEqual(afterSwap(null, body, body, row, () => more), { focus: null, track: null });
  assert.deepEqual(afterSwap(more, body, body, row, () => connect), { focus: null, track: more });
});

test('afterSwap: focus elsewhere follows inside the row, stops outside', () => {
  const body = el('body');
  const gone = el('menu item', false);
  assert.deepEqual(afterSwap(gone, more, body, row, () => connect), { focus: null, track: more });
  assert.deepEqual(afterSwap(gone, outside, body, row, () => connect), { focus: null, track: null });
});

test('no-op, then a press on an empty spot, then an outside change: focus is not pulled back', () => {
  const body = el('body');
  // 다시 확인 from the ⋯ menu: the menu item closes, Radix hands focus back to ⋯, which is now tracked.
  let tracked: El | null = afterSwap(el('menu item', false), more, body, row, () => more).track;
  assert.equal(tracked, more);
  // The user presses an empty spot outside: tracking ends.
  if (leftRow('pointerdown', t(outside), [row, menu])) tracked = null;
  // Later another tab disconnects: ⋯ is removed, focus is on <body>, nothing moves.
  more.isConnected = false;
  assert.deepEqual(afterSwap(tracked, body, body, row, () => connect), { focus: null, track: null });
  more.isConnected = true;
});
