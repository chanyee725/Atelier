// #547: an outside code change synced into the code panel must not come back as a user edit (no save, no 409).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { syncSpec, userCode } from '../../web/src/codeSync.ts';

const upd = (s: EditorState, spec: Parameters<EditorState['update']>[0]) => {
  const tr = s.update(spec);
  return { docChanged: tr.docChanged, transactions: [tr], state: tr.state };
};

test('a synced outside change is not reported as a user edit', () => {
  const s = EditorState.create({ doc: 'a -> b' });
  const u = upd(s, syncSpec(s, 'a -> b -> c')!);
  assert.equal(u.state.doc.toString(), 'a -> b -> c');
  assert.equal(userCode(u), null);
});

test('a user edit is reported', () => {
  const s = EditorState.create({ doc: 'a -> b' });
  assert.equal(userCode(upd(s, { changes: { from: 6, insert: ' -> x' } })), 'a -> b -> x');
});

test('same text: nothing to sync', () => {
  assert.equal(syncSpec(EditorState.create({ doc: 'x' }), 'x'), null);
});
