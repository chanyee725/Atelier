// The sidebar's shown name for a document (web/src/docTitles.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayName } from '../web/src/docTitles.ts';

test('displayName: the title, else the file name without .dpx.json', () => {
  assert.equal(displayName({ name: 'a.dpx.json', title: '계획' }), '계획');
  assert.equal(displayName({ name: 'a.dpx.json' }), 'a');
  assert.equal(displayName({ name: 'a', title: '' }), 'a');
});
