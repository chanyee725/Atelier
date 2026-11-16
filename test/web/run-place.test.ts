import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene } from '../../shared/render/index.ts';
import { canPlace, endMorphOpacity, MORPH_OPACITY, placeRuns, samePlaced, unplaced, type PlaceEl, type PlaceView } from '../../web/src/canvas/runPlace.ts';
import { clearRuns, runStepsFor, setRunSteps, setStill } from '../../web/src/run/runStore.ts';
import * as store from '../../web/src/run/runStore.ts';
import { FIXTURE_STEPS } from '../../web/src/run/fixture.ts';

const scene = { width: 200, height: 100 } as unknown as Scene;
const pics: Record<string, { width: number; scene?: Scene }> = { f1: { width: 200, scene }, f2: { width: 400, scene }, ph: { width: 200 } };
const pictureOf = (id: string) => pics[id];
const view: PlaceView = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
const wrap = { left: 0, top: 0 };
const runs = new Set(['b1', 'b2']);
const img = (id: string, blockId: string, over: Partial<PlaceEl> = {}): PlaceEl => ({ id, type: 'image', x: 10, y: 20, width: 200, height: 100, opacity: 100, angle: 0, fileId: 'f1', customData: { blockId }, ...over });

test('placeRuns: one board per run block, at the picture position', () => {
  const out = placeRuns([img('e1', 'b1'), img('e2', 'other')], view, wrap, runs, pictureOf, null);
  assert.deepEqual(out, [{ blockId: 'b1', scene, left: 10, top: 20, scale: 1 }]);
});

test('placeRuns: hidden (layout edit), transparent, rotated, deleted and non-image elements are skipped', () => {
  assert.deepEqual(placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, 'b1'), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { opacity: 0 })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { angle: 0.3 })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { isDeleted: true })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { type: 'rectangle' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { width: 0 })], view, wrap, runs, pictureOf, null), []);
});

test('placeRuns: a placeholder picture (no scene) or an unknown file is skipped', () => {
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: 'ph' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: 'nope' })], view, wrap, runs, pictureOf, null), []);
  assert.deepEqual(placeRuns([img('e1', 'b1', { fileId: null })], view, wrap, runs, pictureOf, null), []);
});

test('placeRuns: copies of one block draw once, on the first drawable copy', () => {
  const out = placeRuns([img('e1', 'b1', { opacity: 0 }), img('e2', 'b1', { x: 50 }), img('e3', 'b1', { x: 90 })], view, wrap, runs, pictureOf, null);
  assert.deepEqual(out.map((p) => [p.blockId, p.left]), [['b1', 50]]);
});

test('placeRuns: scroll, zoom, canvas offset and the wrapper position move and scale the board', () => {
  const st: PlaceView = { scrollX: 5, scrollY: -10, zoom: { value: 2 }, offsetLeft: 100, offsetTop: 40 };
  // Image drawn at half its picture's width: scale 0.5 × zoom 2.
  const [p] = placeRuns([img('e1', 'b2', { fileId: 'f2' })], st, { left: 60, top: 30 }, runs, pictureOf, null);
  assert.deepEqual(p, { blockId: 'b2', scene, left: (10 + 5) * 2 + 40, top: (20 - 10) * 2 + 10, scale: 1 });
});

test('samePlaced compares every field', () => {
  const a = placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, null);
  assert.ok(samePlaced(a, placeRuns([img('e1', 'b1')], view, wrap, runs, pictureOf, null)));
  assert.ok(!samePlaced(a, placeRuns([img('e1', 'b1', { x: 11 })], view, wrap, runs, pictureOf, null)));
  assert.ok(!samePlaced(a, []));
});

test('runStore: setRunSteps sets and null removes; clearRuns empties', () => {
  clearRuns();
  setRunSteps('b1', FIXTURE_STEPS);
  assert.equal(runStepsFor('b1'), FIXTURE_STEPS);
  setRunSteps('b1', null);
  assert.equal(runStepsFor('b1'), undefined);
  setRunSteps('b1', FIXTURE_STEPS);
  setRunSteps('b2', FIXTURE_STEPS);
  clearRuns();
  assert.equal(runStepsFor('b1'), undefined);
  assert.equal(runStepsFor('b2'), undefined);
});

test('runStore: setStill with the same value does not notify', () => {
  setStill(false);
  let calls = 0;
  const unsub = store.subscribeForTests(() => calls++);
  setStill(false);
  assert.equal(calls, 0);
  setStill(true);
  assert.equal(calls, 1);
  setStill(true);
  assert.equal(calls, 1);
  setStill(false);
  unsub();
});

// #556: a morph only plays where placeRuns puts a layer; anything it skips must not be left at MORPH_OPACITY.
test('canPlace: same skip rules as placeRuns for the element itself', () => {
  assert.equal(canPlace(img('e1', 'b1')), true);
  assert.equal(canPlace(img('e1', 'b1', { angle: 0.3 })), false);
  assert.equal(canPlace(img('e1', 'b1', { opacity: 0 })), false);
  assert.equal(canPlace(img('e1', 'b1', { isDeleted: true })), false);
  assert.equal(canPlace(img('e1', 'b1', { type: 'rectangle' })), false);
  assert.equal(canPlace(img('e1', 'b1', { width: 0 })), false);
});

test('unplaced: morph blocks with no placed layer are reported, placed ones are not', () => {
  const placed = placeRuns([img('e1', 'b1'), img('e2', 'b2', { angle: 0.3 })], view, wrap, runs, pictureOf, null);
  assert.deepEqual(unplaced(runs, placed), ['b2']);
  assert.deepEqual(unplaced(new Set(['b1']), placed), []);
});

test('a block rotated, hidden or deleted mid-morph is ended and gets its own opacity back (#556, #569)', () => {
  // b1 morphs (its image at MORPH_OPACITY, its own opacity 60); mid-play the user rotates, deletes or hides it.
  const withOpacity = (e: PlaceEl, opacity: number) => ({ ...e, opacity });
  const playing = img('e1', 'b1', { opacity: MORPH_OPACITY });
  for (const mid of [{ angle: 0.3 }, { isDeleted: true }]) {
    const els = [{ ...playing, ...mid }, img('e2', 'b2', { opacity: MORPH_OPACITY })];
    const ended = unplaced(new Set(['b1']), placeRuns(els, view, wrap, new Set(['b1']), pictureOf, null));
    assert.deepEqual(ended, ['b1']);
    const next = endMorphOpacity(els, 'b1', 60, withOpacity)!;
    assert.equal(next[0]!.opacity, 60);
    assert.equal(next[0]!.angle ?? 0, mid.angle ?? 0);
    assert.equal(next[0]!.isDeleted, mid.isDeleted);
    // Another block's morph is untouched.
    assert.equal(next[1], els[1]);
  }
  // Hidden by the user (opacity 0): ended too, but their opacity wins over the one from before the morph.
  const hidden = [img('e1', 'b1', { opacity: 0 })];
  assert.deepEqual(unplaced(new Set(['b1']), placeRuns(hidden, view, wrap, new Set(['b1']), pictureOf, null)), ['b1']);
  assert.equal(endMorphOpacity(hidden, 'b1', 60, withOpacity), null);
  // Every copy of the block still at the morph opacity is restored.
  const copies = endMorphOpacity([playing, img('e3', 'b1', { opacity: MORPH_OPACITY, x: 300 })], 'b1', 60, withOpacity)!;
  assert.deepEqual(copies.map((e) => e.opacity), [60, 60]);
});
