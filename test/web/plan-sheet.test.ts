import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstParagraph, planSheet, SUMMARY_MAX } from '../../web/src/run/planSheetModel.ts';
import type { Plan } from '../../shared/dispatch/plan.ts';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('firstParagraph: skips headings and empty paragraphs, folds whitespace (#889)', () => {
  assert.equal(firstParagraph(doc({ type: 'heading', content: [{ type: 'text', text: '제목' }] }, { type: 'paragraph' }, p('  목록을  커밋 그래프로\n바꿔요. '))), '목록을 커밋 그래프로 바꿔요.');
  assert.equal(firstParagraph(doc({ type: 'heading', content: [{ type: 'text', text: '제목' }] })), null);
  assert.equal(firstParagraph(null), null);
  assert.equal(firstParagraph({ type: 'nope' }), null);
  const long = firstParagraph(doc(p('가'.repeat(400))))!;
  assert.equal(long.length, SUMMARY_MAX);
  assert.ok(long.endsWith('…'));
});

test('planSheet: one row per step with task line, role and model, defaults filling gaps', () => {
  const plan: Plan = {
    v: 1,
    block: 'b',
    defaults: { role: 'impl', model: 'claude-opus-5-5' },
    steps: [
      { id: 'a', node: 'a', task: '\n  레인 계산 함수를 만들어요\n둘째 줄' },
      { id: 'r', node: 'r', role: 'review', model: 'claude-sonnet-5-5' },
    ],
  };
  const s = planSheet(plan, doc(p('요약')), [], new Map([['a', '레인 계산']]));
  assert.equal(s.summary, '요약');
  assert.deepEqual(s.steps, [
    { id: 'a', n: 1, title: '레인 계산', task: '레인 계산 함수를 만들어요', role: '구현자', who: 'claude-opus-5-5' },
    { id: 'r', n: 2, title: 'r', task: null, role: '리뷰어', who: 'claude-sonnet-5-5' },
  ]);
});

test('planSheet: a running step names its agents and run title instead of the model', () => {
  const plan: Plan = { v: 1, block: 'b', steps: [{ id: 'a', node: 'a' }] };
  const s = planSheet(plan, null, [{ id: 'a', view: 'active', title: '커밋 그래프', agents: [{ name: 'Yuki', role: 'impl' }, { name: 'Gem', role: 'impl' }] }]);
  assert.deepEqual(s.steps[0], { id: 'a', n: 1, title: '커밋 그래프', task: null, role: null, who: 'Yuki, Gem' });
});
