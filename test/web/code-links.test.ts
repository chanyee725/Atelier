import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockCodeInfo,
  codeError,
  codeInfoCache,
  codeShapeOf,
  placeBadges,
  refText,
  sameBadges,
  shapeCode,
  shapeLabel,
  splitPath,
  targetAfterNodes,
  targetAfterSelection,
  withoutOrphans,
  type BlockCodeInfo,
} from '../../web/src/canvas/codeLinks.ts';

const block = (over = {}) => ({ id: 'b1', type: 'architecture', code: 'Web [code: "src/a.py:3-5"]\nApi', ...over });
const SHAPE = { id: 's1', type: 'rectangle', customData: { codeRefs: { summary: '저장', refs: [{ path: 'x.py', start: 2 }] } } };

test('blockCodeInfo merges DSL code: with stored refs and keeps only nodes with code', () => {
  const info = blockCodeInfo(block({ codeRefs: { v: 1, nodes: { Api: { refs: [{ path: 'b.py', start: 1, end: 2 }] } } } }));
  assert.deepEqual(Object.keys(info.nodes).sort(), ['Api', 'Web']);
  assert.deepEqual(info.nodes.Web!.refs, [{ path: 'src/a.py', start: 3, end: 5 }]);
  assert.equal(info.labels.Web, 'Web');
  assert.deepEqual(info.orphans, []);
});

test('blockCodeInfo reports stored entries whose node is gone as orphans', () => {
  const info = blockCodeInfo(block({ code: 'Web', codeRefs: { v: 1, nodes: { Gone: { refs: [{ path: 'b.py', start: 1 }] } } } }));
  assert.deepEqual(info.orphans, ['Gone']);
  assert.deepEqual(Object.keys(info.nodes), []);
});

test('blockCodeInfo ignores prototype-looking node names', () => {
  const info = blockCodeInfo(block({ code: 'constructor [code: "a.py:1"]\ntoString' }));
  assert.deepEqual(Object.keys(info.nodes), ['constructor']);
  assert.equal(Object.hasOwn(info.nodes, 'toString'), false);
});

test('codeInfoCache returns the same info until code or codeRefs change', () => {
  const get = codeInfoCache();
  const b = block();
  assert.equal(get(b), get({ ...b }));
  assert.notEqual(get(b), get({ ...b, code: 'Web' }));
});

test('withoutOrphans drops listed nodes and returns undefined when nothing is left', () => {
  const stored = { v: 1, nodes: { A: { refs: [{ path: 'a', start: 1 }] }, B: { refs: [{ path: 'b', start: 1 }] } } };
  assert.deepEqual(Object.keys(withoutOrphans(stored, ['A'])!.nodes), ['B']);
  assert.equal(withoutOrphans(stored, ['A', 'B']), undefined);
  const newer = { v: 99, nodes: {} };
  assert.equal(withoutOrphans(newer, ['A']), newer);
});

test('shapeCode needs well-formed refs or a summary', () => {
  assert.ok(shapeCode(SHAPE));
  assert.equal(shapeCode({ customData: { codeRefs: { refs: [] } } }), null);
  assert.equal(shapeCode({ customData: { codeRefs: { refs: [{ path: '../x', start: 1 }] } } }), null);
  assert.equal(shapeCode({}), null);
});

test('a bound text resolves to its container with code; deleted elements do not', () => {
  const text = { id: 't1', type: 'text', containerId: 's1', text: ' 저장소 ' };
  const els = [SHAPE, text];
  assert.equal(codeShapeOf(els, 't1')?.id, 's1');
  assert.equal(codeShapeOf(els, 's1')?.id, 's1');
  assert.equal(codeShapeOf([{ ...SHAPE, isDeleted: true }, text], 't1'), null);
  assert.equal(shapeLabel(els, SHAPE), '저장소');
  assert.equal(shapeLabel([SHAPE], SHAPE), '도형');
});

const info: BlockCodeInfo = { nodes: { Web: { refs: [{ path: 'a', start: 1 }] } }, labels: { Web: 'Web', Api: 'Api' }, orphans: [] };
const img = { id: 'img', type: 'image', customData: { blockId: 'b1' } };

test('selecting one shape with code opens it; shape and bound text count as one', () => {
  const els = [SHAPE, { id: 't1', type: 'text', containerId: 's1', text: 'x' }];
  assert.deepEqual(targetAfterSelection(null, { ids: ['s1'], editing: null }, els), { kind: 'shape', id: 's1' });
  assert.deepEqual(targetAfterSelection(null, { ids: ['s1', 't1'], editing: null }, els), { kind: 'shape', id: 's1' });
  assert.equal(targetAfterSelection(null, { ids: ['t1', 'zz'], editing: null }, els), null);
});

