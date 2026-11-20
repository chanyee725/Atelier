import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorateCode, drawnBlock, lookKey, planLookOf, planRoles, rolesKey } from '../../web/src/canvas/planStyle.ts';
import { parseFlowchart } from '../../shared/dsl/index.ts';

const errors = (code: string) => parseFlowchart(code).diagnostics.filter((d) => d.severity === 'error');

test('decorateCode puts the role look inside the declaration line and keeps the line count', () => {
  const code = 'direction right\n\ns1 [label: "웹: 대화"]\ns2\n\ns1 > s2\ns2 > s3\n';
  const out = decorateCode(code, 'flowchart', { s1: 'impl', s2: 'review', s3: 'merge' });
  assert.equal(out.split('\n').length, code.split('\n').length);
  assert.deepEqual(out.split('\n'), [
    'direction right',
    '',
    's1 [icon: code-xml, styleMode: plain, label: "웹: 대화"]',
    's2 [icon: eye, styleMode: plain]',
    '',
    's1 > s2',
    // s3 is created by this connection, so its look goes there.
    's2 > s3 [icon: git-merge, styleMode: plain]',
    '',
  ]);
  assert.deepEqual(errors(out), []);
  const nodes = parseFlowchart(out).ast.children;
  assert.equal(nodes.find((n) => n.name === 's1')?.attrs.icon, 'code-xml');
  assert.equal(nodes.find((n) => n.name === 's1')?.label, '웹: 대화');
  assert.equal(nodes.find((n) => n.name === 's3')?.attrs.color, undefined, 'roles never paint a node');
});

test('decorateCode keeps attributes the node already has and flattens nodes without a step', () => {
  const out = decorateCode('a [color: red, icon: bot]\nb\na > b', 'flowchart', { a: 'lead' });
  assert.equal(out, 'a [styleMode: plain, color: red, icon: bot]\nb [styleMode: plain]\na > b');
  assert.deepEqual(errors(out), []);
});

test('decorateCode handles nodes in groups, quoted names, a type marker and unknown roles', () => {
  const code = 'flowchart-diagram\ng {\n  "x y" [label: X]\n}\nz\n"x y" > z';
  const out = decorateCode(code, 'flowchart', { 'x y': 'test', z: 'someone' });
  assert.equal(out, 'flowchart-diagram\ng {\n  "x y" [icon: flask-conical, styleMode: plain, label: X]\n}\nz [styleMode: plain]\n"x y" > z');
  assert.deepEqual(errors(out), []);
});

test('decorateCode leaves other diagram types and unchanged looks alone', () => {
  const seq = 'a > b: hi';
  assert.equal(decorateCode(seq, 'sequence', { a: 'impl' }), seq);
  assert.equal(decorateCode('a', 'architecture', { a: 'docs' }), 'a [icon: file-text, styleMode: plain]');
  const plain = 'a [styleMode: plain]';
  assert.equal(decorateCode(plain, 'flowchart', {}), plain);
});

test('planRoles takes each step role or the plan default; rolesKey is order independent', () => {
  const roles = planRoles({ defaults: { role: 'impl' }, steps: [{ id: 'st1', node: 's1', role: 'review' }, { id: 'st2', node: 's2' }] });
  assert.deepEqual(roles, { s1: 'review', s2: 'impl' });
  assert.equal(rolesKey({ b: 'x', a: 'y' }), rolesKey({ a: 'y', b: 'x' }));
  assert.deepEqual(planRoles(null), {});
});

test('drawnBlock decorates only the plan block and keeps its identity otherwise', () => {
  const look = planLookOf({ block: 'p', steps: [{ id: 'a', node: 'a', role: 'impl' }] });
  const other = { id: 'q', type: 'flowchart', code: 'a' };
  assert.equal(drawnBlock(other, look), other);
  assert.equal(drawnBlock({ id: 'p', type: 'flowchart', code: 'a' }, null).code, 'a');
  const d = drawnBlock({ id: 'p', type: 'flowchart', code: 'a', layout: undefined }, look);
  assert.equal(d.code, 'a [icon: code-xml, styleMode: plain]');
  assert.equal(d.id, 'p');
  assert.notEqual(lookKey(look), lookKey(planLookOf({ block: 'p', steps: [{ id: 'a', node: 'a', role: 'test' }] })));
  assert.equal(lookKey(null), '');
});
