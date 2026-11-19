import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prOffText, shownRows, treeEntries, treeSummary, type BranchRow, type BranchTree } from '../../web/src/dispatch/lib/liveBranches.ts';
import { boardHash, parseBoardHash } from '../../web/src/projectNav.ts';

const row = (branch: string, o: Partial<BranchRow> = {}): BranchRow => ({
  branch, sessions: [], issue: null, ahead: 1, behind: 0, lastAt: 0, subject: 's', dirty: null, merged: false, pr: null, ...o,
});
const ses = (id: string, open: boolean, folder: string | null = 'p') => ({ id, name: id, role: 'impl', roleName: '구현자', color: null, folder, open });

test('live work first, merged last, then newest commit; scope filter keeps rows with a matching session', () => {
  const rows = [
    row('merged', { merged: true, lastAt: 9, sessions: [ses('a', true)] }),
    row('idle', { lastAt: 8, sessions: [ses('b', false)] }),
    row('old', { lastAt: 1, sessions: [ses('c', true)] }),
    row('new', { lastAt: 5, sessions: [ses('d', true, 'q')] }),
  ];
  assert.deepEqual(shownRows(rows).map((r) => r.branch), ['new', 'old', 'idle', 'merged']);
  assert.deepEqual(shownRows(rows, (s) => s.folder === 'p').map((r) => r.branch), ['old', 'idle', 'merged']);
});

test('PR-off reasons read as a short line; the 브랜치 tab round-trips through the address', () => {
  assert.equal(prOffText('on'), null);
  assert.match(prOffText('disabled')!, /PR 추적이 꺼져/);
  assert.deepEqual(parseBoardHash('#board=branches'), { kind: 'board', tab: 'branches' });
  assert.equal(boardHash({ tab: 'branches', folder: 'a b' }), '#board=branches&folder=a%20b');
});

test('treeEntries keeps the base and shown branches, drops hidden commits and dangling parents, marks tips (#877)', () => {
  const tree: BranchTree = {
    base: 'develop',
    commits: [
      { hash: 'x1', parents: ['m'], branch: 'feat/x', at: 4, subject: 'x one' },
      { hash: 'b1', parents: ['m'], branch: 'feat/b', at: 3, subject: 'b one' },
      { hash: 'm', parents: ['i', 'a1'], branch: 'develop', at: 2, subject: 'merge' },
      { hash: 'a1', parents: ['i'], branch: 'develop', at: 1, subject: 'a one' },
      { hash: 'i', parents: ['gone'], branch: 'develop', at: 0, subject: 'init' },
    ],
    tips: [{ branch: 'develop', hash: 'm' }, { branch: 'feat/b', hash: 'b1' }, { branch: 'feat/x', hash: 'x1' }],
  };
  const rows = [row('feat/b', { issue: 7 })];
  const e = treeEntries(tree, rows);
  assert.deepEqual(e.map((x) => x.hash), ['b1', 'm', 'a1', 'i']);
  assert.deepEqual(e[0].tips, ['feat/b']);
  assert.equal(e[0].row?.issue, 7);
  assert.deepEqual(e[1].tips, ['develop']);
  assert.equal(e[1].row, null);
  assert.deepEqual(e[3].parents, []);
  assert.equal(e[0].message, 'b one');
  assert.equal(treeSummary(e, 'develop'), 'develop 기준, 세션 브랜치 1개, 커밋 4개');
});
