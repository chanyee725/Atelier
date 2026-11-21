import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_MAX_SCALE, DOC_MIN_SCALE, barScrollAt, barShare, docPicWidths, picBox, stageWide } from '../../web/src/doc/diagramScale.ts';

test('docPicWidths: a document picture stays between 60% and 100% of its size (#987)', () => {
  assert.equal(DOC_MIN_SCALE, 0.6);
  assert.equal(DOC_MAX_SCALE, 1);
  // A 12-step plan 2000px wide never shrinks below 1200px, so its text stays readable; the block scrolls instead.
  assert.deepEqual(docPicWidths(2000), { minWidth: 1200, maxWidth: 2000 });
  // A one-node picture is never blown up past its own width.
  assert.deepEqual(docPicWidths(180), { minWidth: 108, maxWidth: 180 });
  assert.deepEqual(docPicWidths(Number.NaN), { minWidth: 0, maxWidth: 0 });
});

test('picBox: the overlay follows the picture in the scrolled stage (#987)', () => {
  const stage = { left: 100, top: 50, width: 700 };
  // Not scrolled: the on-screen distance.
  assert.deepEqual(picBox(stage, { left: 112, top: 63, width: 1200 }, { left: 0, top: 0 }, 2000), { left: 12, top: 13, scale: 0.6 });
  // Scrolled 300px to the right: the img moved left on screen, but in the stage's content it is where it was.
  assert.deepEqual(picBox(stage, { left: -188, top: 63, width: 1200 }, { left: 300, top: 0 }, 2000), { left: 12, top: 13, scale: 0.6 });
  assert.equal(picBox(stage, { left: 0, top: 0, width: 10 }, { left: 0, top: 0 }, 0).scale, 1);
});

test('stageWide (#1005): only a picture held at its floor past the stage gets the end gap', () => {
  // 1000px picture: its floor is 600px.
  assert.equal(stageWide(1000, 500), true);
  assert.equal(stageWide(1000, 600), false, 'fits exactly at the floor');
  assert.equal(stageWide(1000, 800), false);
  assert.equal(stageWide(1000, 0), false, 'hidden stage');
  assert.equal(stageWide(NaN, 500), false);
});

test('the scroll bar under a wide picture: thumb share and where a track press scrolls to (#1043)', () => {
  // The issue's picture: 797px of content in a 474px column.
  assert.ok(Math.abs(barShare(474, 797) - 474 / 797) < 1e-9);
  assert.equal(barShare(474, 474), 1, 'nothing scrolls: full thumb');
  assert.equal(barShare(0, 797), 1, 'hidden column');
  // A press at the middle of the track centres the content's middle; the ends clamp.
  assert.equal(barScrollAt(225, 450, 474, 797), 797 / 2 - 474 / 2);
  assert.equal(barScrollAt(0, 450, 474, 797), 0);
  assert.equal(barScrollAt(450, 450, 474, 797), 797 - 474);
  assert.equal(barScrollAt(10, 0, 474, 797), 0);
});
