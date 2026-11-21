// E712 (#1039): the line an agent changed in a diagram's code panel. The mark follows the session's `cursor` events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBlockMark, clearBlockMarks, markOf } from '../../web/src/canvas/blockMarkStore.ts';
import type { CursorEvent } from '../../web/src/canvas/agentCursor.ts';

const ev = (e: Partial<CursorEvent> & { sid: string }): CursorEvent => ({ file: 'd.dpx.json', name: 'Otto', color: '#0f766e', ...e });

test('a changed block line is marked for its file; a bad or other-file mark is not shown', () => {
  clearBlockMarks();
  applyBlockMark(ev({ sid: 's1', block: 'b1', line: 3, x: 0, y: 0 }));
  assert.deepEqual(markOf('d.dpx.json', 'b1'), { sid: 's1', name: 'Otto', color: '#0f766e', file: 'd.dpx.json', line: 3 });
  assert.equal(markOf('other.dpx.json', 'b1'), null);
  assert.equal(markOf('d.dpx.json', 'b2'), null);
  // A line that is not a line number marks nothing.
  applyBlockMark(ev({ sid: 's2', block: 'b2', line: 0 }));
  assert.equal(markOf('d.dpx.json', 'b2'), null);
});

test('a session moves its mark, leaves it on gone, and a bad colour is dropped', () => {
  clearBlockMarks();
  applyBlockMark(ev({ sid: 's1', block: 'b1', line: 2, color: 'red' }));
  assert.equal(markOf('d.dpx.json', 'b1')?.color, '');
  // The same session edits another block: the first mark goes.
  applyBlockMark(ev({ sid: 's1', block: 'b2', line: 1 }));
  assert.equal(markOf('d.dpx.json', 'b1'), null);
  assert.equal(markOf('d.dpx.json', 'b2')?.line, 1);
  // Another session's mark is not touched by a place without a block.
  applyBlockMark(ev({ sid: 's2', block: 'b3', line: 4 }));
  applyBlockMark(ev({ sid: 's1', x: 10, y: 10 }));
  assert.equal(markOf('d.dpx.json', 'b2'), null);
  assert.equal(markOf('d.dpx.json', 'b3')?.sid, 's2');
  applyBlockMark(ev({ sid: 's2', gone: true }));
  assert.equal(markOf('d.dpx.json', 'b3'), null);
  clearBlockMarks();
});
