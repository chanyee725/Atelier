import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type GraphDiagram } from '../shared/dsl/index.ts';
import { parseCodeAttr } from '../shared/dsl/code-refs.ts';
import { blockCodeProblem, cleanBlockCode, dslCodeRefs, mergeCodeRefs, MAX_CODE_REFS, type BlockCode } from '../shared/render/block-code.ts';
import { sceneToFreeform } from '../web/src/canvas/freeform.ts';
import type { Scene } from '../shared/render/scene.ts';

test('parseCodeAttr: path, lines, range, symbol, several refs', () => {
  const r = parseCodeAttr('src/a.py:42-118#Recorder.record; convert/lerobot.py:10-80#to_lerobot; convert/schema.py:5; lib/x.py#f; plain.js');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.refs, [
    { path: 'src/a.py', start: 42, end: 118, symbol: 'Recorder.record' },
    { path: 'convert/lerobot.py', start: 10, end: 80, symbol: 'to_lerobot' },
    { path: 'convert/schema.py', start: 5 },
    { path: 'lib/x.py', start: 1, symbol: 'f' },
    { path: 'plain.js', start: 1 },
  ]);
});

test('parseCodeAttr: bad pieces are skipped and reported', () => {
  const r = parseCodeAttr('/abs.py:1; ../up.py:1; ok.py:5-3; ok2.py:2; a\\b.py:1; x.py#; ;');
  assert.deepEqual(r.refs, [{ path: 'ok2.py', start: 2 }]);
  assert.equal(r.problems.length, 5);
  assert.equal(parseCodeAttr('a.py:1-3000').refs.length, 0);
});

test('DSL: code attribute is exposed on nodes, groups walk, diagnostics warn on bad ones', () => {
  const src = 'Group {\n  Rec [icon: video, code: "src/r.py:42-118#R.run; b.py:3"]\n}\nConv [code: "../bad.py"]\nRec > Conv';
  const { ast, diagnostics } = parse(src, 'cloud-architecture');
  const g = ast as GraphDiagram;
  const refs = dslCodeRefs(g.children);
  assert.deepEqual({ ...refs }, { Rec: [{ path: 'src/r.py', start: 42, end: 118, symbol: 'R.run' }, { path: 'b.py', start: 3 }] });
  assert.equal(diagnostics.filter((d) => d.severity === 'warning').length, 1);
  assert.match(diagnostics.find((d) => d.severity === 'warning')!.message, /Bad code reference/);
  assert.equal(diagnostics.some((d) => /Unknown attribute 'code'/.test(d.message)), false);
});

const good: BlockCode = { v: 1, nodes: { A: { summary: 's', refs: [{ path: 'a/b.py', start: 1, end: 9, symbol: 'f', note: 'n' }] } } };

test('blockCodeProblem accepts good and rejects bad shapes', () => {
  assert.equal(blockCodeProblem(good), null);
  assert.equal(blockCodeProblem({ v: 1, nodes: {} }), null);
  const ref = { path: 'a.py', start: 1 };
  const bad: unknown[] = [
    null, 'x', [], {}, { v: 0 }, { v: 1.5 }, { v: 1 }, { v: 1, nodes: [] },
    { v: 1, nodes: { '': { refs: [] } } },
    { v: 1, nodes: { ['n'.repeat(201)]: { refs: [] } } },
    { v: 1, nodes: JSON.parse('{"__proto__":{"refs":[]}}') },
    { v: 1, nodes: { A: { refs: 'x' } } },
    { v: 1, nodes: { A: { refs: [], summary: 's'.repeat(501) } } },
    { v: 1, nodes: { A: { refs: Array(MAX_CODE_REFS + 1).fill(ref) } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, path: '/abs' }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, path: 'a/../b' }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, path: 'a\\b' }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, path: 'a\0b' }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, start: 0 }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, start: 5, end: 4 }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, start: 1, end: 2002 }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, symbol: 's'.repeat(201) }] } } },
    { v: 1, nodes: { A: { refs: [{ ...ref, note: 'n'.repeat(301) }] } } },
  ];
  for (const b of bad) assert.notEqual(blockCodeProblem(b), null, JSON.stringify(b));
  const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`n${i}`, { refs: [] }]));
  assert.notEqual(blockCodeProblem({ v: 1, nodes: many }), null);
  assert.equal(blockCodeProblem({ v: 1, nodes: { A: { refs: [{ ...ref, end: 2001 }] } } }), null);
});

