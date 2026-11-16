import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampMotionMs, motionMs, createCoalescer, COALESCE_MS } from '../../web/src/lib/liveMotion.ts';

test('durations are clamped to 150–300 ms and zero under reduced motion', () => {
  assert.equal(clampMotionMs(10), 150);
  assert.equal(clampMotionMs(999), 300);
  assert.equal(clampMotionMs(220), 220);
  assert.equal(motionMs(220, true), 0);
  assert.equal(motionMs(220, false), 220);
});

function fakeClock() {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clear: (h: unknown) => { timers.delete(h as number); },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      t = end;
    },
  };
}

test('a burst is applied once, latest item per key wins', () => {
  const c = fakeClock();
  const got: number[][] = [];
  const q = createCoalescer<number>((b) => got.push(b), c);
  q.push('a', 1); c.advance(50); q.push('a', 2); q.push('b', 3);
  c.advance(COALESCE_MS - 1);
  assert.deepEqual(got, []);
  c.advance(1);
  assert.deepEqual(got, [[2, 3]]);
  assert.equal(q.pending, 0);
});

test('a steady stream still flushes within maxWait', () => {
  const c = fakeClock();
  const got: number[][] = [];
  const q = createCoalescer<number>((b) => got.push(b), { ...c, delay: 100, maxWait: 300 });
  for (let i = 0; i < 20; i++) { q.push('k' + i, i); c.advance(50); }
  assert.ok(got.length >= 2 && got.length <= 4);
});

test('cancel drops pending items', () => {
  const c = fakeClock();
  const got: number[][] = [];
  const q = createCoalescer<number>((b) => got.push(b), c);
  q.push('a', 1); q.cancel(); c.advance(1000);
  assert.deepEqual(got, []);
});
