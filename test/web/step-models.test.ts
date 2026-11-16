import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchStepModel, SAVE_FIRST_MODEL, setModelOp, stepModelRows } from '../../web/src/run/stepModels.ts';

const m = (id: string, provider: string, efforts: string[] = []) => ({ id, provider, label: id.toUpperCase(), efforts, defaultEffort: null, contextWindow: 1 });
const cat = {
  models: [m('opus', 'claude', ['low', 'high']), m('gpt-5', 'openai', ['low']), m('gem', 'gemini')],
  roles: [{ id: 'impl', name: '구현자', model: 'opus', perm: 'acceptEdits', prompt: '' }, { id: 'review', name: '리뷰어', model: 'opus', perm: 'plan', prompt: '' }],
  perms: ['manual', 'acceptEdits', 'auto', 'plan'],
  providers: {} as never,
};
const plan = { v: 1, block: 'b', steps: [{ id: 'a', node: 'a', role: 'impl', effort: 'high' }, { id: 'r', node: 'r', role: 'review', model: 'gpt-5' }] };

test('rows: own model or role default', () => {
  assert.deepEqual(stepModelRows(plan, cat), [
    { id: 'a', role: 'impl', roleName: '구현자', model: '', effective: 'opus' },
    { id: 'r', role: 'review', roleName: '리뷰어', model: 'gpt-5', effective: 'gpt-5' },
  ]);
  const withDefaults = { ...plan, defaults: { model: 'gem' } };
  assert.equal(stepModelRows(withDefaults, cat)[0].model, 'gem');
});

test('set op: model only when effort and mode still fit', () => {
  assert.deepEqual(setModelOp(plan, 'r', 'opus', cat), { op: 'set', id: 'r', step: { model: 'opus' } });
  assert.deepEqual(setModelOp(plan, 'r', '', cat), { op: 'set', id: 'r', step: { model: null } });
});

test('set op: drops an effort the model lacks and fits the mode to the provider', () => {
  assert.deepEqual(setModelOp(plan, 'a', 'gpt-5', cat), { op: 'set', id: 'a', step: { model: 'gpt-5', effort: null, perm: 'auto' } });
  assert.deepEqual(setModelOp(plan, 'a', 'gem', cat), { op: 'set', id: 'a', step: { model: 'gem', effort: null } });
  assert.equal(setModelOp(plan, 'zzz', 'opus', cat), null);
});

const session = (over: Partial<{ dirty: boolean; conflict: unknown; revision: number }> = {}) => ({
  flushed: 0,
  async flush() { this.flushed++; },
  isDirty: () => !!over.dirty,
  getState: () => ({ conflict: over.conflict ?? null, file: { revision: over.revision ?? 7, plan } }) as never,
});

test('patch: saves first, then PATCHes against the saved revision', async () => {
  const s = session();
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); }) as typeof fetch;
  assert.equal(await patchStepModel(s, 'p/x.dpx.json', 'r', 'opus', cat, fetchFn), null);
  assert.equal(s.flushed, 1);
  assert.equal(calls[0].url, '/api/file/plan?path=p%2Fx.dpx.json');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-drawing'], '1');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { revision: 7, ops: [{ op: 'set', id: 'r', step: { model: 'opus' } }] });
});

test('patch: refuses when the save did not land; reports 409 and errors', async () => {
  const never = (async () => { throw new Error('no request'); }) as typeof fetch;
  assert.equal(await patchStepModel(session({ dirty: true }), 'x', 'r', 'opus', cat, never), SAVE_FIRST_MODEL);
  assert.equal(await patchStepModel(session({ conflict: {} }), 'x', 'r', 'opus', cat, never), SAVE_FIRST_MODEL);
  const r409 = (async () => new Response('{"error":"stale"}', { status: 409 })) as typeof fetch;
  assert.match((await patchStepModel(session(), 'x', 'r', 'opus', cat, r409))!, /계획이 바뀌었어요/);
  const r400 = (async () => new Response('{"error":"bad"}', { status: 400 })) as typeof fetch;
  assert.equal(await patchStepModel(session(), 'x', 'r', 'opus', cat, r400), 'bad');
});
