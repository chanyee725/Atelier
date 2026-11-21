// E494: the canvas fits every block on a file's first open, and keeps the view the user left it at afterwards.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FIT_ALL_MIN_ZOOM, FIT_MAX_ZOOM, FIT_MIN_ZOOM, PANE_FIT, changedBlock, fitMinZoom, fitView, followFit, followView, forgetViews, openingView, rememberView, rememberedView } from '../../web/src/canvas/initialView.ts';

beforeEach(() => forgetViews());

/** Where scene point (x, y) lands on screen in a view (Excalidraw: (p + scroll) * zoom). */
const onScreen = (v: { scrollX: number; scrollY: number; zoom: number }, x: number, y: number) => ({ x: (x + v.scrollX) * v.zoom, y: (y + v.scrollY) * v.zoom });

test('two wide blocks side by side both fit a 1440x900 canvas', () => {
  // Block A at x=0 and block B at x=1000, each 900x420 (the issue repro).
  const v = fitView([0, 0, 1900, 420], 1440, 900)!;
  assert.ok(v.zoom < 1);
  for (const [x, y] of [[0, 0], [1900, 420]] as const) {
    const p = onScreen(v, x, y);
    assert.ok(p.x >= 0 && p.x <= 1440 && p.y >= 0 && p.y <= 900, `(${x},${y}) on screen at ${p.x},${p.y}`);
  }
  // Centred.
  const c = onScreen(v, 950, 210);
  assert.ok(Math.abs(c.x - 720) < 1e-6 && Math.abs(c.y - 450) < 1e-6);
});

test('the fitted zoom is rounded down to a 10% step and leaves a margin', () => {
  const v = fitView([0, 0, 1000, 100], 1000, 1000)!;
  // 1000/1000 * 0.9 = 0.9.
  assert.equal(v.zoom, 0.9);
  const w = fitView([0, 0, 1900, 420], 1440, 900)!;
  assert.equal(w.zoom, 0.6);
});

test('a small drawing is not blown up past 100%', () => {
  const v = fitView([100, 100, 300, 200], 1440, 900)!;
  assert.equal(v.zoom, FIT_MAX_ZOOM);
  const c = onScreen(v, 200, 150);
  assert.ok(Math.abs(c.x - 720) < 1e-6 && Math.abs(c.y - 450) < 1e-6);
});

test('a wide drawing stops at 60% (#987), centred, the rest a scroll away', () => {
  assert.equal(FIT_MIN_ZOOM, 0.6);
  for (const opts of [undefined, PANE_FIT]) {
    const v = fitView([0, 0, 1e6, 1e6], 1000, 1000, opts)!;
    assert.equal(v.zoom, FIT_MIN_ZOOM);
    const c = onScreen(v, 5e5, 5e5);
    assert.ok(Math.abs(c.x - 500) < 1e-6 && Math.abs(c.y - 500) < 1e-6, 'centred');
  }
});

test('the 60% floor is for a lone block only; several blocks or free shapes all come into view (#1005)', () => {
  assert.equal(fitMinZoom(['plan']), FIT_MIN_ZOOM);
  assert.equal(fitMinZoom(['plan', 'plan']), FIT_MIN_ZOOM, 'one block, however many elements');
  assert.equal(fitMinZoom(['a', 'b']), FIT_ALL_MIN_ZOOM);
  assert.equal(fitMinZoom(['a', null]), FIT_ALL_MIN_ZOOM, 'a block plus a free shape');
  assert.equal(fitMinZoom([null, null]), FIT_ALL_MIN_ZOOM);
  assert.equal(fitMinZoom([]), FIT_ALL_MIN_ZOOM);
  // Three blocks spread over 6000px: every corner on screen at the lower floor.
  const bounds = [0, 0, 6000, 2400] as const;
  for (const opts of [{ minZoom: FIT_ALL_MIN_ZOOM }, { ...PANE_FIT, minZoom: FIT_ALL_MIN_ZOOM }]) {
    const v = fitView(bounds, 1440, 900, opts)!;
    assert.ok(v.zoom < FIT_MIN_ZOOM && v.zoom >= FIT_ALL_MIN_ZOOM, `zoom ${v.zoom}`);
    for (const [x, y] of [[0, 0], [6000, 2400]] as const) {
      const p = onScreen(v, x, y);
      assert.ok(p.x >= 0 && p.x <= 1440 && p.y >= 0 && p.y <= 900, `(${x},${y}) on screen at ${p.x},${p.y}`);
    }
  }
  // Too big even for that: stops at Excalidraw's lowest zoom.
  assert.equal(fitView([0, 0, 1e6, 1e6], 1000, 1000, { minZoom: FIT_ALL_MIN_ZOOM })!.zoom, FIT_ALL_MIN_ZOOM);
});

