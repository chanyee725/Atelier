// #836: the dashboard's 승인 대기 card — which plans offer 시작하기 or 정리, open permission prompts as rows, the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalCount, permissionAsks, planAction } from '../../web/src/activity/approvals.ts';
import { parseWaiting } from '../../web/src/activity/plans.ts';
import { startBody } from '../../web/src/run/planStripModel.ts';
import type { Session } from '../../shared/dispatch/types.ts';

test('a plan offers 시작하기 when it can start, 정리 when its lead is gone, nothing when blocked otherwise', () => {
  const [ok, gone, blocked, old] = parseWaiting({
    plans: [
      { path: 'a.dpx.json', title: '가', lead: 'Jae', since: 1, revision: 4, blockers: [], leadGone: false },
      { path: 'b.dpx.json', title: '나', lead: null, since: 2, revision: 2, blockers: ['계획을 쓴 관리자 세션이 없어요', 3], leadGone: true },
      { path: 'c.dpx.json', title: '다', lead: 'Jae', since: 3, revision: 1, blockers: ['Codex가 연결되지 않았어요'], leadGone: false },
      { path: 'd.dpx.json', title: '라', lead: 'Jae', since: 4 },
    ],
  });
  assert.equal(planAction(ok), 'start');
  assert.deepEqual(startBody(ok.path, { revision: ok.revision! }), { path: 'a.dpx.json', revision: 4 });
  assert.equal(planAction(gone), 'dismiss');
  assert.deepEqual(gone.blockers, ['계획을 쓴 관리자 세션이 없어요']);
  assert.equal(planAction(blocked), null);
  // An older server sends no revision: no 시작하기 from the card.
  assert.equal(planAction(old), null);
});

test('permission prompts become rows (oldest first, no tool input) and count with the plans', () => {
  const s = (id: string, name: string, since: number, pending: Partial<Session['pending'][number]>[]) =>
    ({ id, name, stateSince: since, updatedAt: since, pending }) as unknown as Session;
  const asks = permissionAsks([
    s('s2', '구현자', 20, [{ requestId: 'r2', tool: 'Bash', input: { command: 'secret' } }]),
    s('s1', '리뷰어', 10, [{ requestId: 'r1', tool: '' }, { tool: 'Edit' }]),
    s('s3', '테스터', 5, []),
  ]);
  assert.deepEqual(asks, [
    { sessionId: 's1', session: '리뷰어', requestId: 'r1', tool: '도구', since: 10 },
    { sessionId: 's2', session: '구현자', requestId: 'r2', tool: 'Bash', since: 20 },
  ]);
  assert.equal(approvalCount([{}], asks), 3);
  assert.equal(approvalCount([], []), 0);
});
