import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prOffText, shownRows, type BranchRow } from '../../web/src/dispatch/lib/liveBranches.ts';
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
