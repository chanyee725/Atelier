// In-document questions (#738): `discussions` storage (format v6) and /api/file/discussions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import * as workspace from '../server/workspace/index.js';
import { normalizeContent, parseStored } from '../server/workspace/model.js';
import { askingSteps, openQuestions } from '../shared/dispatch/discussions.ts';

const SID = '0f0e0d0c-0b0a-4908-8706-050403020100';

async function withApp(fn) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-disc-'));
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [{ name: 'workspace', setup: workspace.setup }] });
  // A stand-in for the dispatch hub: one live session and the messages it was sent.
  const sent = [];
  const hub = {
    sessions: [{ id: SID, name: 'Mina' }],
    get: (id) => hub.sessions.find((s) => s.id === id),
    send: (id, text) => sent.push({ id, text }),
  };
  app.ctx.modules.dispatch = { hub };
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
    await fn({ ws, base, call, hub, sent });
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
}

const URL_ = (p, tail = '') => `/api/file/discussions${tail}?path=${encodeURIComponent(p)}`;
const AS_AGENT = { 'x-drawing-session': SID };

test('an agent asks with choices, the user picks one, the asking session gets the answer', async () => {
  await withApp(async ({ ws, call, sent }) => {
    await call('POST', '/api/file', { path: 'App/spec' });
    let r = await call('POST', URL_('App/spec'), { anchor: { kind: 'node', block: 'b1', node: 'api' }, question: ' 인증은 어느 쪽으로 할까요? ', choices: ['세션', '토큰'], step: 'api', junk: 1 }, AS_AGENT);
    assert.equal(r.status, 201);
    const q = r.body.item;
    assert.match(q.id, /^q_/);
    assert.deepEqual({ ...q, id: 0, askedAt: 0 }, { id: 0, askedAt: 0, anchor: { kind: 'node', block: 'b1', node: 'api' }, question: '인증은 어느 쪽으로 할까요?', choices: ['세션', '토큰'], step: 'api', status: 'open', askedBy: 'Mina', askedById: SID });

    // Counts per document and per project; the tree row carries the badge.
    r = await call('GET', '/api/discussions/open');
    assert.deepEqual(r.body, { total: 1, files: [{ path: 'App/spec.dpx.json', title: 'spec', open: 1 }], projects: { App: 1 } });
    const tree = (await call('GET', '/api/tree')).body.tree;
    assert.equal(tree[0].children[0].questions, 1);

    r = await call('POST', URL_('App/spec', '/answer'), { id: q.id, choice: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.delivered, true);
    assert.equal(r.body.item.status, 'answered');
    assert.equal(r.body.item.answer, '토큰');
    assert.equal(r.body.item.answeredBy, 'user');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, SID);
    assert.match(sent[0].text, new RegExp(`${q.id}.*사용자가 답했어요: 토큰`));

    // Answered once only; the file keeps metadata names only.
    assert.equal((await call('POST', URL_('App/spec', '/answer'), { id: q.id, text: '세션' })).status, 400);
    const disk = JSON.parse(await readFile(join(ws, 'App/spec.dpx.json'), 'utf8'));
    assert.equal(disk.version, 6);
    assert.equal(disk.discussions.items[0].askedBy, 'Mina');
    assert.equal(disk.discussions.items[0].askedById, SID);
    assert.deepEqual((await call('GET', '/api/discussions/open')).body, { total: 0, files: [], projects: {} });
  });
});

