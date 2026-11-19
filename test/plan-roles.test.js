// write_plan step roles: aliases map to role ids, unknown roles are refused with the valid list (#788).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanRoles } from '../server/pipeline/plan-roles.js';

const IDS = ['lead', 'impl', 'review', 'test', 'design', 'docs'];

test('aliases and case map to role ids; known roles stay as given', () => {
  const steps = [
    { id: 'a', title: 'A', role: 'implementer' },
    { id: 'b', title: 'B', role: 'Reviewer' },
    { id: 'c', title: 'C', role: 'tester' },
    { id: 'd', title: 'D', role: 'designer' },
    { id: 'e', title: 'E', role: 'impl' },
  ];
  const r = resolvePlanRoles(steps, IDS);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.steps.map((s) => s.role), ['impl', 'review', 'test', 'design', 'impl']);
  assert.equal(r.steps[4], steps[4]);
  assert.equal(steps[0].role, 'implementer', 'input is not mutated');
});

test('an unknown role is refused with the step and the valid list', () => {
  const r = resolvePlanRoles([{ title: 'A', role: 'impl' }, { title: 'B', role: 'qa-bot' }], IDS);
  assert.equal(r.steps, undefined);
  assert.match(r.error, /단계 s2의 역할 "qa-bot"을 몰라요/);
  assert.match(r.error, /impl, review, test, design, docs/);
});

test('an alias whose target the team lacks is refused', () => {
  assert.match(resolvePlanRoles([{ id: 'x', role: 'designer' }], ['impl', 'review']).error, /쓸 수 있는 역할: impl, review/);
});

test('missing roles and non-arrays are left for the plan validation', () => {
  const steps = [{ id: 'a', title: 'A' }, null];
  assert.deepEqual(resolvePlanRoles(steps, IDS).steps, steps);
  assert.equal(resolvePlanRoles('nope', IDS).steps, 'nope');
});
