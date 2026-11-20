import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_TAB_KEY, activeDocs, areaOf, readActiveTab, saveActiveTab, stepProgress } from '../../web/src/home/activeDocs.ts';
import type { AgentPresence } from '../../web/src/home/agents.ts';

const agent = (sid: string, file: string | undefined, extra: Record<string, unknown> = {}) =>
  ({ sid, name: sid, role: 'docs', model: null, status: 'running', file, ...extra }) as unknown as AgentPresence;
const doc = (path: string, modifiedAt: number, plan?: string) => ({ path, title: `T ${path}`, modifiedAt, plan });

test('areaOf drops the project folder and the file', () => {
  assert.equal(areaOf('/p/Web/채팅/a.dpx.json', '/p'), 'Web / 채팅');
  assert.equal(areaOf('/p/a.dpx.json', '/p'), '');
});

test('presence files and running plans merge into one row per file, newest first', () => {
  const docs = [doc('/p/a', 10), doc('/p/plan', 30, 'running'), doc('/p/idle-plan', 99, 'done'), doc('/p/b', 20)];
  const agents = [agent('s1', '/p/a', { statusLabel: '글 작성 중…' }), agent('s2', '/p/plan', { step: '구현' }), agent('s3', '/p/plan'), agent('s4', undefined)];
  const list = activeDocs(agents, docs, new Map([['/p/plan', { done: 2, total: 5 }]]), '/p');
  assert.deepEqual(list.map((x) => x.path), ['/p/plan', '/p/a']);
  assert.equal(list[0].source, 'plan');
  assert.deepEqual(list[0].progress, { done: 2, total: 5 });
  assert.equal(list[0].agents.length, 2);
  assert.equal(list[0].doing, '구현');
  assert.equal(list[1].source, 'writing');
  assert.equal(list[1].doing, '글 작성 중…');
  assert.equal(list[1].progress, null);
});

test('a running plan with no writer still shows; outside writers count and unknown files fall back to the file name', () => {
  const list = activeDocs([agent('outside:x', '/p/gone.dpx.json', { outside: true }), agent('s1', '/p/gone.dpx.json')], [doc('/p/r', 5, 'running')], new Map(), '/p');
  assert.deepEqual(list.map((x) => [x.path, x.title, x.agents.length]), [['/p/r', 'T /p/r', 0], ['/p/gone.dpx.json', 'gone', 2]]);
});

test('nothing writing and no running plan is an empty list', () => {
  assert.deepEqual(activeDocs([], [doc('/p/a', 1, 'plan'), doc('/p/b', 2)]), []);
});

test('stepProgress counts done steps', () => {
  assert.deepEqual(stepProgress({ a: { state: 'done' }, b: { state: 'running' }, c: { state: 'pending' } }), { done: 1, total: 3 });
  assert.equal(stepProgress({}), null);
});

test('the tab is remembered and storage failures never throw', () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(readActiveTab(store), 'issues');
  saveActiveTab('docs', store);
  assert.equal(m.get(ACTIVE_TAB_KEY), 'docs');
  assert.equal(readActiveTab(store), 'docs');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readActiveTab(broken), 'issues');
  assert.doesNotThrow(() => saveActiveTab('docs', broken));
});