test('a node target stays while its block is selected or edited, and closes otherwise', () => {
  const prev = { kind: 'node', blockId: 'b1', node: 'Web' } as const;
  const els = [img, { id: 'o', type: 'rectangle' }];
  assert.equal(targetAfterSelection(prev, { ids: ['img'], editing: null }, els), prev);
  assert.equal(targetAfterSelection(prev, { ids: [], editing: 'b1' }, els), prev);
  assert.equal(targetAfterSelection(prev, { ids: [], editing: null }, els), null);
  assert.equal(targetAfterSelection(prev, { ids: ['o'], editing: null }, els), null);
  assert.equal(targetAfterSelection({ kind: 'shape', id: 's1' }, { ids: [], editing: null }, els), null);
});

test('overlay node selection: one node with code opens, other nodes close, empty keeps', () => {
  const prev = { kind: 'node', blockId: 'b1', node: 'Web' } as const;
  assert.deepEqual(targetAfterNodes(null, 'b1', ['Web'], info), prev);
  assert.equal(targetAfterNodes(prev, 'b1', ['Api'], info), null);
  assert.equal(targetAfterNodes(prev, 'b1', ['Web', 'Api'], info), null);
  assert.equal(targetAfterNodes(prev, 'b1', [], info), prev);
  assert.equal(targetAfterNodes(null, 'b1', ['Api'], info), null);
  assert.equal(targetAfterNodes(prev, 'other', ['Api'], info), prev);
});

test('refText and splitPath', () => {
  assert.equal(refText({ path: 'a/b.py', start: 3, end: 9 }), 'a/b.py:3-9');
  assert.equal(refText({ path: 'a/b.py', start: 3, end: 3 }), 'a/b.py:3');
  assert.equal(refText({ path: 'a/b.py', start: 3 }), 'a/b.py:3');
  assert.deepEqual(splitPath('src/deep/file.py'), { dir: 'src/deep/', file: 'file.py' });
  assert.deepEqual(splitPath('file.py'), { dir: '', file: 'file.py' });
});

test('codeError gives a plain message per failure', () => {
  assert.match(codeError(404, 'not-tracked'), /git에 올라가지/);
  assert.match(codeError(404, 'no-project'), /git 프로젝트/);
  assert.match(codeError(416), /그 줄까지/);
  assert.match(codeError(500), /불러오지 못했어요/);
});

test('badges sit on the top-right corner of nodes with code, once per block', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
  const pic = { width: 400, scene: { handles: [{ kind: 'node', id: 'Web', x: 10, y: 20, w: 50, h: 30 }, { kind: 'node', id: 'Api', x: 100, y: 20, w: 50, h: 30 }] } };
  const image = { id: 'img', type: 'image', customData: { blockId: 'b1' }, x: 0, y: 0, width: 400, height: 200, fileId: 'f' };
  const lookup = (id: string) => (id === 'b1' ? info : undefined);
  const get = () => pic as never;
  const out = placeBadges([image, { ...image, id: 'copy' }] as never, view, { left: 0, top: 0 }, lookup, get, null);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.node, 'Web');
  assert.equal(out[0]!.x, 60);
  assert.equal(out[0]!.y, 20);
  assert.deepEqual(placeBadges([image] as never, view, { left: 0, top: 0 }, lookup, get, 'b1'), []);
  assert.deepEqual(placeBadges([{ ...image, angle: 1 }] as never, view, { left: 0, top: 0 }, lookup, get, null), []);
  assert.deepEqual(placeBadges([{ ...image, isDeleted: true }] as never, view, { left: 0, top: 0 }, lookup, get, null), []);
});

test('free-form shapes with code get a badge at their top-right; sameBadges compares positions', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 2 }, offsetLeft: 0, offsetTop: 0 };
  const shape = { ...SHAPE, x: 10, y: 5, width: 30, height: 20 };
  const out = placeBadges([shape] as never, view, { left: 0, top: 0 }, () => undefined, () => undefined, null);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.blockId, '');
  assert.equal(out[0]!.node, 's1');
  assert.equal(out[0]!.label, '도형', 'a shape without text falls back to 도형');
  assert.ok(sameBadges(out, out.map((b) => ({ ...b }))));
  assert.ok(!sameBadges(out, out.map((b) => ({ ...b, x: b.x + 1 }))));
  assert.ok(!sameBadges(out, out.map((b) => ({ ...b, label: 'x' }))));
});