test('typed answers, bad input and who may ask', async () => {
  await withApp(async ({ ws, base, call, hub, sent }) => {
    await call('POST', '/api/file', { path: 'd' });
    // No session header or an id that is not a live session: refused. An outside writer's own label is never stored
    // (it may be an email or a real name): it asks as "outside".
    assert.equal((await call('POST', URL_('d'), { anchor: { kind: 'block', block: 'p1' }, question: 'q' })).status, 400);
    const unknownSid = await call('POST', URL_('d'), { anchor: { kind: 'block', block: 'p1' }, question: 'q' }, { 'x-drawing-session': '11111111-2222-4333-8444-555555555555' });
    assert.equal(unknownSid.status, 400);
    let r = await call('POST', URL_('d'), { anchor: { kind: 'text', from: 3, to: 9 }, question: '이 문장 맞나요?' }, { 'x-drawing-session': 'kim@example.com' });
    assert.equal(r.status, 201);
    assert.equal(r.body.item.askedBy, 'outside');
    assert.equal(r.body.item.askedById, undefined);
    for (const bad of [
      { anchor: { kind: 'text', from: 5, to: 5 }, question: 'q' },
      { anchor: { kind: 'block', block: 'p1' }, question: '   ' },
      { anchor: { kind: 'block', block: 'p1' }, question: 'q', choices: ['only one'] },
      { anchor: { kind: 'shape' }, question: 'q' },
    ]) {
      assert.equal((await call('POST', URL_('d'), bad, AS_AGENT)).status, 400, JSON.stringify(bad));
    }
    // A typed answer; the asker is not a hub session, so nothing is delivered.
    r = await call('POST', URL_('d', '/answer'), { id: r.body.item.id, text: '  네, 맞아요 ' });
    assert.equal(r.body.item.answer, '네, 맞아요');
    assert.equal(r.body.item.answeredBy, 'user');
    assert.equal(r.body.delivered, false);
    assert.doesNotMatch(await readFile(join(ws, 'd.dpx.json'), 'utf8'), /example\.com/);
    assert.equal((await call('POST', URL_('d', '/answer'), { id: 'q_none', text: 'x' })).status, 400);
    // A session that refuses a message now (e.g. a running Codex turn): the answer is stored, delivered is false.
    const q2 = (await call('POST', URL_('d'), { anchor: { kind: 'block', block: 'p1' }, question: '계속할까요?', choices: ['예', '아니요'] }, AS_AGENT)).body.item;
    hub.send = () => {
      throw new Error('busy');
    };
    assert.equal((await call('POST', URL_('d', '/answer'), { id: q2.id }).then((x) => x.status)), 400, 'needs a choice or text');
    r = await call('POST', URL_('d', '/answer'), { id: q2.id, choice: 0 });
    assert.equal(r.body.delivered, false);
    assert.equal(sent.length, 0);
    r = await call('GET', URL_('d'));
    assert.deepEqual(r.body.discussions.items.map((q) => q.status), ['answered', 'answered']);
    // Writes need x-drawing like every other API write.
    const res = await fetch(base + URL_('d', '/answer'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });
});

test('outside labels: a live session name is kept but never gets answers; answers go by session id', async () => {
  await withApp(async ({ ws, call, hub, sent }) => {
    await call('POST', '/api/file', { path: 'o' });
    // An outside writer claiming a live session's name: the name is stored without an id, so no answer goes to Mina.
    const claimed = (await call('POST', URL_('o'), { anchor: { kind: 'block', block: 'p1' }, question: '누구?' }, { 'x-drawing-session': 'Mina' })).body.item;
    assert.equal(claimed.askedBy, 'Mina');
    assert.equal(claimed.askedById, undefined);
    let r = await call('POST', URL_('o', '/answer'), { id: claimed.id, text: '아무도' });
    assert.equal(r.body.delivered, false);
    assert.equal(sent.length, 0);

    // A real question from Mina; Mina is removed and a new session takes the name: the answer is not delivered to it.
    const q = (await call('POST', URL_('o'), { anchor: { kind: 'block', block: 'p1' }, question: '진행할까요?' }, AS_AGENT)).body.item;
    hub.sessions = [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Mina' }];
    // Answerers: an outside label is "outside" (or a live session's name), an unknown id is "outside" too.
    r = await call('POST', URL_('o', '/answer'), { id: q.id, text: '네' }, { 'x-drawing-session': 'Jane Roe' });
    assert.equal(r.body.item.answeredBy, 'outside');
    assert.equal(r.body.delivered, false);
    assert.equal(sent.length, 0);
    const q2 = (await call('POST', URL_('o'), { anchor: { kind: 'block', block: 'p1' }, question: 'q2' }, { 'x-drawing-session': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).body.item;
    r = await call('POST', URL_('o', '/answer'), { id: q2.id, text: 'a' }, { 'x-drawing-session': '11111111-2222-4333-8444-555555555555' });
    assert.equal(r.body.item.answeredBy, 'outside');
    assert.equal(r.body.delivered, true);
    assert.match(sent[0].text, /바깥 작성자가 답했어요: a$/);
    assert.doesNotMatch(await readFile(join(ws, 'o.dpx.json'), 'utf8'), /Jane Roe/);
  });
});

test('a full save keeps the questions on disk', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'k' });
    await call('POST', URL_('k'), { anchor: { kind: 'block', block: 'p1' }, question: 'q?' }, AS_AGENT);
    const f = (await call('GET', '/api/file?path=k')).body;
    // A tab that loaded before the question (or sends junk) does not drop or rewrite it.
    const r = await call('PUT', '/api/file?path=k', { revision: f.revision, title: 'K', discussions: { v: 1, items: [] } });
    assert.equal(r.status, 200);
    const after = (await call('GET', '/api/file?path=k')).body;
    assert.equal(after.title, 'K');
    assert.equal(after.discussions.items.length, 1);
  });
});

test('storage rules: broken sections drop on read only, newer versions stay verbatim, helpers count open ones', () => {
  const base = { version: 6, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1 };
  assert.equal('discussions' in parseStored(JSON.stringify({ ...base, discussions: { v: 1, items: 'nope' } })), false);
  assert.throws(() => normalizeContent({ discussions: { v: 1, items: [{ id: 'a' }] } }), /discussions\.items\[0\]\.anchor/);
  const newer = { v: 2, future: true };
  assert.deepEqual(normalizeContent({ discussions: newer }).discussions, newer);
  const open = { id: 'a', anchor: { kind: 'block', block: 'x' }, question: 'q', status: 'open', askedBy: 'Mina', askedAt: 1, step: 'api' };
  const done = { ...open, id: 'b', status: 'answered', answer: 'y', answeredBy: 'user', answeredAt: 2 };
  const d = normalizeContent({ discussions: { v: 1, items: [open, done] } }).discussions;
  assert.deepEqual(openQuestions(d).map((q) => q.id), ['a']);
  assert.deepEqual([...askingSteps(d)], ['api']);
  assert.deepEqual(openQuestions(newer), []);
  assert.throws(() => normalizeContent({ discussions: { v: 1, items: [{ ...done, answeredBy: undefined }] } }), /answeredBy/);
  // The asking session's id is kept; a non-string one is refused.
  assert.equal(normalizeContent({ discussions: { v: 1, items: [{ ...open, askedById: 'sid-1' }] } }).discussions.items[0].askedById, 'sid-1');
  assert.throws(() => normalizeContent({ discussions: { v: 1, items: [{ ...open, askedById: 7 }] } }), /askedById/);
});
