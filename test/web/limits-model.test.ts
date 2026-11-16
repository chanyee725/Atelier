import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_FIELDS, guardPatch, guardValue, wholeIn } from '../../web/src/settings/model.ts';

const settings = { guard: { enabled: true, five: 0.9, seven: 0.85 }, team: { ctxHandoff: 60 } };

test('guardValue shows percent, falls back to weekly for fable and to the default for unset team values', () => {
  assert.equal(guardValue('five', settings), 90);
  assert.equal(guardValue('seven', settings), 85);
  assert.equal(guardValue('fable', settings), 85);
  assert.equal(guardValue('fable', { ...settings, guard: { ...settings.guard, fable: 0.7 } }), 70);
  assert.equal(guardValue('ctxHandoff', settings), 60);
  assert.equal(guardValue('handoffMTokens', settings), 15);
});

test('guardPatch turns percents into fractions and never sends enabled', () => {
  assert.deepEqual(guardPatch({ five: 80, handoffMTokens: 20 }), { guard: { five: 0.8 }, team: { handoffMTokens: 20 } });
  assert.deepEqual(guardPatch({ fable: 100 }), { guard: { fable: 1 } });
});

test('wholeIn accepts only whole numbers in range; no field can reach 0 (guards stay on)', () => {
  assert.equal(wholeIn('85', 1, 100), 85);
  for (const bad of ['', ' ', '0', '101', '1.5', 'abc']) assert.equal(wholeIn(bad, 1, 100), null);
  for (const f of GUARD_FIELDS.flatMap((g) => g.fields)) {
    assert.ok(f.min >= 1 && f.def >= f.min && f.def <= f.max, f.id);
  }
});
