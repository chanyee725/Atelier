// #1057: the document's 관리자와 대화 — the dock's partner, the first message and the button's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docAskText, docButtonLabel, docLeadLine, withDocPath } from '../../web/src/chat/lib/askDoc.ts';
import { mainTarget } from '../../web/src/chat/lib/chatDock.ts';
import type { Session } from '../../shared/dispatch/types.ts';

const ses = (id: string, status: Session['status'], name = id) => ({ id, status, name, startedAt: 0 }) as Session;

test('mainTarget: a live document lead is the partner; an ended one hands back to the helper', () => {
  const list = [ses('lead', 'running', 'Jae'), ses('h', 'idle')];
  assert.deepEqual(mainTarget(list, 'h', 'lead'), { key: 'partner', id: 'lead', label: 'Jae' });
  assert.deepEqual(mainTarget([ses('lead', 'done'), ses('h', 'idle')], 'h', 'lead'), { key: 'helper', id: 'h', label: '도우미' });
  assert.equal(mainTarget([], null, 'gone').key, 'helper');
  assert.equal(mainTarget(list, 'h').key, 'helper');
});

test('docAskText: the lead goes through questions and drops decided items; the helper proposes a lead', () => {
  const lead = docAskText('App/spec.dpx.json', true);
  assert.match(lead, /^App\/spec\.dpx\.json 문서/);
  assert.match(lead, /본문에 반영하고 정해진 항목은 지워/);
  const helper = docAskText('App/spec.dpx.json', false);
  assert.match(helper, /배정된 관리자가 없어요/);
  assert.match(helper, /관리자를 제안/);
});

test('withDocPath keeps the path in the talk without repeating it', () => {
  assert.equal(withDocPath('이거 어때?', 'A/b.dpx.json'), '[문서: A/b.dpx.json]\n이거 어때?');
  assert.equal(withDocPath('A/b.dpx.json 고쳐 줘', 'A/b.dpx.json'), 'A/b.dpx.json 고쳐 줘');
  assert.equal(withDocPath('', 'A/b.dpx.json'), '');
});

test('the button name starts with its visible text; the card names who answers', () => {
  assert.equal(docButtonLabel(0), '관리자와 대화');
  assert.equal(docButtonLabel(3), '관리자와 대화, 열린 질문 3개');
  assert.equal(docLeadLine({ id: 'x', name: 'Jae' }), 'Jae 관리자와 대화해요');
  assert.equal(docLeadLine(null), '배정된 관리자가 없어서 도우미가 받아요');
});
