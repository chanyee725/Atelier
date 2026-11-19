// E579 (#786): plans waiting for 시작하기 in the 알림함 — the server's list, which ones toast, the words, and the
// request that makes the plan's own strip open its confirm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newlyWaiting, parseWaiting, planFolder, planTitle, planWaitingText } from '../../web/src/activity/plans.ts';
import { toastOf } from '../../web/src/activity/appEvents.ts';
import { requestPlanConfirm, takePlanConfirm } from '../../web/src/run/planConfirmRequest.ts';

test('parseWaiting keeps well-formed plans; newlyWaiting picks the ones not seen before', () => {
  const list = parseWaiting({ plans: [{ path: 'web/run/로그인.dpx.json', title: '로그인 개편', lead: 'Jae', since: 5 }, { title: 'x' }, null, { path: 'a.dpx.json', title: '', lead: 3 }] });
  assert.deepEqual(list, [
    { path: 'web/run/로그인.dpx.json', title: '로그인 개편', lead: 'Jae', since: 5 },
    { path: 'a.dpx.json', title: null, lead: null, since: null },
  ]);
  assert.deepEqual(parseWaiting(null), []);
  assert.deepEqual(newlyWaiting(new Set(['a.dpx.json']), list).map((p) => p.path), ['web/run/로그인.dpx.json']);
});

test('the item and its toast say who waits, which plan and where', () => {
  assert.equal(planWaitingText({ lead: 'Jae' }), 'Jae 팀 계획이 시작을 기다려요');
  assert.equal(planWaitingText({ lead: null }), '계획이 시작을 기다려요');
  assert.equal(planTitle({ path: 'web/run/로그인.dpx.json', title: null }), '로그인');
  assert.equal(planFolder('web/run/로그인.dpx.json'), 'web/run');
  assert.equal(planFolder('로그인.dpx.json'), '');
  const t = toastOf({ type: 'plan-waiting', file: 'web/run/로그인.dpx.json', text: 'Jae 팀 계획이 시작을 기다려요: 로그인 개편' });
  assert.equal(t?.category, 'runs');
  assert.deepEqual(t?.target, { file: 'web/run/로그인.dpx.json' });
});

test('a confirm request is taken once, by the same file only', () => {
  requestPlanConfirm('web/run/로그인.dpx.json');
  assert.equal(takePlanConfirm('web/run/다른.dpx.json'), false);
  assert.equal(takePlanConfirm('web/run/로그인'), true, 'with or without the extension');
  assert.equal(takePlanConfirm('web/run/로그인.dpx.json'), false, 'used up');
});