test('a block node badge is labelled with its node name', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
  const pic = { width: 400, scene: { handles: [{ kind: 'node', id: 'Web', x: 10, y: 20, w: 50, h: 30 }] } };
  const image = { id: 'img', type: 'image', customData: { blockId: 'b1' }, x: 0, y: 0, width: 400, height: 200, fileId: 'f' };
  const out = placeBadges([image] as never, view, { left: 0, top: 0 }, () => info, () => pic as never, null);
  assert.equal(out[0]!.label, 'Web');
});

test('free-form shape badges use the shape text as their label (#540)', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
  const a = { ...SHAPE, id: 'a', x: 0, y: 0, width: 30, height: 20 };
  const aText = { id: 'at', type: 'text', containerId: 'a', text: ' 저장 ', x: 0, y: 0, width: 10, height: 10 };
  const b = { ...SHAPE, id: 'b', x: 50, y: 0, width: 30, height: 20 };
  const bText = { id: 'bt', type: 'text', containerId: 'b', text: '불러오기', x: 50, y: 0, width: 10, height: 10, isDeleted: true };
  const out = placeBadges([a, aText, b, bText] as never, view, { left: 0, top: 0 }, () => undefined, () => undefined, null);
  assert.deepEqual(out.map((x) => [x.node, x.label]), [['a', '저장'], ['b', '도형']]);
});

test('free text with codeRefs gets a badge labelled by its text; bound text never does (#511)', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 };
  const free = { ...SHAPE, id: 'ft', type: 'text', text: '로그인', x: 0, y: 0, width: 40, height: 20 };
  const bound = { ...SHAPE, id: 'bt', type: 'text', text: '안쪽', containerId: 'box', x: 0, y: 40, width: 40, height: 20 };
  const out = placeBadges([free, bound] as never, view, { left: 0, top: 0 }, () => undefined, () => undefined, null);
  assert.deepEqual(out.map((x) => [x.node, x.label]), [['ft', '로그인']]);
});

test('BPMN blocks: nodes in lanes carry their code and labels (#841)', () => {
  const code = 'Sales {\n  Call [type: activity, code: "src/call.ts:3-9"]\n  Done [type: event]\n}\nCall > Done';
  const info = blockCodeInfo(block({ type: 'bpmn', code }));
  assert.deepEqual(Object.keys(info.labels).sort(), ['Call', 'Done']);
  assert.deepEqual(info.nodes.Call!.refs, [{ path: 'src/call.ts', start: 3, end: 9 }]);
  assert.deepEqual(info.orphans, []);
});

test('zoomed out, block node badges skip nodes too small for them and never overlap (#1043)', () => {
  const pic = { width: 400, scene: { handles: [{ kind: 'node', id: 'Web', x: 10, y: 20, w: 100, h: 30 }, { kind: 'node', id: 'Api', x: 130, y: 20, w: 100, h: 30 }] } };
  const two: BlockCodeInfo = { ...info, nodes: { ...info.nodes, Api: info.nodes.Web! } };
  const image = { id: 'img', type: 'image', customData: { blockId: 'b1' }, x: 0, y: 0, width: 400, height: 200, fileId: 'f' };
  const at = (zoom: number) => placeBadges([image] as never, { scrollX: 0, scrollY: 0, zoom: { value: zoom }, offsetLeft: 0, offsetTop: 0 }, { left: 0, top: 0 }, () => two, () => pic as never, null);
  assert.deepEqual(at(1).map((b) => b.node), ['Web', 'Api'], 'at 100% both nodes get a badge');
  assert.deepEqual(at(0.3), [], 'a 30px node gets none');
  assert.deepEqual(at(0.45), [], 'a 45px node (a wide diagram fitted whole in the 둘 다 pane) gets none');
  // Two shapes with code side by side: the second badge would sit on the first, so it is left out.
  const s1 = { ...SHAPE, id: 'a', x: 0, y: 0, width: 60, height: 20 };
  const s2 = { ...SHAPE, id: 'b', x: 10, y: 2, width: 60, height: 20 };
  const out = placeBadges([s1, s2] as never, { scrollX: 0, scrollY: 0, zoom: { value: 1 }, offsetLeft: 0, offsetTop: 0 }, { left: 0, top: 0 }, () => undefined, () => undefined, null);
  assert.deepEqual(out.map((b) => b.node), ['a']);
});
