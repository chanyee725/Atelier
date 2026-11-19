// E528 (#592): the live agent list and named outside writers (x-drawing-session). Memory only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgents, cleanSessionLabel, LABEL_MAX, projectOf, sessionIdOf } from '../server/cursor/presence.js';
import * as cursor from '../server/cursor/index.js';
import * as agents from '../server/cursor/agents.js';
import * as workspace from '../server/workspace/index.js';
import { createApp } from '../server/app.js';
import { newFile } from '../server/workspace/model.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('sessionIdOf: a session id from DRAWING_SESSION only (#656)', () => {
  assert.equal(sessionIdOf(' 1A2B3C4D-0000-4000-8000-00000000abcd '), '1a2b3c4d-0000-4000-8000-00000000abcd');
  for (const v of ['Otto', '', undefined, ['x'], '1a2b3c4d-0000-4000-8000-00000000abcdx', '1a2b3c4d00004000800000000000abcd']) assert.equal(sessionIdOf(v), null);
});

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
  assert.deepEqual(all.map((a) => a.name), ['Ext', 'Remy', 'Otto', 'Cal']); // an idle session is live too (#785)
  assert.deepEqual(all[2], {
    sid: 's1', name: 'Otto', role: 'impl', roleName: '구현자', color: '#ff0000', model: 'm', modelLabel: 'M',
    status: 'running', state: 'working', project: 'P', file: 'P/a.dpx.json', at: 10,
  });
  assert.equal(all[1].project, 'Q'); // no folder of its own: the held file's
  assert.deepEqual(all[0], { sid: 'outside:Ext', name: 'Ext', role: '', model: null, status: 'running', state: 'working', project: 'P', file: 'P/c.dpx.json', at: 30, outside: true });
  assert.deepEqual(buildAgents({ sessions, held, outside, project: 'P' }).map((a) => a.name), ['Ext', 'Otto', 'Cal']);
  const team = buildAgents({ sessions: [{ id: 't', name: 'T', role: 'impl', status: 'idle', n: 7, parent: 'L' }] })[0];
  assert.deepEqual([team.n, team.parent], [7, 'L']); // fixed team order on the home list (#785)
  const ended = [{ id: 'd', name: 'Done', role: 'impl', status: 'done' }, { id: 'e', name: 'Err', role: 'impl', status: 'error' }];
  assert.deepEqual(buildAgents({ sessions: ended }), []);
  assert.deepEqual(buildAgents({ sessions, held, outside, project: 'Q' }).map((a) => a.name), ['Remy']);
});

test('buildAgents: provider and the current tool activity (memory only)', () => {
  const sessions = [
    { id: 's1', name: 'Otto', role: 'impl', model: 'm', provider: 'claude', status: 'running' },
    { id: 's2', name: 'Cal', role: 'lead', model: 'g', provider: '', status: 'running' },
  ];
  const activity = new Map([['s1', '코드 읽기'], ['s2', 7]]);
  const [a, b] = buildAgents({ sessions, activity }).sort((x, y) => x.sid.localeCompare(y.sid));
  assert.equal(a.provider, 'claude');
  assert.equal(a.activity, '코드 읽기');
  assert.equal('provider' in b, false, 'an empty provider is left out');
  assert.equal('activity' in b, false, 'a non-text label is left out');
  assert.equal('activity' in buildAgents({ sessions })[0], false);
});

test('agents module: activity follows the hub session events and clears between turns', async () => {
  const r = rig();
  r.ctx.modules.cursor = await cursor.setup(r.ctx);
  const m = await agents.setup(r.ctx);
  const s1 = { id: 's1', name: 'Otto', role: 'impl', model: 'm', provider: 'openai', status: 'running', folder: 'P' };
  r.hub.sessions.s1 = s1;
  // The public session (what the hub emits) carries the activity; the stored one does not.
  r.hub.emit('session', { ...s1, activity: { label: 'e2e 실행', since: 1 } });
  assert.deepEqual(m.list().map((a) => [a.provider, a.activity]), [['openai', 'e2e 실행']]);
  const last = r.sent.filter((s) => s.event === 'agents').at(-1).data.agents[0];
  assert.equal(last.activity, 'e2e 실행');
  r.hub.emit('session', { ...s1, activity: null });
  assert.equal('activity' in m.list()[0], false);
  r.hub.emit('session', { ...s1, activity: { label: '코드 읽기', since: 2 } });
  r.hub.emit('removed', { id: 's1' });
  r.hub.sessions.s1 = { ...s1 };
  r.hub.emit('session', s1);
  assert.equal('activity' in m.list()[0], false, 'removed: the label is dropped');
  m.close();
  r.ctx.modules.cursor.close();
});

