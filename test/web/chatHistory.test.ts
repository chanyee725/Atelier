import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, rowTitle, sortChats, type ChatSummary } from '../../web/src/shell/chatHistory.ts';

const NOW = Date.UTC(2026, 10, 20, 12);
const c = (id: string, updatedAt: number, title = 't'): ChatSummary => ({ id, title, createdAt: updatedAt, updatedAt, sessionId: 's' + id, count: 2 });

test('ago words', () => {
  assert.equal(ago(NOW - 5_000, NOW), '방금');
  assert.equal(ago(NOW - 5 * 60_000, NOW), '5분 전');
  assert.equal(ago(NOW - 3 * 3_600_000, NOW), '3시간 전');
  assert.equal(ago(NOW - 30 * 3_600_000, NOW), '어제');
  assert.equal(ago(NOW - 4 * 86_400_000, NOW), '4일 전');
  assert.match(ago(NOW - 20 * 86_400_000, NOW), /월 \d+일$/);
});
test('rowTitle is one line and never empty', () => {
  assert.equal(rowTitle({ title: ' 첫\n질문  ' }), '첫 질문');
  assert.equal(rowTitle({ title: '  ' }), '새 대화');
});
test('sortChats newest first without touching the input', () => {
  const a = [c('a', 1), c('b', 3), c('c', 2)];
  assert.deepEqual(sortChats(a).map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(a[0]!.id, 'a');
});
