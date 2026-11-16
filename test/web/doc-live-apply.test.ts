// E520: applying an outside document change to an editor state keeps the selection and changes only what differs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { planLive } from '../../web/src/doc/liveApply.ts';

const schema = getSchema(docExtensions());
const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const h = (t: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
const doc = (...c: unknown[]) => schema.nodeFromJSON({ type: 'doc', content: c });
const stateOf = (d: ReturnType<typeof doc>) => EditorState.create({ schema, doc: d });
const apply = (s: EditorState, target: ReturnType<typeof doc>, fade = false) => {
  const plan = planLive(s, target, fade);
  return plan ? { ...plan, state: s.apply(plan.tr) } : null;
};

test('no difference, no transaction', () => {
  assert.equal(planLive(stateOf(doc(p('a'))), doc(p('a')), false), null);
});

test('appended paragraph and heading land after the cursor block, cursor stays', () => {
  let s = stateOf(doc(p('hello'), p('tail')));
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
  const r = apply(s, doc(p('hello'), p('tail'), h('New'), p('more')))!;
  assert.deepEqual(r.state.doc.toJSON(), doc(p('hello'), p('tail'), h('New'), p('more')).toJSON());
  assert.equal(r.state.selection.from, 3);
});

test('a changed text updates in place and the cursor in the unchanged head stays', () => {
  let s = stateOf(doc(p('hello world')));
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3)));
  const r = apply(s, doc(p('hello brave world')))!;
  assert.equal(r.state.doc.textContent, 'hello brave world');
  assert.equal(r.state.selection.from, 3);
});

test('changes in several places land correctly, in one transaction', () => {
  const r = apply(stateOf(doc(p('a'), p('b'), p('c'), p('d'))), doc(h('top'), p('a'), p('B'), p('d'), p('e')))!;
  assert.deepEqual(r.state.doc.toJSON(), doc(h('top'), p('a'), p('B'), p('d'), p('e')).toJSON());
});

test('fade-out keeps the removed block until it is flushed and marks it', () => {
  const r = apply(stateOf(doc(p('a'), p('gone'), p('c'))), doc(p('a'), p('c')), true)!;
  assert.equal(r.exits, 1);
  assert.equal(r.state.doc.childCount, 3);
});

test('outside changes are not undoable steps', () => {
  const r = apply(stateOf(doc(p('a'))), doc(p('a'), p('b')))!;
  assert.equal(r.tr.getMeta('addToHistory'), false);
});
