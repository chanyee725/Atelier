// E528 (#592): the live agent list and named outside writers (x-drawing-session). Memory only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgents, cleanSessionLabel, LABEL_MAX, projectOf } from '../server/cursor/presence.js';
import * as cursor from '../server/cursor/index.js';
import * as agents from '../server/cursor/agents.js';
import * as workspace from '../server/workspace/index.js';
import { createApp } from '../server/app.js';
import { newFile } from '../server/workspace/model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('cleanSessionLabel: short plain text only', () => {
  assert.equal(cleanSessionLabel('Otto'), 'Otto');
  assert.equal(cleanSessionLabel('  Dispatch   Otto  '), 'Dispatch Otto');
  assert.equal(cleanSessionLabel('<img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)');
  assert.equal(cleanSessionLabel('a"b\'c`d&e\\f'), 'abcdef');
  assert.equal(cleanSessionLabel('Ot\u0000to\u001b[31m'), 'Ot to [31m');
  assert.equal(cleanSessionLabel('‮evil​'), 'evil');
  assert.equal(cleanSessionLabel('줄\n바꿈'), '줄 바꿈');
  assert.equal([...cleanSessionLabel('가'.repeat(100))].length, LABEL_MAX);
  for (const bad of [undefined, null, '', '   ', '<>', ['a', 'b'], 7]) assert.equal(cleanSessionLabel(bad), null);
});

test('projectOf: top folder, null for loose files', () => {
  assert.equal(projectOf('Sim-Studio/a.dpx.json'), 'Sim-Studio');
  assert.equal(projectOf('Sim-Studio/x/y.dpx.json'), 'Sim-Studio');
  assert.equal(projectOf('loose.dpx.json'), null);
  assert.equal(projectOf(null), null);
});

test('buildAgents: live sessions with their held file, project filter, newest first', () => {
  const sessions = [
    { id: 's1', name: 'Otto', role: 'impl', roleName: '구현자', color: '#ff0000', model: 'm', modelLabel: 'M', status: 'running', state: 'working', folder: 'P' },
    { id: 's2', name: 'Cal', role: 'lead', model: 'm', status: 'idle', folder: 'P' },
    { id: 's3', name: 'Remy', role: 'review', model: 'm', status: 'waiting', state: 'waiting', folder: null, updatedAt: 5 },
  ];
  const held = new Map([['s1', { file: 'P/a.dpx.json', at: 10 }], ['s3', { file: 'Q/b.dpx.json', at: 20 }]]);
  const outside = new Map([['Ext', { file: 'P/c.dpx.json', at: 30 }]]);
  const all = buildAgents({ sessions, held, outside });
  assert.deepEqual(all.map((a) => a.name), ['Ext', 'Remy', 'Otto']);
  assert.deepEqual(all[2], {
    sid: 's1', name: 'Otto', role: 'impl', roleName: '구현자', color: '#ff0000', model: 'm', modelLabel: 'M',
    status: 'running', state: 'working', project: 'P', file: 'P/a.dpx.json', at: 10,
  });
  assert.equal(all[1].project, 'Q'); // no folder of its own: the held file's
  assert.deepEqual(all[0], { sid: 'outside:Ext', name: 'Ext', role: '', model: null, status: 'running', state: 'working', project: 'P', file: 'P/c.dpx.json', at: 30, outside: true });
  assert.deepEqual(buildAgents({ sessions, held, outside, project: 'P' }).map((a) => a.name), ['Ext', 'Otto']);
  assert.deepEqual(buildAgents({ sessions, held, outside, project: 'Q' }).map((a) => a.name), ['Remy']);
});

function rig() {
  const files = new Map();
  const listeners = new Set();
  const sent = [];
  const attachers = [];
  const hub = Object.assign(new EventEmitter(), { sessions: {}, get(id) { return this.sessions[id]; } });
  const ctx = {
    hub: { broadcast: (event, data) => sent.push({ event, data }), onAttach: (fn) => attachers.push(fn) },
    modules: {
      workspace: {
        store: { readFile: async (rel) => { if (!files.has(rel)) throw new Error('nope'); return files.get(rel); } },
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      },
      dispatch: { hub },
    },
  };
  const change = async (rel, f, opts) => {
    files.set(rel, f);
    for (const fn of listeners) fn(rel, opts);
    await sleep(5);
  };
  return { files, hub, ctx, sent, attachers, change };
}
const rect = (id, x) => ({ canvas: { elements: [{ id, type: 'rectangle', x, y: 0, width: 10, height: 10 }] }, blocks: [] });