test('unknown newer v is accepted and kept verbatim; v1 drops unknown fields', () => {
  const future = { v: 2, nodes: 'anything', extra: true } as never;
  assert.equal(blockCodeProblem(future), null);
  assert.equal(cleanBlockCode(future), future);
  const cleaned = cleanBlockCode({ ...good, junk: 1, nodes: { A: { ...good.nodes.A!, x: 1 } } } as never);
  assert.deepEqual(cleaned, good);
});

test('mergeCodeRefs: block wins, DSL adds missing refs, no duplicates, cap, pure', () => {
  const before = JSON.stringify(good);
  const m = mergeCodeRefs(good, {
    A: [{ path: 'a/b.py', start: 1, end: 9, symbol: 'f' }, { path: 'c.py', start: 2 }],
    B: [{ path: 'd.py', start: 7 }],
  });
  assert.deepEqual(m.A, { summary: 's', refs: [good.nodes.A!.refs[0], { path: 'c.py', start: 2 }] });
  assert.deepEqual(m.B, { refs: [{ path: 'd.py', start: 7 }] });
  assert.equal(JSON.stringify(good), before);
  assert.deepEqual({ ...mergeCodeRefs(undefined, undefined) }, {});
  assert.deepEqual({ ...mergeCodeRefs(good, undefined) }, good.nodes);
  // newer block v is not understood: only DSL refs
  assert.deepEqual({ ...mergeCodeRefs({ v: 2, nodes: 'x' } as never, { A: [{ path: 'q.py', start: 1 }] }) }, { A: { refs: [{ path: 'q.py', start: 1 }] } });
  const full = mergeCodeRefs({ v: 1, nodes: { A: { refs: Array.from({ length: MAX_CODE_REFS }, (_, i) => ({ path: `f${i}.py`, start: 1 })) } } }, { A: [{ path: 'extra.py', start: 1 }] });
  assert.equal(full.A!.refs.length, MAX_CODE_REFS);
});

test('node names that are Object.prototype members are plain keys (constructor, toString, __proto__)', () => {
  const src = 'constructor [code: "a.py:1-2"]\ntoString [code: "b.py:3"]\nhasOwnProperty [code: "c.py:4"]\n__proto__ [code: "d.py:5"]\nconstructor > toString';
  const g = parse(src, 'flowchart-diagram').ast as GraphDiagram;
  const dsl = dslCodeRefs(g.children);
  assert.deepEqual(Object.keys(dsl).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'toString']);
  assert.deepEqual(dsl['__proto__'], [{ path: 'd.py', start: 5 }]);
  const m = mergeCodeRefs({ v: 1, nodes: { toString: { refs: [{ path: 'x.py', start: 1 }] } } }, dsl);
  assert.deepEqual(m['constructor'], { refs: [{ path: 'a.py', start: 1, end: 2 }] });
  assert.deepEqual(m['toString'], { refs: [{ path: 'x.py', start: 1 }, { path: 'b.py', start: 3 }] });
  assert.deepEqual(m['hasOwnProperty'], { refs: [{ path: 'c.py', start: 4 }] });
  assert.deepEqual(m['__proto__'], { refs: [{ path: 'd.py', start: 5 }] });
  assert.equal(Object.hasOwn(mergeCodeRefs(undefined, undefined), 'constructor'), false);
  const box = (id: string, x: number) => ({ kind: 'box', id, role: 'node', shape: 'rectangle', x, y: 0, w: 50, h: 30, paint: { mode: 'outline' }, shadow: false });
  const scene = { type: 'flowchart', width: 300, height: 60, items: [box('constructor', 0), box('__proto__', 100), box('valueOf', 200)] } as unknown as Scene;
  let n = 0;
  const { skeletons } = sceneToFreeform(scene, { x: 0, y: 0, width: 300 }, () => `k${n++}`, m);
  assert.deepEqual(skeletons[0]!.customData, { codeRefs: { refs: [{ path: 'a.py', start: 1, end: 2 }] } });
  assert.deepEqual(skeletons[1]!.customData, { codeRefs: { refs: [{ path: 'd.py', start: 5 }] } });
  assert.equal('customData' in skeletons[2]!, false);
});

