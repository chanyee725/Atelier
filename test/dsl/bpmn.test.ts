import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bpmnAsGraph, detectDiagramType, parse, parseBpmnDiagram } from '../../shared/dsl/index.ts';
import { fmt } from './helpers.ts';

const ORDER = `title Order flow
direction right
layout sequential

Online store {
  Customer {
    Start [type: event]
    Open website [type: activity]
    Place order [type: activity, icon: flag]
  }
  Warehouse {
    Approved? [type: gateway]
    Shipped [type: event]
  }
}

Start > Open website
Open website > Place order: Browse
Place order > Approved?
Approved? > Shipped: yes [color: green]
`;

test('Eraser example: pool, lanes, typed nodes and labeled edges', () => {
  const { ast, diagnostics } = parseBpmnDiagram(ORDER);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.type, 'bpmn');
  assert.equal(ast.title, 'Order flow');
  assert.equal(ast.direction, 'right');
  assert.equal(ast.layout, 'sequential');
  assert.deepEqual(ast.pools.map((p) => [p.id, p.lanes]), [['Online store', ['Customer', 'Warehouse']]]);
  assert.deepEqual(
    ast.lanes.map((l) => [l.id, l.pool, l.nodes]),
    [
      ['Customer', 'Online store', ['Start', 'Open website', 'Place order']],
      ['Warehouse', 'Online store', ['Approved?', 'Shipped']],
    ],
  );
  assert.deepEqual(
    ast.nodes.map((n) => [n.id, n.type, n.eventRole, n.lane, n.pool]),
    [
      ['Start', 'event', 'start', 'Customer', 'Online store'],
      ['Open website', 'activity', undefined, 'Customer', 'Online store'],
      ['Place order', 'activity', undefined, 'Customer', 'Online store'],
      ['Approved?', 'gateway', undefined, 'Warehouse', 'Online store'],
      ['Shipped', 'event', 'end', 'Warehouse', 'Online store'],
    ],
  );
  assert.equal(ast.nodes[2]!.attrs.icon, 'flag');
  assert.deepEqual(
    ast.edges.map((e) => [e.from, e.to, e.label ?? null, e.attrs.color ?? null]),
    [
      ['Start', 'Open website', null, null],
      ['Open website', 'Place order', 'Browse', null],
      ['Place order', 'Approved?', null, null],
      ['Approved?', 'Shipped', 'yes', 'green'],
    ],
  );
});

test('defaults: activity type, direction right, layout compact; root lanes need no pool', () => {
  const { ast, diagnostics } = parseBpmnDiagram('Sales {\n  Call\n}\nOps {\n  Ship\n}\nLoose\nCall > Ship\nShip > Mid [type: event]\nMid > Loose');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.direction, 'right');
  assert.equal(ast.layout, 'compact');
  assert.deepEqual(ast.pools, []);
  assert.deepEqual(ast.lanes.map((l) => [l.id, l.pool, l.nodes]), [['Sales', undefined, ['Call']], ['Ops', undefined, ['Ship']]]);
  const byId = Object.fromEntries(ast.nodes.map((n) => [n.id, n]));
  assert.equal(byId.Call!.type, 'activity');
  assert.equal(byId.Loose!.lane, undefined);
  assert.equal(byId.Mid!.type, 'event');
  assert.equal(byId.Mid!.eventRole, 'intermediate');
});

test('direction down and the layout keyword with a colon', () => {
  const { ast, diagnostics } = parseBpmnDiagram('direction down\nlayout: compact\nA > B');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.direction, 'down');
  assert.equal(ast.layout, 'compact');
});

test('a node named like the keyword stays a node', () => {
  const { ast, diagnostics } = parseBpmnDiagram('layout engine\nlayout engine > Done');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.layout, 'compact');
  assert.deepEqual(ast.nodes.map((n) => n.id), ['layout engine', 'Done']);
});

test('errors and warnings: bad type, bad layout, nested lane, node outside lanes, edge to a lane', () => {
  const code = [
    'layout: tight',
    'P {',
    '  L1 {',
    '    A [type: task]',
    '    Deep {',
    '      B',
    '    }',
    '  }',
    '  Stray',
    '}',
    'A > B',
    'A > L1',
  ].join('\n');
  const { ast, diagnostics } = parseBpmnDiagram(code);
  assert.deepEqual(fmt(diagnostics), [
    "warning 1:9+5 Unknown layout 'tight'. Use one of: compact, sequential",
    "warning 4:5+1 Unknown BPMN type 'task'. Use one of: activity, event, gateway",
    "error 5:5+4 Lane 'L1' cannot hold another group 'Deep'. Put its nodes in the lane",
    "warning 9:3+5 'Stray' sits in pool 'P' outside every lane. Put it in a lane",
    "warning 12:3+1 Connections to pools and lanes are ignored ('L1'). Connect nodes instead",
  ]);
  assert.equal(ast.layout, 'compact');
  assert.deepEqual(ast.lanes.map((l) => [l.id, l.nodes]), [['L1', ['A', 'B']]]);
  assert.equal(ast.nodes.find((n) => n.id === 'A')!.type, 'activity');
  assert.deepEqual(ast.nodes.find((n) => n.id === 'Stray')!.pool, 'P');
  assert.deepEqual(ast.edges.map((e) => [e.from, e.to]), [['A', 'B']]);
});

test('syntax errors from the graph parser still come through', () => {
  const { ast, diagnostics } = parseBpmnDiagram('P {\n  L {\n    A\n  }\n');
  assert.deepEqual(fmt(diagnostics), ["error 1:3+1 Missing closing '}' for group 'P'"]);
  assert.deepEqual(ast.nodes.map((n) => [n.id, n.lane]), [['A', 'L']]);
});

test('detection: marker line, type attribute, layout keyword; others unchanged', () => {
  assert.equal(detectDiagramType('bpmn-diagram\nA > B'), 'bpmn');
  assert.equal(parse('bpmn-diagram\nA > B').ast.type, 'bpmn');
  assert.equal(detectDiagramType(ORDER), 'bpmn');
  assert.equal(detectDiagramType('layout sequential\nA > B'), 'bpmn');
  assert.equal(detectDiagramType('A [type: gateway]'), 'bpmn');
  assert.equal(detectDiagramType('A [shape: diamond]'), 'flowchart');
  assert.equal(detectDiagramType('A [icon: aws-ec2]\nA > B'), 'cloud-architecture');
  assert.equal(detectDiagramType('layout engine > B'), 'cloud-architecture');
});

test('bpmnAsGraph: pool > lane groups in source order, gateway diamond, event circle', () => {
  const g = bpmnAsGraph(parseBpmnDiagram(ORDER).ast);
  assert.equal(g.type, 'flowchart');
  assert.equal(g.direction, 'right');
  const pool = g.children[0]!;
  assert.equal(pool.kind, 'group');
  if (pool.kind !== 'group') return;
  assert.deepEqual(pool.children.map((c) => c.id), ['Customer', 'Warehouse']);
  const wh = pool.children[1]!;
  if (wh.kind !== 'group') assert.fail('lane is a group');
  assert.deepEqual(wh.children.map((n) => [n.id, n.attrs.shape]), [['Approved?', 'diamond'], ['Shipped', 'circle']]);
  assert.equal(g.edges.length, 4);
});

test('parse never throws on an empty bpmn block', () => {
  const { ast, diagnostics } = parse('', 'bpmn');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.type, 'bpmn');
});