test('nothing to fit: no shapes, a hidden canvas or broken bounds', () => {
  assert.equal(fitView(null, 1440, 900), null);
  assert.equal(fitView([0, 0, 10, 10], 0, 900), null);
  assert.equal(fitView([0, 0, 10, 10], 1440, 0), null);
  assert.equal(fitView([0, 0, Infinity, 10], 1440, 900), null);
  assert.equal(fitView([10, 0, 0, 10], 1440, 900), null);
});

test('a single point (one tiny shape) fits at 100% without dividing by zero', () => {
  const v = fitView([5, 5, 5, 5], 800, 600)!;
  assert.equal(v.zoom, 1);
  assert.deepEqual(onScreen(v, 5, 5), { x: 400, y: 300 });
});

test('first open fits; a view the user moved to is kept on the next open (reload, switching back)', () => {
  const first = openingView('a.dpx.json', [0, 0, 1900, 420], 1440, 900)!;
  assert.equal(first.zoom, 0.6);
  // Excalidraw reports the fitted view back: still not the user's.
  rememberView('a.dpx.json', first);
  assert.equal(rememberedView('a.dpx.json'), null);
  // The user zooms in on block B.
  const mine = { scrollX: -1200, scrollY: -100, zoom: 1.5 };
  rememberView('a.dpx.json', mine);
  assert.deepEqual(openingView('a.dpx.json', [0, 0, 5000, 5000], 1440, 900), mine);
  // Other files are not affected.
  assert.equal(openingView('b.dpx.json', [0, 0, 1900, 420], 1440, 900)!.zoom, 0.6);
});

test('a reload before the user moved the view fits again, so a block an agent added comes into view', () => {
  const first = openingView('a.dpx.json', [0, 0, 900, 420], 1440, 900)!;
  rememberView('a.dpx.json', first);
  const again = openingView('a.dpx.json', [0, 0, 1900, 420], 1440, 900)!;
  assert.equal(again.zoom, 0.6);
});

test('no path: always a fit, nothing remembered', () => {
  rememberView(undefined, { scrollX: 1, scrollY: 2, zoom: 3 });
  assert.equal(rememberedView(undefined), null);
  assert.equal(openingView(undefined, [0, 0, 1900, 420], 1440, 900)!.zoom, 0.6);
});

test('broken views are not remembered', () => {
  rememberView('a.dpx.json', { scrollX: NaN, scrollY: 0, zoom: 1 });
  rememberView('a.dpx.json', { scrollX: 0, scrollY: 0, zoom: 0 });
  assert.equal(rememberedView('a.dpx.json'), null);
});

test('an empty file opened at the default view fits once an agent adds blocks to it (E494b)', () => {
  // Nothing to fit: Excalidraw shows its own default view and reports it back once loaded.
  assert.equal(openingView('a.dpx.json', null, 1440, 900), null);
  rememberView('a.dpx.json', { scrollX: 720, scrollY: 450, zoom: 1 });
  assert.equal(rememberedView('a.dpx.json'), null);
  // An outside edit adds blocks at x=3000 and x=4600: the reload fits them.
  const v = openingView('a.dpx.json', [3000, 0, 4600, 420], 1440, 900)!;
  assert.ok(v.zoom < 1);
  for (const x of [3000, 4600]) {
    const p = onScreen(v, x, 0);
    assert.ok(p.x >= 0 && p.x <= 1440, `x=${x} on screen at ${p.x}`);
  }
});

test('the opening view is taken as such even when Excalidraw reports it back a hair off', () => {
  const fit = openingView('a.dpx.json', [0, 0, 1900, 420], 1440, 900)!;
  rememberView('a.dpx.json', { ...fit, scrollX: fit.scrollX + 1e-9 });
  assert.equal(rememberedView('a.dpx.json'), null);
});

test('a view the user moved to after an empty open is kept', () => {
  openingView('a.dpx.json', null, 1440, 900);
  rememberView('a.dpx.json', { scrollX: 720, scrollY: 450, zoom: 1 });
  const mine = { scrollX: 100, scrollY: 50, zoom: 0.5 };
  rememberView('a.dpx.json', mine);
  assert.deepEqual(openingView('a.dpx.json', [3000, 0, 6900, 420], 1440, 900), mine);
  // Reopening at the kept view: the next report is the user's view, not a new opening.
  const moved = { scrollX: 300, scrollY: 50, zoom: 0.5 };
  rememberView('a.dpx.json', moved);
  assert.deepEqual(rememberedView('a.dpx.json'), moved);
});

