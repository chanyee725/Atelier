import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerByName, usageByProvider } from '../../web/src/home/usageRows.ts';
import type { UsageDay } from '../../shared/dispatch/types.ts';

const u = (input: number, output: number, cost: number, cacheRead = 0) => ({ input, output, cacheRead, cacheWrite: 0, cost });
const day = (d: string, models: UsageDay['models']): UsageDay => ({ day: d, cost: 0, models, roles: {} });

test('providerByName: by the model id when the list lacks it', () => {
  assert.equal(providerByName('claude-opus-5-5'), 'claude');
  assert.equal(providerByName('gpt-5.4-codex'), 'openai');
  assert.equal(providerByName('gemini-3.8-flash-high'), 'gemini');
  assert.equal(providerByName('mystery'), 'other');
});

test('usageByProvider sums the last 7 days per model and groups Claude, Codex, Gemini in order', () => {
  const days = [
    day('d0', { 'claude-opus-5-5': u(1000, 1000, 50) }), // 8 days back: left out
    ...Array.from({ length: 6 }, (_, i) => day(`d${i + 1}`, {})),
    day('d7', {
      'gemini-3.8-flash-high': u(100, 20, 0, 30),
      'claude-sonnet-5-5': u(10, 5, 0.5),
      'claude-opus-5-5': u(10, 5, 2),
      'gpt-fake-codex': u(40, 10, 0),
      'claude-haiku-5-5': u(0, 0, 0),
    }),
  ];
  const known = [{ id: 'gpt-fake-codex', label: 'GPT Fake Codex', provider: 'openai' }, { id: 'claude-opus-5-5', label: 'Opus 5.5', provider: 'claude' }];
  const rows = usageByProvider(days, known);
  assert.deepEqual(rows.map((r) => r.provider), ['claude', 'openai', 'gemini']);
  assert.deepEqual(rows[0].models.map((m) => m.label), ['Opus 5.5', 'claude-sonnet-5-5']);
  assert.equal(rows[0].cost, 2.5);
  assert.equal(rows[0].tokens, 30);
  assert.equal(rows[1].models[0].label, 'GPT Fake Codex');
  assert.deepEqual(rows[2].models[0], { id: 'gemini-3.8-flash-high', label: 'gemini-3.8-flash-high', input: 130, output: 20, tokens: 150, cost: 0 });
});

test('usageByProvider: no days, no rows', () => {
  assert.deepEqual(usageByProvider([]), []);
});
