import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderOf, hashWith, inScope, openCounts, projectOf, sessionsOf, viewPart } from '../../web/src/dispatch/lib/folder.ts';
import { viewOf } from '../../web/src/dispatch/lib/usage.ts';

const s = (id: string, folder: string | null | undefined, status = 'running') => ({ id, folder, status }) as never;
const known = new Set(['a', 'b c']);

test('hash carries the view and the project scope', () => {
  assert.equal(folderOf(''), undefined);
  assert.equal(folderOf('#timeline'), undefined);
  assert.equal(folderOf('#folder=a'), 'a');
  assert.equal(folderOf('#usage&folder=b%20c'), 'b c');
  assert.equal(folderOf('#folder='), null);
  assert.equal(folderOf('#folder'), null);
  assert.equal(viewPart('#usage&folder=a'), 'usage');
  assert.equal(viewPart('#folder=a'), '');
  assert.equal(viewOf('#folder=a'), 'sessions');
  assert.equal(viewOf('#timeline&folder=a'), 'timeline');
  assert.equal(hashWith('', undefined), '');
  assert.equal(hashWith('usage', undefined), '#usage');
  assert.equal(hashWith('', 'a'), '#folder=a');
  assert.equal(hashWith('timeline', 'b c'), '#timeline&folder=b%20c');
  assert.equal(hashWith('', null), '#folder=');
  for (const sc of [undefined, null, 'a', 'x&y=z', 'ä 한']) assert.equal(folderOf(hashWith('usage', sc)), sc);
});

test('scoping: unknown or missing folders count as 미분류', () => {
  const all = [s('1', 'a'), s('2', 'b c'), s('3', null), s('4', undefined), s('5', 'gone')];
  assert.equal(projectOf(all[4], known), null);
  assert.deepEqual(inScope(all, undefined, known).length, 5);
  assert.deepEqual(inScope(all, 'a', known).map((x: { id: string }) => x.id), ['1']);
  assert.deepEqual(inScope(all, null, known).map((x: { id: string }) => x.id), ['3', '4', '5']);
});

test('open counts per project skip finished sessions', () => {
  const m = openCounts([s('1', 'a'), s('2', 'a'), s('3', 'a', 'done'), s('4', 'gone'), s('5', 'b c', 'error')], known);
  assert.equal(m.get('a'), 2);
  assert.equal(m.get(null), 1);
  assert.equal(m.get('b c'), undefined);
});

test('project home lists open sessions first', () => {
  const list = sessionsOf([{ ...s('1', 'a', 'done'), startedAt: 9 }, { ...s('2', 'a'), startedAt: 1 }, { ...s('3', 'b c'), startedAt: 5 }] as never, 'a');
  assert.deepEqual(list.map((x) => x.id), ['2', '1']);
  // '' = the whole project's dashboard (#778): every session, open first.
  assert.deepEqual(sessionsOf([{ ...s('1', 'a', 'done'), startedAt: 9 }, { ...s('2', null), startedAt: 1 }, { ...s('3', 'b c'), startedAt: 5 }] as never, '').map((x) => x.id), ['3', '2', '1']);
});

test('knownFolders keeps a picked project known until the project list has arrived', async () => {
  const { knownFolders } = await import('../../web/src/dispatch/lib/folder.ts');
  assert.deepEqual([...knownFolders([], '/w/alpha', false)], ['/w/alpha']);
  assert.deepEqual([...knownFolders([], '/w/alpha', true)], []);
  assert.deepEqual([...knownFolders(['/w/b'], null, false)], ['/w/b']);
  assert.deepEqual([...knownFolders(['/w/b'], undefined, false)], ['/w/b']);
});

test('scopePending holds 미분류 until the project list has arrived (#761)', async () => {
  const { scopePending } = await import('../../web/src/dispatch/lib/folder.ts');
  assert.equal(scopePending(null, 'loading'), true);
  assert.equal(scopePending(null, 'ready'), false);
  assert.equal(scopePending(null, 'failed'), false);
  assert.equal(scopePending(undefined, 'loading'), false);
  assert.equal(scopePending('/w/alpha', 'loading'), false);
});