test('buildAgents: statusLabel from the cursor module status (#654), absent when null', () => {
  const sessions = [{ id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running' }, { id: 's2', name: 'Cal', role: 'lead', model: 'm', status: 'running' }];
  const statusOf = (sid) => (sid === 's1' ? '다이어그램 작성 중…' : null);
  const [a, b] = buildAgents({ sessions, statusOf }).sort((x, y) => x.sid.localeCompare(y.sid));
  assert.equal(a.statusLabel, '다이어그램 작성 중…');
  assert.equal('statusLabel' in b, false);
});

test('agents module: statusLabel follows cursor.onStatus', async () => {
  const r = rig();
  let label = null;
  const fns = new Set();
  r.ctx.modules.cursor = { onHeld: () => () => {}, statusOf: () => label, onStatus: (fn) => (fns.add(fn), () => fns.delete(fn)) };
  const m = await agents.setup(r.ctx);
  r.hub.sessions.s1 = { id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running' };
  r.hub.emit('session', r.hub.sessions.s1);
  assert.equal('statusLabel' in m.list()[0], false);
  label = '글 작성 중…';
  for (const fn of fns) fn({ sid: 's1', status: label });
  assert.equal(r.sent.filter((s) => s.event === 'agents').at(-1).data.agents[0].statusLabel, '글 작성 중…');
  m.close();
  assert.equal(fns.size, 0, 'close unsubscribes');
});

test('buildAgents: the pipeline step title, trimmed and capped', () => {
  const sessions = [{ id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running' }, { id: 's2', name: 'Cal', role: 'lead', model: 'm', status: 'running' }];
  const stepOf = (s) => (s.id === 's1' ? '  화면 지도 그리기 ' : '   ');
  const [a, b] = buildAgents({ sessions, stepOf }).sort((x, y) => x.sid.localeCompare(y.sid));
  assert.equal(a.step, '화면 지도 그리기');
  assert.equal('step' in b, false);
  assert.equal(buildAgents({ sessions, stepOf: () => 'x'.repeat(200) })[0].step.length, 80);
});

test('agents module: step from the running plan link and the plan diagram label; follows a plan edit', async () => {
  const r = rig();
  const pipelines = {};
  r.ctx.modules.dispatch.store = { data: { pipelines } };
  r.ctx.modules.cursor = await cursor.setup(r.ctx);
  const m = await agents.setup(r.ctx);
  const plan = (label) => ({ canvas: { elements: [] }, blocks: [{ id: 'b_plan', code: `map [label: "${label}"]\nother [label: "그 밖"]` }] });
  r.files.set('P/plan.dpx.json', plan('화면 지도'));
  const s1 = { id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running', folder: 'P' };
  r.hub.sessions.s1 = s1;
  r.hub.emit('session', s1);
  assert.equal('step' in m.list()[0], false, 'no plan: no step');
  pipelines['P/plan.dpx.json'] = { lead: 'L', state: 'running', links: { s1: 'map' } };
  r.hub.emit('tasks', []);
  await sleep(10);
  assert.equal(m.list()[0].step, '화면 지도');
  assert.equal(r.sent.filter((x) => x.event === 'agents').at(-1).data.agents[0].step, '화면 지도', 'broadcast once the labels are read');
  await r.change('P/plan.dpx.json', plan('화면 지도 v2'));
  m.list();
  await sleep(10);
  assert.equal(m.list()[0].step, '화면 지도 v2');
  pipelines['P/plan.dpx.json'].state = 'done';
  assert.equal('step' in m.list()[0], false, 'a finished plan: no step');
  m.close();
  r.ctx.modules.cursor.close();
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
  for (const fn of r.attachers) await fn((ev, data) => got.push({ ev, data }));
  assert.deepEqual(got, [{ ev: 'agents', data: { agents: [] } }]);

  r.hub.sessions.s1 = { id: 's1', name: 'Otto', role: 'impl', model: 'm', status: 'running', state: 'working', folder: 'P' };
  r.hub.emit('session', r.hub.sessions.s1);
  assert.deepEqual(lists().at(-1).map((a) => [a.name, a.file]), [['Otto', null]]);

  // The live view (#728) hears of credited document writes too.
  const docs = [];
  r.hub.liveView = { noteDoc: (sid, file) => docs.push([sid, file]) };
  r.files.set('P/a.dpx.json', rect('r', 0));
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/P/a.dpx.json"}' } });
  await sleep(5);
  await r.change('P/a.dpx.json', rect('r', 50));
  assert.deepEqual(lists().at(-1).map((a) => [a.name, a.file]), [['Otto', 'P/a.dpx.json']]);
  assert.deepEqual(docs, [['s1', 'P/a.dpx.json']]);

  // A repeated session update with nothing new is not sent again (the first one may bring the status label up to date).
  r.hub.emit('session', r.hub.sessions.s1);
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

  // An unnamed outside write of the file a named writer just wrote keeps that name (#653); of another file it gets
  // the generic cursor and is not listed.
  await r.change('P/b.dpx.json', rect('q', 90));
  assert.equal(r.sent.filter((s) => s.event === 'cursor').at(-1).data.name, 'Ext');
  r.files.set('P/c.dpx.json', rect('z', 0));
  await r.change('P/c.dpx.json', rect('z', 40));
  assert.equal(r.sent.filter((s) => s.event === 'cursor').at(-1).data.name, '에이전트');
  assert.equal(m.list().length, 2);

  // A named write while Otto's call is still open: Otto keeps it, whatever name the request sends (#603 review).
  const curl = { kind: 'tool', name: 'Bash', text: 'curl -X PUT /api/file?path=P%2Fb.dpx.json' };
  for (const writer of ['lead-Otto', 'Otto']) {
    r.hub.emit('message', { id: 's1', entry: { ...curl } });
    await sleep(5);
    await r.change('P/b.dpx.json', rect('q', writer.length + 80), { writer });
    const last = r.sent.filter((s) => s.event === 'cursor').at(-1).data;
    assert.deepEqual([last.sid, last.name], ['s1', 'Otto'], writer);
  }
  assert.equal(m.list().find((a) => a.sid === 's1').file, 'P/b.dpx.json');
  assert.equal(m.list().some((a) => a.name === 'lead-Otto'), false);

  // Idle between turns: still listed (#785).
  r.hub.sessions.s1.status = 'idle';
  r.hub.emit('session', { id: 's1' });
  assert.deepEqual(lists().at(-1).map((a) => a.name).sort(), ['Ext', 'Otto']);
  // The session leaves: gone from the list.
  delete r.hub.sessions.s1;
  r.hub.emit('removed', { id: 's1' });
  assert.deepEqual(lists().at(-1).map((a) => a.name), ['Ext']);
  m.close();
  r.ctx.modules.cursor.close();
});

test('agents module without agent sessions: GET answers an empty list', async () => {
  const sent = [];
  const m = await agents.setup({ hub: { broadcast: (e, d) => sent.push(e), onAttach() {} }, modules: { cursor: {} } });
  assert.deepEqual(m.list(), []);
  assert.equal(m.routes[0].path, '/api/workspace/agents');
  m.close();
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
    let rev = (await res.json()).revision;
    await sleep(50);
    const lastCursor = () => seen.filter((s) => s.ev === 'cursor').at(-1)?.data;
    assert.equal(lastCursor()?.name, 'bNova/b');
    // Writes with no x-drawing-session (#656): the same file within two minutes keeps the name; another file is
    // the generic agent.
    const plain = { 'x-drawing': '1', 'content-type': 'application/json' };
    const cursorsOn = (file) => seen.filter((s) => s.ev === 'cursor' && s.data.file === file).map((s) => s.data);
    const before = cursorsOn('Proj/a.dpx.json').length;
    f.canvas.elements[0].x = 40;
    res = await fetch(`${base}/api/file?path=${path}`, { method: 'PUT', headers: plain, body: JSON.stringify({ ...f, revision: rev }) });
    assert.equal(res.status, 200);
    rev = (await res.json()).revision;
    await sleep(50);
    // A fresh cursor for this header-less write (not the earlier one left over), still under the cleaned name.
    const after = cursorsOn('Proj/a.dpx.json');
    assert.equal(after.length, before + 1);
    assert.equal(after.at(-1).name, 'bNova/b');
    const g = newFile();
    res = await fetch(`${base}/api/file`, { method: 'POST', headers: plain, body: JSON.stringify({ ...g, path: 'Proj/b.dpx.json' }) });
    assert.equal(res.status, 201);
    g.canvas.elements = [{ id: 'q', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }];
    res = await fetch(`${base}/api/file?path=${encodeURIComponent('Proj/b.dpx.json')}`, { method: 'PUT', headers: plain, body: JSON.stringify({ ...g, revision: (await res.json()).revision }) });
    assert.equal(res.status, 200);
    await sleep(50);
    assert.deepEqual([lastCursor()?.name, lastCursor()?.file], ['에이전트', 'Proj/b.dpx.json']);
    const cur = seen.filter((s) => s.ev === 'cursor' && s.data.file === 'Proj/a.dpx.json').at(-1)?.data;
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
