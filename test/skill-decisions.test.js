// #1056: the doc, plan and questions skills keep decisions out of an end-of-document list and put answers into the body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = (name) => readFileSync(new URL(`../plugin/skills/${name}/SKILL.md`, import.meta.url), 'utf8');

test('atelier-doc: no 확인 필요 / 결정할 것 list; answers go into the body and decided items are deleted', () => {
  const s = skill('atelier-doc');
  assert.match(s, /Never write a "확인 필요", "결정할 것" or "열린 질문" section/);
  assert.match(s, /write it into the body/);
  assert.match(s, /delete each decided item, and the whole section once it is empty/);
});

test('atelier-questions: an answer is written into the document and its list item removed', () => {
  const s = skill('atelier-questions');
  assert.match(s, /Put the answer into the document in the same turn/);
  assert.match(s, /delete the item; delete the section once it is empty/);
  assert.match(s, /never also list it at the end of the document/);
});

test('atelier-plan: no question list; an answer revises the plan', () => {
  assert.match(skill('atelier-plan'), /No "확인 필요" or "결정할 것" list[^.]*call `write_plan` again/);
});
