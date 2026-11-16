// E529 (#619): agent cursors in the document — the event model, the place-to-position mapping and the glide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, getSchema } from '@tiptap/core';
import { withTrailingParagraph } from '../../web/src/doc/model.ts';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { applyDocCursor, docPos, DOC_MOVE_MS, glideAt, gliding, nextGlide, pruneDocGone, SETTLE_MS, type DocCursor } from '../../web/src/doc/docCursor.ts';
import { FADE_AFTER_MS, FADE_MS } from '../../web/src/canvas/agentCursor.ts';
import { blockText, changedDocSpot, docBlocksOf } from '../../server/cursor/model.js';

const schema = getSchema(docExtensions());
const p = (t: string) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] });
const h = (t: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
const json = (...c: unknown[]) => ({ type: 'doc', content: c });
const doc = (...c: unknown[]) => schema.nodeFromJSON(json(...c));
const ev = (doc?: unknown, extra = {}) => ({ sid: 's1', name: 'Otto', role: 'impl', file: 'a.dpx.json', ...(doc ? { doc } : {}), ...extra }) as never;

test('applyDocCursor: a doc place creates and moves the cursor; no place keeps it alive; gone removes it', () => {
  let m: ReadonlyMap<string, DocCursor> = new Map();
  assert.equal(applyDocCursor(m, ev(), 0), m, 'no place and no cursor: nothing');
  assert.equal(applyDocCursor(m, ev(undefined, { x: 1, y: 2 }), 0), m, 'a canvas-only place is not a doc cursor');
  assert.equal(applyDocCursor(m, ev({ index: -1, offset: 0 }), 0), m, 'a bad place is ignored');
  m = applyDocCursor(m, ev({ index: 1, offset: 3 }, { color: '#0f766e' }), 100);
  assert.deepEqual(m.get('s1'), { sid: 's1', name: 'Otto', role: 'impl', color: '#0f766e', file: 'a.dpx.json', spot: { index: 1, offset: 3 }, moveAt: 100, editAt: 100, live: false, status: '' });
  m = applyDocCursor(m, ev(), 500);
  assert.equal(m.get('s1')!.moveAt, 100);
  assert.equal(m.get('s1')!.editAt, 500);
  // An edit on the canvas only does not keep the document cursor writing (#627).
  assert.equal(applyDocCursor(m, ev(undefined, { x: 5, y: 6 }), 700), m);
  m = applyDocCursor(m, ev({ index: 2, offset: 0 }), 900);
  assert.deepEqual(m.get('s1')!.spot, { index: 2, offset: 0 });
  // Two sessions, two cursors.
  m = applyDocCursor(m, ev({ index: 0, offset: 0 }, { sid: 's2', name: 'Cal' }), 900);
  assert.equal(m.size, 2);
  m = applyDocCursor(m, { sid: 's1', gone: true }, 1000);
  assert.deepEqual([...m.keys()], ['s2']);
  // It fades out by itself.
  assert.equal(pruneDocGone(m, 900 + FADE_AFTER_MS + FADE_MS).size, 0);
  assert.equal(pruneDocGone(m, 900 + FADE_AFTER_MS), m);
});

test('docPos: block index and text offset map to an editor position, clamped', () => {
  const d = doc(h('Plan'), p('hello'), { type: 'diagram', attrs: { blockId: 'b1' } }, p(''));
  // Heading at 0 (size 6), paragraph at 6: its text starts at 7.
  assert.deepEqual(docPos(d, { index: 1, offset: 0 }), { pos: 7, atom: false });
  assert.deepEqual(docPos(d, { index: 1, offset: 5 }), { pos: 12, atom: false });
  assert.deepEqual(docPos(d, { index: 1, offset: 99 }), { pos: 12, atom: false });
  assert.deepEqual(docPos(d, { index: 0, offset: 2 }), { pos: 3, atom: false });
  // The diagram embed: the node itself.
  assert.deepEqual(docPos(d, { index: 2, offset: 0 }), { pos: 13, atom: true });
  // An empty paragraph: inside it. Past the end: the last block.
  assert.deepEqual(docPos(d, { index: 3, offset: 0 }), { pos: 15, atom: false });
  assert.deepEqual(docPos(d, { index: 9, offset: 0 }), { pos: 15, atom: false });
});

test('docPos: text in nested blocks counts like the server (lists, marks)', () => {
  const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p('ab')] }, { type: 'listItem', content: [p('cd')] }] };
  const bold = { type: 'paragraph', content: [{ type: 'text', text: 'x' }, { type: 'text', text: 'yz', marks: [{ type: 'bold' }] }] };
  const d = doc(list, bold);
  assert.equal(blockText(list), 'abcd');
  const at = docPos(d, { index: 0, offset: 3 })!;
  assert.equal(d.textBetween(0, at.pos), 'abc');
  const b = docPos(d, { index: 1, offset: 2 })!;
  assert.equal(d.textBetween(d.child(0).nodeSize, b.pos), 'xy');
});

test('server place to editor position, end to end: the caret lands right after what the agent wrote', () => {
  const before = json(h('Plan'), p('one'));
  const after = json(h('Plan'), p('one two'), p('three'));
  const spot = changedDocSpot(docBlocksOf({ document: before }), docBlocksOf({ document: after }))!;
  const d = schema.nodeFromJSON(after);
  const at = docPos(d, spot)!;
  assert.equal(d.textBetween(0, at.pos, '|'), 'Plan|one two|three');
  const edit = changedDocSpot(docBlocksOf({ document: before }), docBlocksOf({ document: json(h('Plan'), p('one, more')) }))!;
  const d2 = schema.nodeFromJSON(json(h('Plan'), p('one, more')));
  assert.equal(d2.textBetween(0, docPos(d2, edit)!.pos, '|'), 'Plan|one, more');
});

