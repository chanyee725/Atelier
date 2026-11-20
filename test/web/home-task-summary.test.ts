import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardTaskOf, branchText, issueTitles, summaryKind, summaryLine, taskSummary, type SummarySession } from '../../web/src/home/taskSummary.ts';
import type { BoardTask } from '../../web/src/dispatch/types.ts';

const s = (over: Partial<SummarySession> = {}): SummarySession =>
  ({ id: 'id-1', name: 'Otto', role: 'impl', branch: 'dispatch/impl-1', parent: 'lead-1', ...over });
const task = (over: Partial<BoardTask>): BoardTask =>
  ({ id: 't', lead: null, title: 'task', stage: 'impl', owner: null, createdAt: 0, stageAt: 0, updatedAt: 0, etaAt: null, note: '', ...over });
const titles = issueTitles([{ number: 905, title: '작업 보기' }, { number: 886, title: '질문이 안 보이는 사람 기다림' }]);
const none = () => null;

test('issue number with a known title wins over every other source', () => {
  const x = taskSummary(s({ issue: 905, task: '직접 쓴 요약' }), titles, [task({ owner: 'Otto', title: '보드 작업' })]);
  assert.deepEqual(x, { kind: null, text: '#905 작업 보기', from: 'issue' });
});

test('an issue named only by the branch gets its title and the branch type', () => {
  const x = taskSummary(s({ branch: 'fix/886-hidden-question' }), titles, []);
  assert.deepEqual(x, { kind: 'fix', text: '#886 질문이 안 보이는 사람 기다림', from: 'issue' });
  assert.equal(summaryLine(x!), 'fix — #886 질문이 안 보이는 사람 기다림');
});

test('board: own open task, else the lead\'s newest open task; done and blocked tasks are skipped', () => {
  const tasks = [
    task({ id: 'a', owner: 'Otto', title: 'done one', stage: 'done', updatedAt: 9 }),
    task({ id: 'b', lead: 'lead-1', title: 'lead old', updatedAt: 1 }),
    task({ id: 'c', lead: 'lead-1', title: 'lead new', updatedAt: 5 }),
    task({ id: 'd', lead: 'lead-1', title: 'lead blocked', stage: 'blocked', updatedAt: 8 }),
  ];
  assert.equal(boardTaskOf(s(), tasks)?.title, 'lead new');
  const mine = [...tasks, task({ id: 'e', owner: 'id-1', title: 'mine', updatedAt: 0 })];
  assert.deepEqual(taskSummary(s(), none, mine), { kind: null, text: 'mine', from: 'board' });
  // A lead reads its own tasks.
  assert.equal(boardTaskOf(s({ id: 'lead-1', role: 'lead', parent: null }), tasks)?.title, 'lead new');
});

test('branch inference: type, number and words; Dispatch worktree branches say nothing', () => {
  assert.equal(branchText('fix/886-hidden-question'), '#886 hidden question');
  assert.equal(branchText('feat/page-header-unify'), 'page header unify');
  assert.equal(branchText('dispatch/impl-1191'), null);
  assert.equal(branchText('develop'), null);
  assert.equal(branchText(null), null);
  assert.deepEqual(taskSummary(s({ branch: 'chore/908-pr907-nits' }), none, []), { kind: 'chore', text: '#908 pr907 nits', from: 'branch' });
});

test('the lead\'s own summary shows when nothing else says; one line, at most 80 characters', () => {
  const x = taskSummary(s({ task: '  로그인\n버튼   정리 ' }), none, []);
  assert.deepEqual(x, { kind: null, text: '로그인 버튼 정리', from: 'task' });
  assert.equal(taskSummary(s({ task: 'x'.repeat(200) }), none, [])!.text.length, 80);
});

test('an issue without a known title still names the issue; nothing at all gives null', () => {
  assert.deepEqual(taskSummary(s({ issue: 42 }), none, []), { kind: null, text: '#42', from: 'issue' });
  assert.equal(taskSummary(s(), none, []), null);
});

test('type: branch prefix, else review for a reviewer', () => {
  assert.equal(summaryKind({ branch: 'docs/x', role: 'impl' }), 'docs');
  assert.equal(summaryKind({ branch: 'dispatch/review-3', role: 'review' }), 'review');
  assert.equal(summaryKind({ branch: null, role: 'impl' }), null);
});
