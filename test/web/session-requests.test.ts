// #880: the dashboard's 세션 요청 card lists what sessions asked a person for — plans, permission prompts, questions,
// sessions waiting for a person — newest first, each with the session's provider and where a click goes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askUserQuestionItems, isQuestionTool, sessionRequests } from '../../web/src/activity/sessionRequests.ts';
import type { PermissionAsk } from '../../web/src/activity/approvals.ts';
import type { WaitingPlan } from '../../web/src/activity/plans.ts';

const plan = (o: Partial<WaitingPlan> = {}): WaitingPlan => ({ path: 'web/plan.dpx.json', title: '화면 정리', lead: 'Jae', since: 100, revision: 1, blockers: [], leadGone: false, ...o });
const ask = (o: Partial<PermissionAsk> = {}): PermissionAsk => ({ sessionId: 's2', session: 'Otto', requestId: 'r1', tool: 'Bash', since: 200, detail: 'npm test', description: null, ...o });
const session = (id: string, name: string, provider: string, o: Record<string, unknown> = {}) => ({ id, name, provider, pending: [], ...o });

test('every kind, newest first, with provider and target', () => {
  const sessions = [
    session('s1', 'Jae', 'claude', { state: 'waiting', stateSince: 50 }),
    session('s2', 'Otto', 'codex', { state: 'waiting', pending: [{ requestId: 'r1' }] }),
    session('s3', 'Cal', 'gemini', { state: 'waiting', stateSince: 400, attention: { level: 'warn', reason: '리뷰 결과를 기다려요', since: 400 } }),
    session('s4', 'Ivy', 'claude', { state: 'working' }),
  ];
  const list = sessionRequests([plan()], [ask(), ask({ requestId: 'r2', tool: 'AskUserQuestion', description: '어느 쪽으로 할까요?', since: 300 })], sessions);
  assert.deepEqual(
    list.map((r) => [r.kind, r.session, r.provider, r.text, r.at]),
    [
      ['waiting', 'Cal', 'gemini', '리뷰 결과를 기다려요', 400],
      ['question', 'Otto', 'codex', '어느 쪽으로 할까요?', 300],
      ['permission', 'Otto', 'codex', 'Bash 실행을 허용할까요?', 200],
      ['plan', 'Jae', 'claude', '‘화면 정리’ 계획을 승인해 주세요', 100],
    ],
  );
  // Jae waits on its own plan and Otto on its prompts: neither shows twice; a working session never shows.
  assert.deepEqual(list.find((r) => r.kind === 'plan')?.target, { plan: 'web/plan.dpx.json' });
  assert.deepEqual(list.find((r) => r.kind === 'permission')?.target, { session: 's2' });
});

test('nothing waiting: empty', () => {
  assert.deepEqual(sessionRequests([], [], []), []);
  assert.deepEqual(sessionRequests([], [], null), []);
});

test('scoped to a project: prompts of other sessions and plans of other folders are left out', () => {
  const list = sessionRequests([plan(), plan({ path: 'server/p.dpx.json', lead: null })], [ask({ sessionId: 'other' })], [session('s1', 'Jae', 'claude')], 'web');
  assert.deepEqual(list.map((r) => r.key), ['plan:web/plan.dpx.json']);
});

test('sessions unknown yet: prompts still show, without a provider mark', () => {
  const list = sessionRequests([plan({ lead: null })], [ask()], null);
  assert.deepEqual(list.map((r) => [r.kind, r.session, r.provider]), [['permission', 'Otto', null], ['plan', null, null]]);
});

// #1052: AskUserQuestion's prompt becomes the same tabbed questions as the "질문 N/M" text.
test('askUserQuestionItems: questions, options, multiSelect and header from the tool input', () => {
  const items = askUserQuestionItems({
    questions: [
      { question: '어느 쪽으로 할까요?', header: '방향', multiSelect: false, options: [{ label: 'A안 (추천)', description: '빠름' }, { label: 'B안' }] },
      { question: '켤 기능을 골라 주세요', multiSelect: true, options: [{ label: '자동 저장' }, { label: '버전 기록' }] },
      { question: '', options: [] },
    ],
  });
  assert.deepEqual(items, [
    { question: '어느 쪽으로 할까요?', header: '방향', multiSelect: false, options: [{ label: 'A안 (추천)', reason: '빠름', recommended: true }, { label: 'B안' }] },
    { question: '켤 기능을 골라 주세요', multiSelect: true, options: [{ label: '자동 저장' }, { label: '버전 기록' }] },
  ]);
  assert.equal(askUserQuestionItems({}), null);
  assert.equal(askUserQuestionItems(null), null);
  assert.equal(isQuestionTool('AskUserQuestion'), true);
  assert.equal(isQuestionTool('Bash'), false);
});
