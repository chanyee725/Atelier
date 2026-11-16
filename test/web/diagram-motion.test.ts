import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupScene, diffScenes, hasMotion, morphMarkup } from '../../web/src/canvas/diagramMotion.ts';
import type { Scene, SceneItem } from '../../shared/render/index.ts';

const box = (id: string, x: number, y: number): SceneItem => ({ kind: 'box', id, role: 'node', shape: 'rectangle', x, y, w: 80, h: 40, paint: { mode: 'pastel' }, shadow: false });
const text = (x: number, y: number, s: string): SceneItem => ({ kind: 'text', x, y, lines: [s], size: 14, lineHeight: 18, anchor: 'middle', weight: 400, font: 'clean', tone: 'normal' });
const edge = (from: string, to: string, pts: [number, number][]): SceneItem => ({ kind: 'edge', id: `${from}${to}`, from, to, points: pts.map(([x, y]) => ({ x, y })), route: 'straight', dashed: false, start: 'none', end: 'arrow' });
const scene = (items: SceneItem[]): Scene => ({ type: 'flowchart', width: 400, height: 300, items });
const node = (id: string, x: number, y: number) => [box(id, x, y), text(x + 40, y + 10, id)];

test('texts join the box before them; edges form their own group', () => {
  const g = groupScene(scene([...node('a', 0, 0), ...node('b', 100, 0), edge('a', 'b', [[80, 20], [100, 20]])]));
  assert.deepEqual(g.map((x) => [x.key, x.items.length]), [['b:a', 2], ['b:b', 2], ['e:a>b', 1]]);
});

test('identical scenes have no motion', () => {
  const s = scene(node('a', 0, 0));
  assert.equal(hasMotion(diffScenes(s, s)), false);
  assert.equal(morphMarkup(s, s), null);
});

test('new node and edge enter, existing node stays', () => {
  const prev = scene(node('a', 0, 0));
  const next = scene([...node('a', 0, 0), ...node('b', 100, 0), edge('a', 'b', [[80, 20], [100, 20]])]);
  const d = diffScenes(prev, next);
  assert.deepEqual(d.map((e) => [e.key, e.state]), [['b:a', 'same'], ['b:b', 'enter'], ['e:a>b', 'enter']]);
});

test('a node that only moved glides with the offset old − new', () => {
  const d = diffScenes(scene(node('a', 0, 0)), scene(node('a', 30, 50)));
  assert.deepEqual(d, [{ key: 'b:a', state: 'move', items: node('a', 30, 50), dx: -30, dy: -50 }]);
});

test('a removed node exits and sits at the back', () => {
  const d = diffScenes(scene([...node('a', 0, 0), ...node('b', 100, 0)]), scene(node('b', 100, 0)));
  assert.deepEqual(d.map((e) => [e.key, e.state]), [['b:a', 'exit'], ['b:b', 'same']]);
});

test('changed text cross-fades; edges that follow a moved node cross-fade', () => {
  const d = diffScenes(scene([box('a', 0, 0), text(40, 10, 'old')]), scene([box('a', 0, 0), text(40, 10, 'new')]));
  assert.deepEqual(d.map((e) => [e.key, e.state]), [['b:a~old', 'change-out'], ['b:a', 'change-in']]);
  const e = diffScenes(scene([edge('a', 'b', [[0, 0], [10, 0]])]), scene([edge('a', 'b', [[0, 0], [10, 20]])]));
  assert.deepEqual(e.map((x) => x.state), ['change-out', 'change-in']);
});

test('markup wraps every group with its state and carries move offsets', () => {
  const m = morphMarkup(scene(node('a', 0, 0)), scene([...node('a', 10, 0), ...node('b', 100, 0)]))!;
  assert.match(m.svg, /data-m="move" data-dx="-10" data-dy="0"/);
  assert.match(m.svg, /data-m="enter"/);
  assert.doesNotMatch(m.svg, /<style>/);
  assert.equal(m.width, 400);
});
