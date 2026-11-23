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

// #1061: usage rules the user set, kept in the skills and team rules.
test('atelier-doc: Atelier only, the project server URL first, 기획 folder, no suggestion wording', () => {
  const s = skill('atelier-doc');
  assert.match(s, /Write them only in Atelier through the workspace API, so they show live; never as local files/);
  assert.match(s, /tell the user that server's URL before the first write/);
  assert.match(s, /A plan document goes in `기획\/<feature>\/`/);
  assert.match(s, /No "\(제안\)", "추천", "확인 필요" or "결정할 것", and no sentence that asks the user something/);
});

test('atelier-session: perm left to the auto default; handoff to a lead names URL and guides', () => {
  const s = skill('atelier-session');
  assert.match(s, /Leave out `perm`: the role default is `auto`/);
  assert.match(s, /the main session writes no documents, diagrams or analysis for it/);
  assert.match(s, /`docs\/workspace-api\.md` and `docs\/agent-diagrams\.md`/);
});

test('team rules: a lead settles should-fixes, nits and follow-ups and reports the outcome', () => {
  const rules = readFileSync(new URL('../plugin/skills/atelier-team/reference/rules.md', import.meta.url), 'utf8');
  assert.match(rules, /A lead settles review should-fixes, nits and whether a follow-up issue is needed on its own, and reports only the outcome/);
});