test('nextGlide: first place snaps, a new place glides, a late reflow or reduced motion snaps', () => {
  const c = { moveAt: 1000 };
  let g = nextGlide(undefined, c, { x: 10, y: 20 }, 1000, false);
  assert.deepEqual(glideAt(g, 1000, false), { x: 10, y: 20 });
  assert.equal(gliding(g, 1000, false), false);
  assert.equal(nextGlide(g, c, { x: 10.2, y: 20 }, 1010, false), g, 'sub-pixel noise keeps the glide');
  g = nextGlide(g, c, { x: 110, y: 120 }, 1050, false);
  assert.deepEqual(glideAt(g, 1050, false), { x: 10, y: 20 });
  const mid = glideAt(g, 1050 + DOC_MOVE_MS / 2, false);
  assert.ok(mid.x > 60 && mid.x < 110, `past halfway at half time: ${mid.x}`);
  assert.equal(gliding(g, 1100, false), true);
  assert.deepEqual(glideAt(g, 1050 + DOC_MOVE_MS, false), { x: 110, y: 120 });
  // The user's typing moves the text long after the agent's edit: no glide.
  const late = nextGlide(g, c, { x: 130, y: 120 }, 1000 + SETTLE_MS + 1, false);
  assert.deepEqual(glideAt(late, 1000 + SETTLE_MS + 1, false), { x: 130, y: 120 });
  const red = nextGlide(g, c, { x: 200, y: 0 }, 1100, true);
  assert.deepEqual(glideAt(red, 1100, true), { x: 200, y: 0 });
  assert.equal(gliding(red, 1100, true), false);
});

test('server block index matches the editor children through the editor load path (tables, embeds, trailing paragraph)', () => {
  // As DocPane opens a file: withTrailingParagraph, then TipTap's content check against the real schema.
  const load = (j: unknown) => createDocument(withTrailingParagraph(j) as never, schema, undefined, { errorOnInvalidContent: true });
  const cell = (t: string, type = 'tableCell') => ({ type, content: [p(t)] });
  const table = (a: string, b: string) => ({
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('Name', 'tableHeader'), cell('Note', 'tableHeader')] },
      { type: 'tableRow', content: [cell(a), cell(b)] },
    ],
  });
  const diagram = { type: 'diagram', attrs: { blockId: 'b1' } };
  const frame = { type: 'frameEmbed', attrs: { frameId: 'f1', name: 'Frame' } };
  const rule = { type: 'horizontalRule' };
  const base = [h('Plan'), diagram, table('x', 'y'), frame, rule];
  const cases: Array<[unknown[], unknown[], string]> = [
    // Text typed into a table cell: the caret is right after it, inside the table.
    [[...base, p('end')], [h('Plan'), diagram, table('x', 'y and more'), frame, rule, p('end')], 'NameNotexy and more'],
    // A paragraph after the embeds and the rule: they do not shift the index.
    [[...base, p('end')], [...base, p('end, then more')], 'end, then more'],
    // The last block is not a paragraph: the editor appends one, which comes after every server index.
    [[...base], [...base, h('Next')], 'Next'],
  ];
  for (const [before, after, upTo] of cases) {
    const spot = changedDocSpot(docBlocksOf({ document: json(...before) }), docBlocksOf({ document: json(...after) }))!;
    const d = load(json(...after));
    assert.ok(d.childCount >= after.length, 'the editor never drops top-level blocks');
    for (let i = 0; i < after.length; i++) assert.equal(d.child(i).type.name, (after[i] as { type: string }).type, `block ${i} keeps its place`);
    const at = docPos(d, spot)!;
    let start = 0;
    for (let i = 0; i < spot.index; i++) start += d.child(i).nodeSize;
    assert.equal(d.textBetween(start, at.pos), upTo);
  }
  // An embed changed in place: its block is the place (an atom, no text).
  const spot = changedDocSpot(docBlocksOf({ document: json(...base) }), docBlocksOf({ document: json(h('Plan'), { ...diagram, attrs: { blockId: 'b2' } }, table('x', 'y'), frame, rule) }))!;
  assert.deepEqual(spot, { index: 1, offset: 0 });
  const d = load(json(h('Plan'), { ...diagram, attrs: { blockId: 'b2' } }, table('x', 'y'), frame, rule));
  assert.deepEqual(docPos(d, spot), { pos: d.child(0).nodeSize, atom: true });
});

// E536 (#653): the live caret stays at its last place until `gone`; a canvas edit lets it fade.
test('applyDocCursor: a live caret never fades; a canvas-only edit lets it go; status rides along', () => {
  let m = applyDocCursor(new Map(), ev({ index: 0, offset: 1 }, { live: true, status: '글 작성 중…' }), 0);
  assert.equal(m.get('s1')!.status, '글 작성 중…');
  assert.equal(pruneDocGone(m, 30 * 60_000), m);
  const kept = applyDocCursor(m, ev(undefined, { live: true }), 5000);
  assert.equal(kept.get('s1')!.status, '글 작성 중…');
  assert.equal(kept.get('s1')!.editAt, 5000);
  m = applyDocCursor(m, ev(undefined, { x: 1, y: 2, live: true }), 60_000);
  assert.equal(m.get('s1')!.live, false);
  assert.equal(pruneDocGone(m, 60_000 + FADE_MS).size, 0);
  assert.ok(FADE_AFTER_MS > 0);
});
