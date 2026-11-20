import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectDoc, ProjectInfo } from '../../web/src/api.ts';
import { filterRecent, recentRows } from '../../web/src/home/recentModel.ts';

const doc = (path: string, modifiedAt: number, extra: Partial<ProjectDoc> = {}): ProjectDoc => ({ path, name: path, title: path, bundle: false, createdAt: 0, modifiedAt, children: [], ...extra });
const project = (path: string, docs: ProjectDoc[]): ProjectInfo => ({ id: path, path, name: path, icon: '', description: '', docCount: docs.length, createdAt: 0, modifiedAt: 0, docs });

test('recentRows: newest edit first, plans marked, bundles skipped (#889)', () => {
  const rows = recentRows(
    [project('web', [doc('web/a', 10), doc('web/p', 30, { plan: 'draft' as ProjectDoc['plan'] }), doc('web/g', 99, { bundle: true, children: [doc('web/g/c', 20)] })])],
    [doc('root', 5)],
  );
  assert.deepEqual(rows.map((r) => [r.path, r.kind]), [['web/p', 'plan'], ['web/g/c', 'doc'], ['web/a', 'doc'], ['root', 'doc']]);
  assert.equal(rows[1].parent, 'web/g', 'a bundle still names the parent');
  assert.equal(rows[3].project, null);
});

test('filterRecent keeps one kind or all (#889)', () => {
  const rows = recentRows([project('web', [doc('web/a', 1), doc('web/p', 2, { plan: 'draft' as ProjectDoc['plan'] })])], []);
  assert.equal(filterRecent(rows, 'all').length, 2);
  assert.deepEqual(filterRecent(rows, 'plan').map((r) => r.path), ['web/p']);
  assert.deepEqual(filterRecent(rows, 'doc').map((r) => r.path), ['web/a']);
  assert.deepEqual(recentRows([], []), []);
});
