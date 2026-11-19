import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBpmnDiagram } from '../../shared/dsl/index.ts';
import { renderDiagram } from '../../shared/render/index.ts';
import type { Scene, SceneBox } from '../../shared/render/index.ts';
import { flowRanks } from '../../shared/render/layout-bpmn.ts';
import { fixture } from '../dsl/helpers.ts';

const boxes = (s: Scene): Map<string, SceneBox> =>
  new Map(s.items.filter((i): i is SceneBox => i.kind === 'box' && i.id !== undefined).map((b) => [b.id!, b]));
const inside = (a: SceneBox, b: SceneBox): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const cx = (b: SceneBox): number => b.x + b.w / 2;
const cy = (b: SceneBox): number => b.y + b.h / 2;

test('fixture: lanes stack inside the pool, nodes sit in their lane, flow runs left to right', async () => {
  const { scene, diagnostics } = await renderDiagram(fixture('bpmn-order-flow'));
  assert.deepEqual(diagnostics, []);
  assert.equal(scene.type, 'bpmn');
  assert.equal(scene.handles, undefined);
  const b = boxes(scene);
  const pool = b.get('Online store')!;
  const customer = b.get('Customer')!;
  const warehouse = b.get('Warehouse')!;
  assert.ok(inside(customer, pool) && inside(warehouse, pool));
  // Lanes are full-width rows, one under the other.
  assert.equal(customer.x, warehouse.x);
  assert.equal(customer.w, warehouse.w);
  assert.equal(customer.y + customer.h, warehouse.y);
  for (const id of ['Start', 'Open website', 'Place order']) assert.ok(inside(b.get(id)!, customer), id);
  for (const id of ['Approved?', 'Pack items', 'Shipped']) assert.ok(inside(b.get(id)!, warehouse), id);
  assert.equal(b.get('Start')!.shape, 'circle');
  assert.equal(b.get('Approved?')!.shape, 'diamond');
  assert.equal(b.get('Open website')!.shape, 'rectangle');
  // Flowchart box sizes: one bucket width for the boxes of a lane.
  assert.equal(b.get('Open website')!.w, 160);
  assert.equal(b.get('Place order')!.w, b.get('Open website')!.w);
  const order = ['Start', 'Open website', 'Place order', 'Approved?', 'Pack items', 'Shipped'].map((id) => cx(b.get(id)!));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  // The back edge (no) does not push Open website to the right of the gateway.
  assert.equal(scene.items.filter((i) => i.kind === 'edge').length, 6);
});

test('ranks: compact shares a slot after a fork, sequential gives every node its own', () => {
  const code = (layout: string) => `layout ${layout}\nL {\n  A [type: event]\n  B\n  C\n  D\n}\nA > B\nA > C\nB > D\nC > D\nD > B`;
  const compact = flowRanks(parseBpmnDiagram(code('compact')).ast);
  assert.deepEqual(Object.fromEntries(compact), { A: 0, B: 1, C: 1, D: 2 });
  const sequential = flowRanks(parseBpmnDiagram(code('sequential')).ast);
  assert.deepEqual(Object.fromEntries(sequential), { A: 0, B: 1, C: 2, D: 3 });
});

test('lane order: the flow starts at the start event even when its lane is declared second', async () => {
  // Warehouse above Customer: the gateway must not share the start's slot, the main flow must not turn back.
  const src = fixture('bpmn-order-flow');
  const customer = src.slice(src.indexOf('  Customer {'), src.indexOf('  Warehouse {'));
  const warehouse = src.slice(src.indexOf('  Warehouse {'), src.indexOf('}\n}') + 2);
  const swapped = src.replace(customer + warehouse, warehouse + '\n' + customer.trimEnd() + '\n');
  assert.notEqual(swapped, src);
  const ranks = flowRanks(parseBpmnDiagram(swapped).ast);
  assert.deepEqual(Object.fromEntries(ranks), {
    'Approved?': 3, 'Pack items': 4, Shipped: 5, Start: 0, 'Open website': 1, 'Place order': 2,
  });
  const { scene, diagnostics } = await renderDiagram(swapped);
  assert.deepEqual(diagnostics, []);
  const b = boxes(scene);
  assert.ok(b.get('Warehouse')!.y < b.get('Customer')!.y);
  const order = ['Start', 'Open website', 'Place order', 'Approved?', 'Pack items', 'Shipped'].map((id) => cx(b.get(id)!));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test('compact: nodes of one lane in the same slot stack across the flow', async () => {
  const { scene } = await renderDiagram('L {\n  A [type: event]\n  B\n  C\n}\nA > B\nA > C', { type: 'bpmn' });
  const b = boxes(scene);
  assert.equal(cx(b.get('B')!), cx(b.get('C')!));
  assert.ok(b.get('C')!.y >= b.get('B')!.y + b.get('B')!.h);
  assert.ok(inside(b.get('C')!, b.get('L')!));
});

test('direction down: lanes side by side, flow top to bottom, slots aligned across lanes', async () => {
  const { scene } = await renderDiagram('direction down\nP {\n  L1 {\n    A [type: event]\n    B\n  }\n  L2 {\n    C\n  }\n}\nA > B\nB > C', { type: 'bpmn' });
  const b = boxes(scene);
  const [l1, l2] = [b.get('L1')!, b.get('L2')!];
  assert.equal(l1.y, l2.y);
  assert.equal(l1.h, l2.h);
  assert.equal(l1.x + l1.w, l2.x);
  assert.ok(cy(b.get('A')!) < cy(b.get('B')!) && cy(b.get('B')!) < cy(b.get('C')!));
  assert.ok(inside(b.get('C')!, l2));
});

test('nodes outside every lane and lanes without a pool still render; same code, same SVG', async () => {
  const code = 'Sales {\n  Call [type: activity]\n}\nLoose\nCall > Loose';
  const a = await renderDiagram(code, { type: 'bpmn' });
  const b = await renderDiagram(code, { type: 'bpmn' });
  assert.equal(a.svg, b.svg);
  const bx = boxes(a.scene);
  assert.ok(bx.has('Sales') && bx.has('Call') && bx.has('Loose'));
  assert.ok(!inside(bx.get('Loose')!, bx.get('Sales')!));
  const empty = await renderDiagram('', { type: 'bpmn' });
  assert.equal(empty.scene.type, 'bpmn');
});
