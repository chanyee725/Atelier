// The document's lead (#1057): server/workspace/doc-lead.js and GET/POST /api/file/lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import * as workspace from '../server/workspace/index.js';
import { docLead, leadOf, recordDocLead, MAX_DOC_LEADS } from '../server/workspace/doc-lead.js';

const LEAD = '0f0e0d0c-0b0a-4908-8706-050403020100';
const IMPL = '1f0e0d0c-0b0a-4908-8706-050403020101';
const OTHER = '2f0e0d0c-0b0a-4908-8706-050403020102';
const NEXT = '3f0e0d0c-0b0a-4908-8706-050403020103';

const view = (sessions) => ({ get: (id) => sessions.find((s) => s.id === id), sessions });
const lead = (id, name, extra = {}) => ({ id, name, role: 'lead', canSpawn: true, status: 'idle', parent: null, modelLabel: 'Sonnet 5.5', ...extra });

test('leadOf: a lead itself, a teammate through its parent, a rotated lead through its successor', () => {
  const v = view([lead(LEAD, 'Jae'), { id: IMPL, name: 'Kit', role: 'impl', status: 'running', parent: LEAD }]);
  assert.equal(leadOf(LEAD, v)?.name, 'Jae');
  assert.equal(leadOf(IMPL, v)?.name, 'Jae');
  assert.equal(leadOf('nope', v), null);
  // Ended without a successor: no lead. Swapped past the length guard: the fresh one.
  const ended = view([lead(LEAD, 'Jae', { status: 'done' })]);
  assert.equal(leadOf(LEAD, ended), null);
  const rotated = view([lead(LEAD, 'Jae', { status: 'done' }), lead(NEXT, 'Jae2', { rotatedFrom: { id: LEAD } })]);
  assert.equal(leadOf(LEAD, rotated)?.id, NEXT);
});

test('docLead: assign beats plan beats write beats question; dead leads are skipped', () => {
  const v = view([lead(LEAD, 'Jae'), lead(OTHER, 'Sam'), lead(NEXT, 'Pia', { status: 'error' })]);
  const disc = { v: 1, items: [{ askedById: OTHER, askedAt: 1 }] };
  assert.deepEqual(docLead({ path: 'a', discussions: disc }, v), { lead: { id: OTHER, name: 'Sam', modelLabel: 'Sonnet 5.5' }, source: 'question' });
  assert.equal(docLead({ path: 'a', docLeads: { a: { lead: LEAD, by: 'write' } }, discussions: disc }, v).source, 'write');
  assert.equal(docLead({ path: 'a', docLeads: { a: { lead: LEAD, by: 'write' } }, planLead: OTHER }, v).lead.id, OTHER);
  assert.equal(docLead({ path: 'a', docLeads: { a: { lead: LEAD, by: 'assign' } }, planLead: OTHER }, v).source, 'assign');
  // The plan's lead ended: fall through to the writer.
  assert.equal(docLead({ path: 'a', docLeads: { a: { lead: LEAD, by: 'write' } }, planLead: NEXT }, v).lead.id, LEAD);
  assert.deepEqual(docLead({ path: 'a', planLead: NEXT }, v), { lead: null, source: null });
});

test('recordDocLead: a write never replaces a live assignment; the list keeps the newest paths', () => {
  const v = view([lead(LEAD, 'Jae'), lead(OTHER, 'Sam')]);
  const data = {};
  assert.equal(recordDocLead(data, 'a', LEAD, 'assign', 1, v), true);
  assert.equal(recordDocLead(data, 'a', OTHER, 'write', 2, v), false);
  assert.equal(data.docLeads.a.lead, LEAD);
  // The assigned lead ended: the next writer's lead takes the document.
  const gone = view([lead(LEAD, 'Jae', { status: 'done' }), lead(OTHER, 'Sam')]);
  assert.equal(recordDocLead(data, 'a', OTHER, 'write', 3, gone), true);
  assert.deepEqual(data.docLeads.a, { lead: OTHER, by: 'write', at: 3 });
  for (let i = 0; i < MAX_DOC_LEADS + 5; i++) recordDocLead(data, `f${i}`, LEAD, 'write', i, v);
  assert.equal(Object.keys(data.docLeads).length, MAX_DOC_LEADS);
  assert.equal('a' in data.docLeads, false);
});

async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-doclead-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [{ name: 'workspace', setup: workspace.setup }] });
  const sessions = [lead(LEAD, 'Jae'), { id: IMPL, name: 'Kit', role: 'impl', status: 'running', parent: LEAD }, lead(OTHER, 'Sam')];
  let saves = 0;
  const store = { data: { pipelines: {} }, save: () => saves++ };
  const hub = { sessions, get: (id) => sessions.find((s) => s.id === id), send: () => {} };
  app.ctx.modules.dispatch = { hub, store };
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-drawing': '1', ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ call, store, saves: () => saves });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
}

const U = (p) => `/api/file/lead?path=${encodeURIComponent(p)}`;

test('a teammate write makes its lead the document lead; the person can assign another live lead', async () => {
  await withApp(async ({ call, store, saves }) => {
    await call('POST', '/api/file', { path: 'App/spec' });
    let r = await call('GET', U('App/spec'));
    assert.deepEqual(r.body, { path: 'App/spec.dpx.json', lead: null, source: null });

    const f = (await call('GET', '/api/file?path=App/spec.dpx.json')).body;
    r = await call('PUT', '/api/file?path=App/spec.dpx.json', { ...f, title: 'spec 2' }, { 'x-drawing-session': IMPL });
    assert.equal(r.status, 200);
    assert.deepEqual(store.data.docLeads['App/spec.dpx.json'].lead, LEAD);
    assert.ok(saves() >= 1);
    r = await call('GET', U('App/spec'));
    assert.deepEqual([r.body.lead.name, r.body.source], ['Jae', 'write']);

    // Only a live lead can be assigned; a teammate is refused.
    assert.equal((await call('POST', U('App/spec'), { lead: IMPL })).status, 400);
    r = await call('POST', U('App/spec'), { lead: OTHER });
    assert.deepEqual([r.status, r.body.lead.name, r.body.source], [200, 'Sam', 'assign']);
    assert.equal((await call('GET', U('App/spec'))).body.lead.id, OTHER);
  });
});

test('a plan file names its lead from the pipeline entry', async () => {
  await withApp(async ({ call, store }) => {
    await call('POST', '/api/file', { path: 'App/계획' });
    store.data.pipelines['App/계획.dpx.json'] = { lead: OTHER, state: 'plan' };
    const r = await call('GET', U('App/계획'));
    assert.deepEqual([r.body.lead.name, r.body.source], ['Sam', 'plan']);
  });
});

test('without agent sessions the answer says so, and the button hides', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-doclead-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [{ name: 'workspace', setup: workspace.setup }] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await fetch(`${base}/api/file`, { method: 'POST', headers: { 'x-drawing': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: 'A/b' }) });
    const r = await (await fetch(base + U('A/b'))).json();
    assert.deepEqual(r, { path: 'A/b.dpx.json', lead: null, source: null, dispatch: false });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
});
