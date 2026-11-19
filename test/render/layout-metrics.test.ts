// What the readability counts mean (#796): "zero crossings" is line-line; a line through a node counts apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Scene, SceneBox, SceneEdge } from '../../shared/render/index.ts';
import { layoutMetrics } from './layout-metrics.ts';

const edge = (id: string, from: string, to: string, ...xy: number[]): SceneEdge => ({
  kind: 'edge', id, from, to, route: 'straight', dashed: false, start: 'none', end: 'arrow',
  points: xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1]! }])),
});
const node = (id: string, x: number, y: number): SceneBox => ({ kind: 'box', id, role: 'node', shape: 'rectangle', x, y, w: 40, h: 40, paint: { color: 'gray', mode: 'outline' }, shadow: false });
const scene = (...items: Scene['items']): Scene => ({ type: 'flowchart', width: 400, height: 400, items });

test('metrics: two diagonal lines that cross are a line-line crossing; the elbow count misses them', () => {
  const m = layoutMetrics(scene(edge('a', 'A', 'B', 0, 0, 100, 100), edge('b', 'C', 'D', 0, 100, 100, 0)));
  assert.deepEqual([m.lineCrossings, m.crossings, m.throughNodes], [1, 0, 0]);
});

test('metrics: elbow segments that cross count in both line-line checks', () => {
  const m = layoutMetrics(scene(edge('a', 'A', 'B', 0, 50, 100, 50), edge('b', 'C', 'D', 50, 0, 50, 100)));
  assert.deepEqual([m.lineCrossings, m.crossings], [1, 1]);
});

test('metrics: lines that only meet at an end, or run side by side, do not cross', () => {
  const m = layoutMetrics(scene(edge('a', 'A', 'B', 0, 0, 100, 100), edge('b', 'A', 'C', 0, 0, 100, 0), edge('c', 'D', 'E', 0, 10, 100, 110)));
  assert.deepEqual([m.lineCrossings, m.crossings], [0, 0]);
});

test('metrics: a line through a node is throughNodes, not a crossing', () => {
  const m = layoutMetrics(scene(node('A', 0, 30), node('M', 80, 30), node('B', 160, 30), edge('a', 'A', 'B', 40, 50, 160, 50)));
  assert.deepEqual([m.throughNodes, m.lineCrossings, m.crossings], [1, 0, 0]);
});
