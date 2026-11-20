import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_STAGE, activeIssues, activeStage, issueEta, issueTasks, taskStage } from '../../web/src/home/activeIssues.ts';
import { issueRows, type ApiIssue } from '../../web/src/home/issueBoard.ts';
import type { Session } from '../../shared/dispatch/types.ts';
import type { BoardTask } from '../../web/src/dispatch/types.ts';

const s = (id: string, branch: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, role: 'impl', roleName: '구현자', branch, status: 'running', parent: null, updatedAt: 1, ...extra }) as unknown as Session;
const task = (owner: string | null, stage: BoardTask['stage'], etaAt: number | null = null, title = 't'): BoardTask =>
  ({ id: `${owner}-${stage}-${title}`, lead: null, title, stage, owner, createdAt: 0, stageAt: 0, updatedAt: 0, etaAt, note: '' });

const lead = s('lead-1', null, { role: 'lead', roleName: '관리자' });
const ISSUES: ApiIssue[] = [
  { number: 700, title: 'untouched', prs: [] },
  { number: 701, title: 'old merged only', prs: [{ number: 10, state: 'merged', branch: 'feat/701-a' }] },
  { number: 702, title: 'being built', prs: [] },
  {
    number: 703,
    title: 'split in six',
    prs: [
      { number: 20, state: 'merged', branch: 'feat/703-a' },
      { number: 21, state: 'merged', branch: 'feat/703-b' },
      { number: 22, state: 'merged', branch: 'feat/703-c' },
      { number: 23, state: 'merged', branch: 'feat/703-d' },
      { number: 24, state: 'open', branch: 'feat/703-e' },
      { number: 25, state: 'open', branch: 'feat/703-f' },
      { number: 26, state: 'closed', branch: 'feat/703-g' },
    ],
  },
  { number: 704, title: 'approved, waiting', prs: [{ number: 30, state: 'open', branch: 'feat/704-a' }] },
];
const SESSIONS = [
  lead,
  s('impl-a', 'feat/702-x', { parent: 'lead-1' }),
  s('impl-b', 'feat/703-f', { parent: 'lead-1' }),
  s('impl-done', 'feat/701-a', { status: 'done' }),
];

test('only issues with an open session or an open PR are in progress', () => {
  const list = activeIssues(issueRows(ISSUES, SESSIONS), SESSIONS, []);
  assert.deepEqual(list.map((x) => x.number).sort(), [702, 703, 704]);
});

test('lead comes from a teammate parent; members are the open non-lead sessions', () => {
  const [a] = activeIssues(issueRows(ISSUES, SESSIONS), SESSIONS, []).filter((x) => x.number === 702);
  assert.deepEqual(a!.leads.map((x) => x.id), ['lead-1']);
  assert.deepEqual(a!.members.map((x) => x.id), ['impl-a']);
});

test('PR counts and progress: closed PRs left out, progress only for 2+ PRs', () => {
  const list = activeIssues(issueRows(ISSUES, SESSIONS), SESSIONS, []);
  const six = list.find((x) => x.number === 703)!;
  assert.equal(six.openPrs, 2);
  assert.equal(six.mergedPrs, 4);
  assert.deepEqual(six.progress, { merged: 4, total: 6 });
  assert.equal(list.find((x) => x.number === 704)!.progress, null);
});

test('stage: open PR is 리뷰, approved is 머지 대기, a working session without a PR is 구현', () => {
  const approved = (b: string) => b === 'feat/704-a';
  const list = activeIssues(issueRows(ISSUES, SESSIONS), SESSIONS, [], approved);
  const st = Object.fromEntries(list.map((x) => [x.number, x.stage]));
  assert.deepEqual(st, { 702: 'impl', 703: 'review', 704: 'merge' });
  // Sorted: earlier stages first.
  assert.deepEqual(list.map((x) => x.number), [702, 703, 704]);
});

test('stage: the least advanced moving piece wins; nothing moving and a merged PR is 머지됨', () => {
  const row = issueRows([{ number: 9, title: 'x', prs: [{ number: 1, state: 'merged', branch: 'feat/9-a' }] }], [lead])[0]!;
  assert.equal(activeStage(row, [], () => false), 'merged');
  assert.equal(activeStage(row, [task('lead-1', 'merge')], () => false), 'merge');
  assert.equal(activeStage(row, [task('lead-1', 'merge'), task('lead-1', 'test')], () => false), 'review');
  assert.equal(activeStage(row, [task('lead-1', 'done')], () => false), 'merged');
});

test('taskStage maps board stages; labels read 구현 / 리뷰 / 머지 대기 / 머지됨', () => {
  assert.deepEqual(['plan', 'impl', 'review', 'test', 'merge', 'done', 'blocked'].map((x) => taskStage(x as BoardTask['stage'])), ['impl', 'impl', 'review', 'review', 'merge', null, null]);
  assert.deepEqual(Object.values(ACTIVE_STAGE).map((x) => x.label), ['구현', '리뷰', '머지 대기', '머지됨']);
});

test('issueTasks: by owner id or name, or #<n> in the title (not #<n>0)', () => {
  const tasks = [task('impl-a', 'impl'), task('Juno', 'review'), task(null, 'merge', null, 'E1: #702 머지'), task(null, 'merge', null, '#7020 other')];
  const mine = issueTasks(702, [s('impl-a', null), s('x', null, { name: 'Juno' })], tasks);
  assert.equal(mine.length, 3);
});

test('ETA only when a task on the issue set one: the latest open one', () => {
  const now = 1_000_000;
  const tasks = [task('impl-a', 'impl', now + 40 * 60_000), task('impl-a', 'review', now + 10 * 60_000), task('impl-b', 'done', null)];
  const list = activeIssues(issueRows(ISSUES, SESSIONS), SESSIONS, tasks);
  assert.equal(list.find((x) => x.number === 702)!.etaAt, now + 40 * 60_000);
  assert.equal(list.find((x) => x.number === 703)!.etaAt, null);
  assert.equal(issueEta(null, now), null);
  assert.deepEqual(issueEta(now + 40 * 60_000, now), { text: '40분 남음', late: false });
  assert.equal(issueEta(now - 5 * 60_000, now)!.late, true);
});
