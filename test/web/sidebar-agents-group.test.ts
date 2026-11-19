// E556 (#725): the sidebar's working-agents group remembers whether it is folded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS_OPEN_KEY, parseAgentsOpen, readAgentsOpen, writeAgentsOpen } from '../../web/src/activity/agentsGroupOpen.ts';

test('only an explicit 0 folds the group', () => {
  assert.equal(parseAgentsOpen(null), true);
  assert.equal(parseAgentsOpen('1'), true);
  assert.equal(parseAgentsOpen('junk'), true);
  assert.equal(parseAgentsOpen('0'), false);
});

test('the choice round-trips through localStorage', () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    assert.equal(readAgentsOpen(), true);
    writeAgentsOpen(false);
    assert.equal(store.get(AGENTS_OPEN_KEY), '0');
    assert.equal(readAgentsOpen(), false);
    writeAgentsOpen(true);
    assert.equal(store.has(AGENTS_OPEN_KEY), false);
    assert.equal(readAgentsOpen(), true);
  } finally {
    g.localStorage = prev;
  }
});

test('no storage: open, and writing does not throw', () => {
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = undefined;
  try {
    assert.equal(readAgentsOpen(), true);
    writeAgentsOpen(false);
  } finally {
    g.localStorage = prev;
  }
});