test('free-form conversion copies the node entry to customData.codeRefs', () => {
  const box = (id: string, x: number) => ({ kind: 'box', id, role: 'node', shape: 'rectangle', x, y: 0, w: 50, h: 30, paint: { mode: 'outline' }, shadow: false });
  const scene = { type: 'flowchart', width: 200, height: 60, items: [box('A', 0), box('B', 100)] } as unknown as Scene;
  let n = 0;
  const { skeletons } = sceneToFreeform(scene, { x: 0, y: 0, width: 200 }, () => `i${n++}`, mergeCodeRefs(good, undefined));
  assert.deepEqual(skeletons[0]!.customData, { codeRefs: good.nodes.A });
  assert.equal('customData' in skeletons[1]!, false);
  const none = sceneToFreeform(scene, { x: 0, y: 0, width: 200 }, () => `j${n++}`).skeletons;
  assert.equal('customData' in none[0]!, false);
});

test('stripCodeAttrs removes code attributes only', async () => {
  const { stripCodeAttrs } = await import('../shared/dsl/code-refs.ts');
  const src = 'A [icon: video, code: "src/r.py:1-2; b.py"]\nB [code: "x.py"]\nC [code: "x.py", color: red]\nD [icon: db]\nA > B';
  assert.equal(stripCodeAttrs(src), 'A [icon: video]\nB\nC [color: red]\nD [icon: db]\nA > B');
  assert.equal(stripCodeAttrs('title "code: x"'), 'title "code: x"');
});

test('stripCodeAttrs leaves code: inside quoted values and other text unchanged (E504g)', async () => {
  const { stripCodeAttrs } = await import('../shared/dsl/code-refs.ts');
  const keep = [
    'A [label: "see code: here"]',
    'A [label: "see code: here", color: red]',
    "A [label: \"it's code: 'x'\"]",
    'A [label: "x[]"]',
    'A [label: "a, ]b"]',
    'x[] > y',
    'A [icon: db, label: "a [ , ] b"]',
    'title "code: x"',
    '// A [code: "x.py"]',
    'A [link: "https://x.test/code: a"]',
  ];
  for (const line of keep) assert.equal(stripCodeAttrs(line), line, line);
  assert.equal(stripCodeAttrs('A [label: "see code: here", code: "a.py"]'), 'A [label: "see code: here"]');
  assert.equal(stripCodeAttrs('A [code: "a.py", label: "x[]"]\nB [label: "code: y", code: b.py:3, color: red]'), 'A [label: "x[]"]\nB [label: "code: y", color: red]');
  assert.equal(stripCodeAttrs('A [code: "a.py"] > B [code: "b.py", icon: db]'), 'A > B [icon: db]');
  assert.equal(stripCodeAttrs('A [ code : "a.py" ] // note'), 'A // note');
});

