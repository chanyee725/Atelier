import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchRows, isFindKey, prRows } from '../../web/src/home/dashboardRows.ts';
import type { BranchTip, PrAnswer } from '../../web/src/home/projectFeeds.ts';
import type { ApiIssue } from '../../web/src/home/issueBoard.ts';

const tip = (branch: string, extra: Partial<BranchTip> = {}): BranchTip => ({ branch, ahead: 1, behind: 0, lastAt: 1, state: 'open', base: false, ...extra });

test('branchRows drops the integration branch and puts live branches first, then the newest', () => {
  const tips = new Map([
    ['develop', tip('develop', { base: true })],
    ['old', tip('old', { lastAt: 10 })],
    ['new', tip('new', { lastAt: 30 })],
    ['live', tip('live', { lastAt: 5, active: true })],
  ]);
  assert.deepEqual(branchRows({ base: 'develop', tips }).map((t) => t.branch), ['live', 'new', 'old']);
  assert.deepEqual(branchRows(null), []);
  assert.deepEqual(branchRows('failed'), []);
});

test('branchRows leaves out branches an open issue claims', () => {
  const tips = new Map([
    ['develop', tip('develop', { base: true })],
    ['feat/1-a', tip('feat/1-a', { lastAt: 20 })],
    ['spike', tip('spike', { lastAt: 10 })],
  ]);
  assert.deepEqual(branchRows({ base: 'develop', tips }, new Set(['feat/1-a'])).map((t) => t.branch), ['spike']);
});

test('prRows lists each PR once, open first, with CI and review of its branch', () => {
  const issues: ApiIssue[] = [
    { number: 1, title: 'a', prs: [{ number: 10, state: 'merged', branch: 'x' }, { number: 12, state: 'open', branch: 'y' }] },
    { number: 2, title: 'b', prs: [{ number: 12, state: 'open', branch: 'y' }, { number: 11, state: 'closed' }, { number: 13, state: 'open', branch: 'z' }] },
  ];
  const prs = new Map<string, PrAnswer>([
    ['y', { ok: true, pr: { number: 12, state: 'open', ci: 'failure', review: 'required' } }],
    ['z', { ok: true, pr: { number: 99, state: 'open', ci: 'success' } }],
  ]);
  const rows = prRows(issues, prs);
  assert.deepEqual(rows.map((r) => r.number), [13, 12, 10, 11]);
  assert.equal(rows[1].ci, 'failure');
  assert.equal(rows[1].review, 'required');
  assert.equal(rows[1].issue, 1);
  // Another PR's answer on the same branch is not borrowed.
  assert.equal(rows[0].ci, undefined);
});

const key = (k: string, target: unknown = null, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target, ...mods }) as unknown as KeyboardEvent;
const el = (match: boolean, editable = false) => ({ closest: () => (match ? {} : null), isContentEditable: editable });

test('isFindKey takes a plain slash outside text fields only', () => {
  assert.equal(isFindKey(key('/', el(false))), true);
  assert.equal(isFindKey(key('/', null)), true);
  assert.equal(isFindKey(key('/', el(true))), false);
  assert.equal(isFindKey(key('/', el(false, true))), false);
  assert.equal(isFindKey(key('/', el(false), { ctrlKey: true })), false);
  assert.equal(isFindKey(key('/', el(false), { isComposing: true })), false);
  assert.equal(isFindKey(key('k', el(false))), false);
});
