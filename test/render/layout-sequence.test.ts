// Sequence participant heads (#796): capped at the widest flowchart bucket, one height for every column.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagram } from '../../shared/render/index.ts';
import type { Scene, SceneBox } from '../../shared/render/index.ts';

const heads = (scene: Scene): SceneBox[] => scene.items.filter((it): it is SceneBox => it.kind === 'box' && it.role === 'column');
const LONG = 'Supercalifragilisticexpialidociousandevenlongerwordthatgoesonandon';

test('sequence: a long single-word head stays at most 260 wide, with wrap on and off', async () => {
  for (const prefix of ['', 'wrap: off\n']) {
    const { scene } = await renderDiagram(`${prefix}${LONG}\nB\n${LONG} > B: hi`, { type: 'sequence' });
    const boxes = heads(scene);
    assert.equal(boxes.length, 4);
    for (const b of boxes) assert.ok(b.w <= 260, `${prefix || 'wrap on'}: head ${b.w} wide`);
    const text = scene.items.find((it) => it.kind === 'text' && it.lines.join('') === LONG);
    assert.ok(text && text.kind === 'text' && text.lines.length > 1, 'the word breaks over lines instead');
  }
});

test('sequence: wrap off still keeps a head on one line when it fits', async () => {
  const { scene } = await renderDiagram('wrap: off\nA rather long participant name\nB\nA rather long participant name > B: hi', { type: 'sequence' });
  const text = scene.items.find((it) => it.kind === 'text' && it.lines.join(' ') === 'A rather long participant name');
  assert.ok(text && text.kind === 'text');
  assert.equal(text.lines.length, 1);
});

test('sequence: every head has the same height, so tops and bottoms line up', async () => {
  const { scene } = await renderDiagram(`${LONG}\nB\nC\nB > C: x`, { type: 'sequence' });
  const boxes = heads(scene);
  assert.equal(new Set(boxes.map((b) => b.h)).size, 1, boxes.map((b) => b.h).join(','));
  const top = boxes.filter((b) => b.id !== undefined);
  const bottom = boxes.filter((b) => b.id === undefined);
  assert.equal(new Set(top.map((b) => b.y)).size, 1);
  assert.equal(new Set(bottom.map((b) => b.y)).size, 1);
});
