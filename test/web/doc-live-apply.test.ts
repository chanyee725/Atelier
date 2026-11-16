// E520: applying an outside document change to an editor state keeps the selection and changes only what differs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { docExtensions } from '../../web/src/doc/extensions.ts';
import { planLive, liveApplyPlugin } from '../../web/src/doc/liveApply.ts';
import { history, undo, undoDepth } from '@tiptap/pm/history';

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

test('a block still fading out is not matched with a new block of the same type (#547)', () => {
  // [a, gone, c] -> [a, c] (gone fades) -> [a, NEW, c] before the fade ends: NEW must stay, gone must go.
  const s0 = EditorState.create({ schema, doc: doc(p('a'), p('gone'), p('c')), plugins: [liveApplyPlugin()] });
  const r1 = apply(s0, doc(p('a'), p('c')), true)!;
  assert.equal(r1.exits, 1);
  const r2 = apply(r1.state, doc(p('a'), p('NEW'), p('c')), true)!;
  assert.deepEqual(r2.state.doc.toJSON(), doc(p('a'), p('NEW'), p('c')).toJSON());
  const exiting = liveApplyPlugin().spec.key!.getState(r2.state)?.find(undefined, undefined, (x) => x.cls === 'live-exit') ?? [];
  assert.equal(exiting.length, 0);
});

test('a user edit during the fade-out takes the fading block out in the same update (#554)', () => {
  // [a, gone, c] -> [a, c] (gone fades) -> the user types before the fade ends: the state the editor saves has no "gone".
  const s0 = EditorState.create({ schema, doc: doc(p('a'), p('gone'), p('c')), plugins: [liveApplyPlugin()] });
  const r1 = apply(s0, doc(p('a'), p('c')), true)!;
  assert.equal(r1.state.doc.childCount, 3);
  const { state } = r1.state.applyTransaction(r1.state.tr.insertText('x', 2));
  assert.deepEqual(state.doc.toJSON(), doc(p('ax'), p('c')).toJSON());
  const exiting = liveApplyPlugin().spec.key!.getState(state)?.find(undefined, undefined, (x) => x.cls === 'live-exit') ?? [];
  assert.equal(exiting.length, 0);
});

test('a selection-only change does not flush the fade-out (#554)', () => {
  const s0 = EditorState.create({ schema, doc: doc(p('a'), p('gone'), p('c')), plugins: [liveApplyPlugin()] });
  const r1 = apply(s0, doc(p('a'), p('c')), true)!;
  const { state } = r1.state.applyTransaction(r1.state.tr.setSelection(TextSelection.create(r1.state.doc, 2)));
  assert.equal(state.doc.childCount, 3);
});

test('typing inside a fading block keeps that block and is undoable (#567)', () => {
  // [a, gone, c] -> [a, c] (gone fades) -> the user types inside "gone": the block stays, the typing has an undo step.
  const s0 = EditorState.create({ schema, doc: doc(p('a'), p('gone'), p('c')), plugins: [liveApplyPlugin(), history()] });
  const r1 = apply(s0, doc(p('a'), p('c')), true)!;
  const { state } = r1.state.applyTransaction(r1.state.tr.insertText('x', 5));
  assert.deepEqual(state.doc.toJSON(), doc(p('a'), p('gxone'), p('c')).toJSON());
  const exiting = liveApplyPlugin().spec.key!.getState(state)?.find(undefined, undefined, (x) => x.cls === 'live-exit') ?? [];
  assert.equal(exiting.length, 0);
  assert.equal(undoDepth(state), 1);
  let undone: EditorState | null = null;
  assert.ok(undo(state, (tr) => (undone = state.apply(tr))));
  assert.deepEqual(undone!.doc.toJSON(), doc(p('a'), p('gone'), p('c')).toJSON());
});

test('typing elsewhere during the fade-out still takes the fading block out and stays undoable (#554, #567)', () => {
  const s0 = EditorState.create({ schema, doc: doc(p('a'), p('gone'), p('c')), plugins: [liveApplyPlugin(), history()] });
  const r1 = apply(s0, doc(p('a'), p('c')), true)!;
  const { state } = r1.state.applyTransaction(r1.state.tr.insertText('x', 2));
  assert.deepEqual(state.doc.toJSON(), doc(p('ax'), p('c')).toJSON());
  let undone: EditorState | null = null;
  assert.ok(undo(state, (tr) => (undone = state.apply(tr))));
  assert.deepEqual(undone!.doc.toJSON(), doc(p('a'), p('c')).toJSON());
});
