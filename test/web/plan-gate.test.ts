import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPlanGate, gateFor, getPlanGate, setPlanGate, type PlanGate } from '../../web/src/run/planGate.ts';

const gate = (over: Partial<PlanGate> = {}): PlanGate => ({ path: 'Web/계획.dpx.json', block: 'plan', blockers: [], busy: false, error: null, ...over });

test('only the plan diagram of the same file gets the 시작하기 button (#972)', () => {
  const g = gate();
  assert.equal(gateFor(g, 'Web/계획.dpx.json', 'plan'), g);
  // `a.dpx` and `a.dpx.json` are the same file.
  assert.equal(gateFor(g, 'Web/계획.dpx', 'plan'), g);
  assert.equal(gateFor(g, 'Web/계획.dpx.json', 'other'), null);
  assert.equal(gateFor(g, 'Web/다른.dpx.json', 'plan'), null);
  assert.equal(gateFor(null, 'Web/계획.dpx.json', 'plan'), null);
});

test("clearing a gate only removes the same file's own", () => {
  setPlanGate(gate({ path: 'B/계획.dpx.json' }));
  clearPlanGate('Web/계획.dpx.json');
  assert.equal(getPlanGate()?.path, 'B/계획.dpx.json');
  clearPlanGate('B/계획.dpx.json');
  assert.equal(getPlanGate(), null);
});
