import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewScrollTop } from '../../web/src/canvas/codeLinks.ts';

// 20px lines, a 300px preview box.
test('previewScrollTop: a range taller than the box starts at its first line, with a small top margin', () => {
  const top = previewScrollTop({ firstTop: 99 * 20, span: 61 * 20, boxHeight: 300 });
  assert.ok(top <= 99 * 20 && 99 * 20 - top <= 40, `first line stays near the top, got scrollTop ${top}`);
});

test('previewScrollTop: a short range is centred', () => {
  assert.equal(previewScrollTop({ firstTop: 1000, span: 100, boxHeight: 300 }), 900);
});

test('previewScrollTop: never negative', () => {
  assert.equal(previewScrollTop({ firstTop: 20, span: 100, boxHeight: 300 }), 0);
  assert.equal(previewScrollTop({ firstTop: 10, span: 2000, boxHeight: 300 }), 0);
});

test('previewScrollTop: the margin is continuous at the fits/overflows boundary (#539)', () => {
  const at = (span: number) => 1000 - previewScrollTop({ firstTop: 1000, span, boxHeight: 300 });
  assert.equal(at(300), 0, 'exactly fits: no margin');
  assert.equal(at(301), 1, 'one pixel over: one pixel of margin, not a 16px jump');
  assert.equal(at(299), 0.5);
  assert.equal(at(310), 10);
  assert.equal(at(316), 16);
  assert.equal(at(2000), 16, 'the margin stops at 16px');
  for (let s = 250; s < 400; s++) assert.ok(Math.abs(at(s + 1) - at(s)) <= 1, `margin steps at most 1px at span ${s}`);
});