test('agents module: the list follows edits, sessions and named outside writers', async () => {
  const r = rig();
  r.ctx.modules.cursor = await cursor.setup(r.ctx);
  const m = await agents.setup(r.ctx);
  r.ctx.modules.agents = m;
  const lists = () => r.sent.filter((s) => s.event === 'agents').map((s) => s.data.agents);

  // First snapshot on connect.
  const got = [];
  await r.attachers[0]((ev, data) => got.push({ ev, data }));
  assert.deepEqual(got, [{ ev: 'agents', data: { agents: [] } }]);

  r.hub.sessions.s1 = { id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running', state: 'working', folder: 'P' };
  r.hub.emit('session', r.hub.sessions.s1);
  assert.deepEqual(lists().at(-1).map((a) => [a.name, a.file]), [['Otto', null]]);

  r.files.set('P/a.dpx.json', rect('r', 0));
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/P/a.dpx.json"}' } });
  await sleep(5);
  await r.change('P/a.dpx.json', rect('r', 50));
  assert.deepEqual(lists().at(-1).map((a) => [a.name, a.file]), [['Otto', 'P/a.dpx.json']]);

  // A repeated session update with nothing new is not sent again.
  const n = lists().length;
  r.hub.emit('session', r.hub.sessions.s1);
  assert.equal(lists().length, n);

  // A named outside writer: listed, and its cursor carries the name.
  r.files.set('P/b.dpx.json', rect('q', 0));
  await r.change('P/b.dpx.json', rect('q', 80), { writer: 'Ext' });
  const cur = r.sent.filter((s) => s.event === 'cursor').at(-1).data;
  assert.equal(cur.sid, 'outside:Ext');
  assert.equal(cur.name, 'Ext');
  assert.deepEqual(m.list('P').map((a) => a.name).sort(), ['Ext', 'Otto']);
  assert.deepEqual(m.list('Q'), []);

  // An unnamed outside write keeps the generic cursor and is not listed.
  await r.change('P/b.dpx.json', rect('q', 90));
  assert.equal(r.sent.filter((s) => s.event === 'cursor').at(-1).data.name, '에이전트');
  assert.equal(m.list().length, 2);

  // The session leaves: gone from the list.
  r.hub.sessions.s1.status = 'idle';
  r.hub.emit('removed', { id: 's1' });
  assert.deepEqual(lists().at(-1).map((a) => a.name), ['Ext']);
  m.close();
  r.ctx.modules.cursor.close();
});

test('x-drawing-session over HTTP: cleaned label on the cursor and in GET /api/workspace/agents, nothing on disk', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const list = [
    { name: 'workspace', setup: workspace.setup },
    // A hub with no sessions (the real one needs a git project).
    { name: 'dispatch', setup: () => ({ hub: Object.assign(new EventEmitter(), { sessions: [], get: () => undefined }) }) },
    { name: 'cursor', setup: cursor.setup },
    { name: 'agents', setup: agents.setup },
  ];
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: list });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const seen = [];
  const orig = app.ctx.hub.broadcast;
  app.ctx.hub.broadcast = (ev, data) => { seen.push({ ev, data }); orig(ev, data); };
  try {
    const path = encodeURIComponent('Proj/a.dpx.json');
    const h = { 'x-drawing': '1', 'content-type': 'application/json', 'x-drawing-session': ' <b>Nova</b>\t ' };
    let res = await fetch(`${base}/api/folder`, { method: 'POST', headers: h, body: JSON.stringify({ path: 'Proj' }) });
    assert.equal(res.status, 201);
    const f = newFile();
    res = await fetch(`${base}/api/file`, { method: 'POST', headers: h, body: JSON.stringify({ ...f, path: 'Proj/a.dpx.json' }) });
    assert.equal(res.status, 201);
    const { revision } = await res.json();
    f.canvas.elements = [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }];
    res = await fetch(`${base}/api/file?path=${path}`, { method: 'PUT', headers: h, body: JSON.stringify({ ...f, revision }) });
    assert.equal(res.status, 200);
    await sleep(50);
    const cur = seen.filter((s) => s.ev === 'cursor').at(-1)?.data;
    assert.equal(cur?.name, 'bNova/b');
    const body = await (await fetch(`${base}/api/workspace/agents?project=Proj`)).json();
    assert.deepEqual(body.agents.map((a) => [a.name, a.file, a.outside]), [['bNova/b', 'Proj/a.dpx.json', true]]);
    assert.deepEqual((await (await fetch(`${base}/api/workspace/agents?project=Other`)).json()).agents, []);
    // Writes still need x-drawing: 1, header or not.
    res = await fetch(`${base}/api/file?path=${path}`, { method: 'PUT', headers: { ...h, 'x-drawing': '0' }, body: '{}' });
    assert.equal(res.status, 403);
    // Nothing about the writer reaches disk.
    const walk = async (d) => (await readdir(d, { withFileTypes: true, recursive: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));
    const { readFile } = await import('node:fs/promises');
    for (const p of await walk(ws)) assert.equal((await readFile(p, 'utf8')).includes('Nova'), false, p);
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
});
