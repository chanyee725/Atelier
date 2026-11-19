import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_QUESTION, answerQuestion, questionOf } from '../../web/src/dispatch/lib/question.ts';

test('no question in an answer that asks nothing', () => {
  assert.equal(questionOf(''), null);
  assert.equal(questionOf(null), null);
  assert.equal(questionOf('테스트를 고쳤어요.\n모두 통과해요.'), null);
});

test('a plain yes/no ask offers yes and no', () => {
  const q = questionOf('브랜치를 만들었어요.\n이대로 PR을 열까요?');
  assert.deepEqual(q, { summary: '이대로 PR을 열까요?', options: ['네, 진행해 주세요', '아니요, 멈춰 주세요'] });
});

test('an open question offers no options', () => {
  assert.deepEqual(questionOf('어떤 이름으로 할까요?')?.options, []);
});

test('a list after the question becomes the options, labels cut at the explanation', () => {
  const q = questionOf('**어느 쪽으로 갈까요?**\n1. A안 — 빠름\n2. B안: 안전함');
  assert.equal(q?.summary, '어느 쪽으로 갈까요?');
  assert.deepEqual(q?.options, ['A안', 'B안']);
});

test('a list right before the question is used too', () => {
  const q = questionOf('- 하나\n- 둘\n- 셋\n어느 걸로 할까요?');
  assert.deepEqual(q?.options, ['하나', '둘', '셋']);
});

test('options are capped at five and deduplicated', () => {
  const q = questionOf(['골라 주세요', ...['a', 'b', 'a', 'c', 'd', 'e', 'f'].map(x => `- ${x}`)].join('\n'));
  assert.deepEqual(q?.options, ['a', 'b', 'c', 'd', 'e']);
});

test('answerQuestion: the transcript first, then the server ask, never empty (#886)', () => {
  const long = `${'보고 '.repeat(300)}\n머지할까요?`;
  assert.equal(answerQuestion({ ask: null }, [{ kind: 'user', text: 'x' }, { kind: 'assistant', text: long }]).summary, '머지할까요?');
  // Transcript not loaded in this tab: the server's ask still shows the question.
  assert.equal(answerQuestion({ ask: 'PR을 열까요?' }, undefined).summary, 'PR을 열까요?');
  // This turn has no assistant text yet (only the user's message): the ask, not an older turn.
  assert.equal(answerQuestion({ ask: '어느 쪽으로 할까요?' }, [{ kind: 'assistant', text: '예전 질문일까요?' }, { kind: 'user', text: 'y' }]).summary, '어느 쪽으로 할까요?');
  // An ask the client reads differently is shown as it is.
  assert.equal(answerQuestion({ ask: '두 가지가 있어요:' }, []).summary, '두 가지가 있어요:');
  assert.deepEqual(answerQuestion({}, []), NO_QUESTION);
});
