import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planApproval } from '../../web/src/run/planApprovalModel.ts';

const base = { state: 'plan' as const, revision: 4, approvedRevision: null, approvedAt: null, lastApprovedRevision: null, blockers: [] };

test('nothing to show before the status is read or for a file that is no plan', () => {
  assert.equal(planApproval(null), null);
  assert.equal(planApproval({ ...base, state: null }), null);
});

test('a first plan waits for its one 시작하기, for the current revision', () => {
  const a = planApproval(base)!;
  assert.equal(a.kind, 'waiting');
  assert.equal(a.label, '승인 대기');
  assert.equal(a.revision, 4);
  assert.equal(a.canStart, true);
  assert.deepEqual(a.blockers, []);
  // An older server without lastApprovedRevision reads the same.
  const { lastApprovedRevision: _, ...old } = base;
  assert.equal(planApproval(old)!.kind, 'waiting');
});

test('blockers carry through, 시작하기 still offered so the confirm explains them', () => {
  const a = planApproval({ ...base, blockers: ['관리자 세션이 없어요'] })!;
  assert.equal(a.canStart, true);
  assert.deepEqual(a.blockers, ['관리자 세션이 없어요']);
});

test('a plan started before and revised waits as 개정 대기 for rev N', () => {
  const a = planApproval({ ...base, revision: 7, lastApprovedRevision: 3 })!;
  assert.equal(a.kind, 'revised');
  assert.equal(a.label, '개정 대기');
  assert.equal(a.revision, 7);
  assert.equal(a.previous, 3);
  assert.match(a.text, /rev 3 실행 뒤/);
  assert.equal(a.canStart, true);
});

test('running, paused and done plans read 승인됨 with the approved revision and no 시작하기', () => {
  for (const state of ['running', 'paused', 'done'] as const) {
    const a = planApproval({ ...base, state, revision: 9, approvedRevision: 7, approvedAt: 1000, lastApprovedRevision: 7 })!;
    assert.equal(a.kind, 'approved', state);
    assert.equal(a.label, '승인됨');
    assert.equal(a.revision, 7);
    assert.equal(a.at, 1000);
    assert.equal(a.canStart, false);
  }
  assert.match(planApproval({ ...base, state: 'running', approvedRevision: 2 })!.text, /실행 중/);
});

test('an unreadable status shows, blocked', () => {
  const a = planApproval(null, true)!;
  assert.equal(a.kind, 'unknown');
  assert.equal(a.blockers.length, 1);
});
