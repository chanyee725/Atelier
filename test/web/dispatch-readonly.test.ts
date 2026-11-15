import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRun, READ_ONLY_NOTICE } from '../../web/src/dispatch/lib/runnable.ts';

test('only Claude sessions can run; old openai/gemini sessions are read-only', () => {
  assert.equal(canRun({ provider: 'claude' }), true);
  assert.equal(canRun({ provider: 'openai' }), false);
  assert.equal(canRun({ provider: 'gemini' }), false);
});

test('the read-only notice is short 해요체', () => {
  assert.match(READ_ONLY_NOTICE, /요\.( |$)/);
  assert.ok(READ_ONLY_NOTICE.length < 60);
});
