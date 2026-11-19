// #836: the dashboard's 승인 대기 card — which plans offer 시작하기 or 정리, open permission prompts as rows, the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalCount, askDetail, permissionAsks, planAction, shortDetail, withSession } from '../../web/src/activity/approvals.ts';
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

test('permission prompts become rows (oldest first, with what runs) and count with the plans', () => {
  const s = (id: string, name: string, since: number, pending: Partial<Session['pending'][number]>[]) =>
    ({ id, name, stateSince: since, updatedAt: since, pending }) as unknown as Session;
  const asks = permissionAsks([
    s('s2', '구현자', 20, [{ requestId: 'r2', tool: 'Bash', input: { command: 'rm -rf build', description: '빌드 지우기' }, description: '' }]),
    s('s1', '리뷰어', 10, [{ requestId: 'r1', tool: '' }, { tool: 'Edit' }]),
    s('s3', '테스터', 5, []),
  ]);
  assert.deepEqual(asks, [
    { sessionId: 's1', session: '리뷰어', requestId: 'r1', tool: '도구', since: 10, detail: null, description: null },
    { sessionId: 's2', session: '구현자', requestId: 'r2', tool: 'Bash', since: 20, detail: 'rm -rf build', description: null },
  ]);
  assert.equal(approvalCount([{}], asks), 3);
  assert.equal(approvalCount([], []), 0);
});

test('a permission row shows the command to run, short on one line and whole on request', () => {
  assert.equal(askDetail({ command: '  git push origin feat/x ', description: '푸시' }), 'git push origin feat/x');
  assert.equal(askDetail({ file_path: 'web/src/a.ts' }), 'web/src/a.ts');
  assert.equal(askDetail({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }), JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }, null, 2));
  assert.equal(askDetail({}), null);
  assert.equal(askDetail(undefined), null);
  const long = `echo ${'a'.repeat(300)}\nnext`;
  const short = shortDetail(long);
  assert.equal(short.length, 120);
  assert.ok(short.endsWith('…') && !short.includes('\n'));
  assert.equal(shortDetail('ls -la'), 'ls -la');
  const [ask] = permissionAsks([{ id: 's', name: '구현자', stateSince: 1, pending: [{ requestId: 'r', tool: 'Bash', input: { command: long }, description: '긴 명령', suggestions: [] }] } as unknown as Session]);
  assert.equal(ask.detail, long.trim());
  assert.equal(ask.description, '긴 명령');
});

test('a session event replaces only that session\'s prompts; a removed session drops them', () => {
  const sess = (id: string, since: number, ids: string[]) =>
    ({ id, name: id, stateSince: since, pending: ids.map((r) => ({ requestId: r, tool: 'Bash', input: { command: r }, description: '', suggestions: [] })) }) as unknown as Session;
  const start = permissionAsks([sess('a', 1, ['a1']), sess('b', 2, ['b1'])]);
  // The same pending again: the same array, no re-render.
  assert.equal(withSession(start, sess('a', 1, ['a1'])), start);
  const more = withSession(start, sess('b', 2, ['b1', 'b2']));
  assert.deepEqual(more.map((x) => x.requestId), ['a1', 'b1', 'b2']);
  const answered = withSession(more, sess('a', 1, []));
  assert.deepEqual(answered.map((x) => x.requestId), ['b1', 'b2']);
  assert.deepEqual(withSession(answered, { id: 'b' }, true), []);
});
