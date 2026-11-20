import test from 'node:test';
import assert from 'node:assert/strict';
import { clampShare, defaultShare, shareAfterKey, loadShare, saveShare, STORAGE_KEY } from '../../web/src/splitRatio.ts';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test('clampShare keeps 30 to 70 percent', () => {
  assert.equal(clampShare(0.1), 0.3);
  assert.equal(clampShare(0.9), 0.7);
  assert.equal(clampShare(0.5), 0.5);
  assert.equal(clampShare(NaN), 0.55);
});

test('default share: 55, plan a bit wider', () => {
  assert.equal(defaultShare(false), 0.55);
  assert.ok(defaultShare(true) > 0.55 && defaultShare(true) <= 0.7);
});

test('arrow keys move the share, clamped', () => {
  assert.ok(Math.abs(shareAfterKey(0.5, 'ArrowRight', false)! - 0.52) < 1e-9);
  assert.ok(Math.abs(shareAfterKey(0.5, 'ArrowLeft', true)! - 0.4) < 1e-9);
  assert.equal(shareAfterKey(0.69, 'ArrowRight', true), 0.7);
  assert.equal(shareAfterKey(0.5, 'Home', false), 0.3);
  assert.equal(shareAfterKey(0.5, 'End', false), 0.7);
  assert.equal(shareAfterKey(0.5, 'a', false), null);
});

test('save and load round-trip, clamped; bad values and broken storage give null', () => {
  const s = mem();
  assert.equal(loadShare(s), null);
  saveShare(0.62, s);
  assert.equal(loadShare(s), 0.62);
  s.m.set(STORAGE_KEY, '0.95');
  assert.equal(loadShare(s), 0.7);
  s.m.set(STORAGE_KEY, 'x');
  assert.equal(loadShare(s), null);
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadShare(bad), null);
  assert.doesNotThrow(() => saveShare(0.5, bad));
  assert.equal(loadShare(null), null);
});
