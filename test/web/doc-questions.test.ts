import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorLabel, answeredLine, answerOf, questionLists, whoLabel } from '../../web/src/doc/questionsModel.ts';
import type { Discussion } from '../../shared/dispatch/discussions.ts';

const q = (over: Partial<Discussion> = {}): Discussion => ({ id: 'q', anchor: { kind: 'block', block: 'doc' }, question: '?', status: 'open', askedBy: 'impl', askedAt: 1, ...over });

test('open questions oldest first, answered newest first; a newer section shows none', () => {
  const items = [q({ id: 'b', askedAt: 5 }), q({ id: 'x', status: 'answered', answer: 'a', answeredBy: 'user', answeredAt: 3 }), q({ id: 'a', askedAt: 2 }), q({ id: 'y', status: 'answered', answer: 'a', answeredBy: 'user', answeredAt: 9 })];
  const l = questionLists({ v: 1, items });
  assert.deepEqual(l.open.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(l.answered.map((x) => x.id), ['y', 'x']);
  assert.deepEqual(questionLists({ v: 2, items }), { open: [], answered: [] });
  assert.deepEqual(questionLists(undefined), { open: [], answered: [] });
});

test('who answered: session name, 사용자 or 바깥 작성자 only', () => {
  assert.equal(whoLabel('user'), '사용자');
  assert.equal(whoLabel('outside'), '바깥 작성자');
  assert.equal(whoLabel(undefined), '바깥 작성자');
  assert.equal(whoLabel('구현자 1'), '구현자 1');
  assert.equal(answeredLine(q({ status: 'answered', answeredBy: 'user' })), '답변됨 · 사용자');
  assert.equal(answeredLine(q({ status: 'answered', answeredBy: 'reviewer' })), '답변됨 · reviewer');
});

test('anchor names', () => {
  assert.equal(anchorLabel({ kind: 'block', block: 'doc' }), '문서');
  assert.equal(anchorLabel({ kind: 'block', block: 'b1' }), '블록');
  assert.equal(anchorLabel({ kind: 'text', from: 1, to: 4 }), '본문 일부');
  assert.equal(anchorLabel({ kind: 'node', block: 'b1', node: 'API' }), '다이어그램 노드 API');
});

test('the answer: a valid choice wins, else trimmed text, else nothing', () => {
  const c = q({ choices: ['왼쪽', '오른쪽'] });
  assert.deepEqual(answerOf(c, 1, 'typed'), { choice: 1 });
  assert.deepEqual(answerOf(c, 5, ' typed '), { text: 'typed' });
  assert.deepEqual(answerOf(q(), 0, 'typed'), { text: 'typed' });
  assert.equal(answerOf(c, null, '   '), null);
  assert.equal(answerOf(c, null, 'x'.repeat(4001)), null);
});
