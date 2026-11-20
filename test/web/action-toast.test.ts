// #899: only the results of what the person just did become Sonner toasts; agent and workspace events stay in the 알림함.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionToastOf } from '../../web/src/activity/appEvents.ts';

test('file actions become toasts with a stable id and a success or error tone', () => {
  assert.deepEqual(actionToastOf({ type: 'saved', path: 'a/설계.dpx.json' }), { id: 'saved:a/설계.dpx.json', category: 'files', tone: 'success', text: '저장했어요' });
  assert.deepEqual(actionToastOf({ type: 'save-failed', path: 'a.dpx.json' }), { id: 'save-failed:a.dpx.json', category: 'files', tone: 'error', text: '저장하지 못했어요' });
  assert.equal(actionToastOf({ type: 'created', kind: 'doc', path: 'a/설계.dpx.json' })?.tone, 'success');
  assert.equal(actionToastOf({ type: 'deleted', kind: 'folder', path: 'a/' })?.tone, 'success');
  assert.equal(actionToastOf({ type: 'moved', kind: 'doc', from: 'a/x.dpx.json', to: 'b/x.dpx.json' })?.category, 'files');
  assert.equal(actionToastOf({ type: 'renamed', kind: 'doc', from: 'a/x.dpx.json', to: 'a/y.dpx.json' })?.category, 'files');
});

test('agent, run and workspace events never become toasts', () => {
  assert.equal(actionToastOf({ type: 'session-started', id: 's1', name: 'Jae', team: false }), null);
  assert.equal(actionToastOf({ type: 'session-asks', id: 's1', name: 'Jae', ask: '어느 쪽으로 할까요?' }), null);
  assert.equal(actionToastOf({ type: 'session-error', id: 's1', name: 'Jae' }), null);
  assert.equal(actionToastOf({ type: 'run-ended', file: 'p.dpx.json', runId: 'r1', failed: true }), null);
  assert.equal(actionToastOf({ type: 'plan-waiting', file: 'p.dpx.json', text: '계획이 기다려요' }), null);
  assert.equal(actionToastOf({ type: 'model-connected', provider: 'claude', name: 'Claude' }), null);
  assert.equal(actionToastOf({ type: 'settings-saved' }), null);
});