test('fitView with a pixel margin leaves 48px each side and may enlarge a small drawing', async () => {
  const { refitView } = await import('../../web/src/canvas/initialView.ts');
  const v = fitView([0, 0, 200, 100], 1000, 600, PANE_FIT)!;
  assert.equal(v.zoom, 2);
  assert.equal(fitView([0, 0, 200, 100], 1000, 600)!.zoom, 1);
  const big = fitView([0, 0, 1500, 700], 1000, 600, PANE_FIT)!;
  assert.ok(1500 * big.zoom <= 1000 - 96 + 1e-6 && 700 * big.zoom <= 600 - 96 + 1e-6);
  // refit: follows a resize until the user moves the view, then keeps it
  forgetViews();
  const first = openingView('a.dpx.json', [0, 0, 2000, 1000], 1000, 600, PANE_FIT)!;
  const wider = refitView('a.dpx.json', [0, 0, 2000, 1000], 1600, 900, first, PANE_FIT);
  assert.ok(wider && wider.zoom > first.zoom);
  assert.equal(refitView('a.dpx.json', [0, 0, 2000, 1000], 1600, 900, wider!, PANE_FIT), null);
  rememberView('a.dpx.json', wider!); // the view the fit reported (not a move)
  rememberView('a.dpx.json', { ...wider!, zoom: 0.5 }); // the user zooms
  assert.equal(refitView('a.dpx.json', [0, 0, 2000, 1000], 1000, 600, { ...wider!, zoom: 0.5 }, PANE_FIT), null);
  forgetViews();
});

test('while an agent writes, the fit follows the changed block at the 60% floor when the whole file would be smaller (#1043)', () => {
  // Two blocks side by side in the 둘 다 pane (456x730): the whole row fits only at ~20%.
  const all = [0, 0, 2000, 400] as const;
  const b2 = [1100, 0, 2000, 300] as const;
  const v = followFit(all, b2, 456, 730, PANE_FIT)!;
  assert.equal(v.zoom, FIT_MIN_ZOOM);
  const c = onScreen(v, 1550, 150);
  assert.ok(Math.abs(c.x - 228) < 1e-6 && Math.abs(c.y - 365) < 1e-6, 'the changed block is centred');
  // Everything fits at the floor or above: the whole file stays in view.
  const small = followFit([0, 0, 600, 200], [300, 0, 600, 200], 1440, 900)!;
  assert.equal(small.zoom, FIT_MAX_ZOOM);
  assert.deepEqual(followFit(all, null, 456, 730, PANE_FIT), fitView(all, 456, 730, { ...PANE_FIT, minZoom: FIT_ALL_MIN_ZOOM }));
});

test('followView refits only a view the user has not moved, and the refit is not taken as a move (#1043)', () => {
  const cur = { scrollX: 0, scrollY: 0, zoom: 1 };
  openingView('f', [0, 0, 100, 100], 1000, 1000);
  rememberView('f', { scrollX: 450, scrollY: 450, zoom: 1 });
  const v = followView('f', [0, 0, 2000, 400], [1100, 0, 2000, 300], 456, 730, cur, PANE_FIT)!;
  assert.equal(v.zoom, FIT_MIN_ZOOM);
  rememberView('f', v);
  assert.equal(rememberedView('f'), null, 'still the fit');
  rememberView('f', { scrollX: 1, scrollY: 2, zoom: 0.5 });
  assert.equal(followView('f', [0, 0, 2000, 400], [1100, 0, 2000, 300], 456, 730, cur, PANE_FIT), null, 'the user moved it');
});

test('a reload of a fitted file follows the changed block; a first open fits everything (#1005, #1043)', () => {
  const all = [0, 0, 2000, 400] as const;
  const first = openingView('r', all, 456, 730, { ...PANE_FIT, minZoom: FIT_ALL_MIN_ZOOM }, [1100, 0, 2000, 300])!;
  assert.ok(first.zoom < FIT_MIN_ZOOM, 'first open: the whole file');
  rememberView('r', first);
  const again = openingView('r', all, 456, 730, { ...PANE_FIT, minZoom: FIT_ALL_MIN_ZOOM }, [1100, 0, 2000, 300])!;
  assert.equal(again.zoom, FIT_MIN_ZOOM, 'reload: the changed block');
});

test('changedBlock names the last block added or resized since the last call; none on the first call', () => {
  assert.equal(changedBlock('c', [{ id: 'a', width: 100, height: 50 }]), null);
  assert.equal(changedBlock('c', [{ id: 'a', width: 100, height: 50 }]), null);
  assert.equal(changedBlock('c', [{ id: 'a', width: 100, height: 50 }, { id: 'b', width: 10, height: 10 }]), 'b');
  assert.equal(changedBlock('c', [{ id: 'a', width: 120, height: 50 }, { id: 'b', width: 10, height: 10 }]), 'a');
  assert.equal(changedBlock(undefined, [{ id: 'a', width: 1, height: 1 }]), null);
});