test('stripCodeAttrs and parseAttrs handle brackets inside unquoted values (E504h)', async () => {
  const { stripCodeAttrs } = await import('../shared/dsl/code-refs.ts');
  assert.equal(stripCodeAttrs('A [code: app/[id]/page.tsx, color: red]'), 'A [color: red]');
  assert.equal(stripCodeAttrs('A [color: red, code: app/[id]/page.tsx]'), 'A [color: red]');
  assert.equal(stripCodeAttrs('A [code: app/[id]/page.tsx]\nB'), 'A\nB');
  assert.equal(stripCodeAttrs('A [code: a/[x]/[y].tsx:3, icon: db]'), 'A [icon: db]');
  assert.equal(stripCodeAttrs('A [code: x.py, color: red]'), 'A [color: red]');
  assert.equal(stripCodeAttrs('A [color: red]'), 'A [color: red]');
  const { ast, diagnostics } = parse('A [code: app/[id]/page.tsx, color: red]\nB', 'cloud-architecture');
  assert.deepEqual({ ...dslCodeRefs((ast as GraphDiagram).children) }, { A: [{ path: 'app/[id]/page.tsx', start: 1 }] });
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error' || /Bad code/.test(d.message)), []);
});

test('unmatched [ in an unquoted value ends at the first , or ] like a plain value (E504h)', async () => {
  const { stripCodeAttrs } = await import('../shared/dsl/code-refs.ts');
  assert.equal(stripCodeAttrs('A [code: a[b, color: red]'), 'A [color: red]');
  assert.equal(stripCodeAttrs('A [color: red, code: a[b]'), 'A [color: red]');
  const { ast, diagnostics } = parse('A [label: a[b, color: red]\nB', 'cloud-architecture');
  const a = (ast as GraphDiagram).children[0] as { attrs?: Record<string, string> };
  assert.equal(a.attrs?.label, 'a[b');
  assert.equal(a.attrs?.color, 'red');
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
});

test("'.' path segments are dropped, '#' in a path is reported, empty symbol is rejected in block JSON (#469)", () => {
  const r = parseCodeAttr('./a.py:3; a/./b.py#f; .; a#b/c.py; a#b#c');
  assert.deepEqual(r.refs, [{ path: 'a.py', start: 3 }, { path: 'a/b.py', start: 1, symbol: 'f' }]);
  assert.equal(r.problems.length, 3);
  assert.match(r.problems[0]!, /'\.'.*path must name a file/);
  assert.match(r.problems[1]!, /paths with '#' are not supported/);
  assert.match(r.problems[2]!, /paths with '#' are not supported/);
  const ok = { v: 1, nodes: { A: { refs: [{ path: './src/./a.py', start: 1 }] } } };
  assert.equal(blockCodeProblem(ok), null);
  assert.deepEqual(cleanBlockCode(ok as BlockCode).nodes.A!.refs, [{ path: 'src/a.py', start: 1 }]);
  assert.match(blockCodeProblem({ v: 1, nodes: { A: { refs: [{ path: '.', start: 1 }] } } })!, /must name a file/);
  assert.match(blockCodeProblem({ v: 1, nodes: { A: { refs: [{ path: 'a.py', start: 1, symbol: '' }] } } })!, /symbol must be a string of 1-/);
});

test('stripCodeAttrs edge cases are pinned (#473, #479)', async () => {
  const { stripCodeAttrs } = await import('../shared/dsl/code-refs.ts');
  // Single quotes are plain characters, as in parseAttrs (which reads code: "b'").
  assert.equal(stripCodeAttrs("A [label: 'a, code: b']"), "A [label: 'a]");
  // No closing ] on the line, malformed entries: left as written (the parser reports an error).
  assert.equal(stripCodeAttrs('A [color: red, code: x\nB'), 'A [color: red, code: x\nB');
  assert.equal(stripCodeAttrs('A [foo bar code: x]'), 'A [foo bar code: x]');
  // A rebuilt list joins kept entries with ', '; their own text is kept.
  assert.equal(stripCodeAttrs('A [color:red ,  code: x,icon:  y]'), 'A [color:red, icon:  y]');
  // A list alone on its line keeps the indentation; after a node name the space before it goes too.
  assert.equal(stripCodeAttrs('g {\n  [code: x]\n}'), 'g {\n  \n}');
  assert.equal(stripCodeAttrs('  A  [code: x]'), '  A');
  // Unbalanced nested brackets the parser also rejects (#479): current output pinned.
  assert.equal(stripCodeAttrs('A [code: a[[b], color: red]'), 'A, color: red]');
});
