import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUARD_FIELDS, changedValues, fableFollows, guardPatch, guardValue, wholeIn } from '../../web/src/settings/model.ts';

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
  assert.deepEqual(guardPatch({ fable: null }), { guard: { fable: null } });
  assert.deepEqual(guardPatch({}), {});
});

test('wholeIn accepts only whole numbers in range; no field can reach 0 (guards stay on)', () => {
  assert.equal(wholeIn('85', 1, 100), 85);
  for (const bad of ['', ' ', '0', '101', '1.5', 'abc']) assert.equal(wholeIn(bad, 1, 100), null);
  for (const f of GUARD_FIELDS.flatMap((g) => g.fields)) {
    assert.ok(f.min >= 1 && f.def >= f.min && f.def <= f.max, f.id);
  }
});

const shown = { five: 90, seven: 85, fable: 85, handoffMTokens: 15, ctxHandoff: 70 };

test('changedValues sends only changed fields and never pins a Fable value that follows weekly (#552)', () => {
  const following = { values: shown, fableFollows: true };
  assert.deepEqual(changedValues(following, shown, true), {});
  // 주간 85→70 while Fable follows: the field mirrors 70, but Fable is not sent, so the server keeps following.
  assert.deepEqual(changedValues(following, { ...shown, seven: 70, fable: 70 }, true), { seven: 70 });
  // The user typed a Fable value: it is pinned, even when it equals the value shown.
  assert.deepEqual(changedValues(following, shown, false), { fable: 85 });
  assert.deepEqual(changedValues(following, { ...shown, fable: 60 }, false), { fable: 60 });
});

test('changedValues clears an own Fable value when it should follow weekly again (모두 기본값으로)', () => {
  const pinned = { values: { ...shown, five: 80, fable: 60 }, fableFollows: false };
  assert.deepEqual(changedValues(pinned, shown, true), { five: 90, fable: null });
  assert.deepEqual(changedValues(pinned, pinned.values, false), {});
  assert.deepEqual(changedValues(pinned, { ...pinned.values, fable: 70 }, false), { fable: 70 });
  assert.equal(fableFollows({ guard: {} }), true);
  assert.equal(fableFollows({ guard: { fable: 0.6 } }), false);
});
