// #1045: a new plan is drafted in 기획/<feature>/ and 시작하기 moves the feature folder to the plan's area. Its run
// record, history, entry, sessions and an open tab's path follow; conflicts, failures and a second start are handled.
// Runs against a scratch git repo with one commit in a temp dir; agent sessions use the fake CLIs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { until } from './fixtures/fake-cli/index.mjs';
import { start, STEPS, told } from './helpers/pipeline-app.mjs';

const enc = encodeURIComponent;
const plan = (t, body) => t.call('POST', '/api/pipeline/plan', { lead: t.lead.id, goal: '연습', steps: STEPS, ...body });
const go = (t, w) => t.call('POST', '/api/pipeline/start', { path: w.path, revision: w.revision });

test('시작하기 moves the feature folder with its sub-documents; run record, history, entry and sessions follow', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    const w = (await plan(t, { title: '로봇 제어' })).body;
    assert.equal(w.path, '기획/로봇-제어/계획.dpx.json');
    // A sub-document and a diagram the lead added next to the plan, and a saved edit (a history version).
    assert.equal((await call('POST', '/api/file', { path: '기획/로봇-제어/구조' })).status, 201);
    const cur = (await call('GET', `/api/file?path=${enc(w.path)}`)).body;
    const saved = (await call('PUT', `/api/file?path=${enc(w.path)}`, { ...cur, title: '로봇 제어 계획' })).body;
    const r = await go(t, { path: w.path, revision: saved.revision });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const to = 'App/로봇-제어/계획.dpx.json';
    assert.equal(r.body.path, to);
    assert.ok(existsSync(join(ws, to)) && existsSync(join(ws, 'App/로봇-제어/구조.dpx.json')));
    assert.ok(!existsSync(join(ws, '기획', '로봇-제어')));
    // The file kept its revision, so the approved revision still matches it.
    assert.equal((await call('GET', `/api/file?path=${enc(to)}`)).body.revision, saved.revision);
    // Entry and status at the new path; nothing left at the old one.
    assert.equal(d.store.data.pipelines[to]?.state, 'running');
    assert.equal(d.store.data.pipelines[w.path], undefined);
    assert.equal((await call('GET', `/api/pipeline?path=${enc(to)}`)).body.state, 'running');
    // The run record lives at, and names, the new path.
    const runs = (await call('GET', `/api/runs?path=${enc(to)}`)).body;
    assert.ok(JSON.stringify(runs).includes(r.body.runId), JSON.stringify(runs));
    const rec = (await call('GET', `/api/runs/run?path=${enc(to)}&id=${r.body.runId}`)).body;
    assert.equal(rec.file, to);
    // History moved too.
    const hist = await call('GET', `/api/history?path=${enc(to)}`);
    assert.equal(hist.status, 200);
    assert.ok(hist.body.versions.length >= 1, JSON.stringify(hist.body));
    // The lead hears the new path; its teammates are filed under the area and land in the record at the new path.
    assert.match(told(d, lead.id), /\[계획 승인 · rev \d+\] App\/로봇-제어\/계획\.dpx\.json/);
    assert.match(told(d, lead.id), /기획\/로봇-제어에서 App\/로봇-제어로 옮겼다/);
    await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    assert.equal(mate.folder, 'App');
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, stage: 'impl' });
    await until(() => d.store.data.pipelines[to].links?.[mate.id] === 'api', 10_000);
    await t.app.ctx.modules.runs.recorder.endRun(r.body.runId, 'done');
    const after = (await call('GET', `/api/runs/run?path=${enc(to)}&id=${r.body.runId}`)).body;
    assert.equal(after.steps.api.sessions[0].sid, mate.id);
  } finally {
    await t.stop();
  }
});

test('a feature folder already in the area: the plan moves to <feature>-2 and the old folder is untouched', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, ws } = t;
    mkdirSync(join(ws, 'App', '충돌'), { recursive: true });
    writeFileSync(join(ws, 'App', '충돌', 'keep.txt'), 'x');
    const w = (await plan(t, { title: '충돌' })).body;
    const r = await go(t, w);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, 'App/충돌-2/계획.dpx.json');
    assert.ok(existsSync(join(ws, 'App', '충돌', 'keep.txt')) && !existsSync(join(ws, 'App', '충돌', '계획.dpx.json')));
    assert.equal((await call('GET', `/api/pipeline?path=${enc(r.body.path)}`)).body.state, 'running');
  } finally {
    await t.stop();
  }
});

test('a move that fails leaves the plan in 기획 and the run starts there; a plan already in an area does not move', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    // The area name is taken by a plain file: the move fails.
    writeFileSync(join(ws, 'Zed'), 'not a folder');
    const w = (await plan(t, { title: '실패', area: 'Zed' })).body;
    const r = await go(t, w);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, w.path);
    assert.ok(existsSync(join(ws, w.path)));
    assert.equal(d.store.data.pipelines[w.path].state, 'running');
    assert.match(told(d, lead.id), /Zed로 옮기지 못해 기획 폴더에 그대로 뒀다/);
    assert.ok((await call('GET', `/api/runs/run?path=${enc(w.path)}&id=${r.body.runId}`)).body.id);

    // A plan written to an area path stays where it is.
    await call('POST', '/api/pipeline/stop', { path: w.path });
    const t2 = await start();
    try {
      const own = (await plan(t2, { path: 'App/직접/계획', title: '직접' })).body;
      assert.equal(own.path, 'App/직접/계획.dpx.json');
      const r2 = await go(t2, own);
      assert.equal(r2.status, 200, JSON.stringify(r2.body));
      assert.equal(r2.body.path, own.path);
      assert.doesNotMatch(told(t2.d, t2.lead.id), /계획 폴더/);
    } finally {
      await t2.stop();
    }
  } finally {
    await t.stop();
  }
});

test('an unknown area keeps the plan in 기획 with a line saying so', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, ws } = t;
    mkdirSync(join(ws, 'web'));
    mkdirSync(join(ws, 'server'));
    // The lead has no folder, and the step files split evenly between two areas.
    const lead = (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan' }], worktree: false })).body.sessions[0];
    await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
    const steps = [{ title: 'a', role: 'impl', files: ['web/a.ts'] }, { title: 'b', role: 'impl', files: ['server/b.js'] }];
    const w = (await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '반반', goal: 'x', steps })).body;
    assert.equal(w.area, null);
    // The sidebar lists 기획 first, ahead of App, server and web.
    assert.deepEqual((await call('GET', '/api/tree')).body.tree.filter((n) => n.type === 'folder').map((n) => n.name)[0], '기획');
    const r = await call('POST', '/api/pipeline/start', { path: w.path, revision: w.revision });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, '기획/반반/계획.dpx.json');
    assert.match(JSON.stringify((await call('GET', `/api/file?path=${enc(r.body.path)}`)).body.document.content[0]), /기획 폴더에 그대로/);
    assert.match(told(d, lead.id), /영역을 정할 수 없어 기획 폴더에 그대로 뒀다/);
    // Two files in web and one in server: web wins.
    const steps2 = [...steps, { title: 'c', role: 'review', files: ['web/c.ts'] }];
    const lead2 = (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan' }], worktree: false })).body.sessions[0];
    await until(() => ['idle', 'done'].includes(d.hub.get(lead2.id).status), 10_000);
    const w2 = (await call('POST', '/api/pipeline/plan', { lead: lead2.id, title: '웹 위주', goal: 'x', steps: steps2 })).body;
    assert.equal(w2.area, 'web');
    assert.equal((await call('POST', '/api/pipeline/start', { path: w2.path, revision: w2.revision })).body.path, 'web/웹-위주/계획.dpx.json');
  } finally {
    await t.stop();
  }
});

test('two 시작하기 at once start one run; a failed hand-off to the lead moves the plan back to 기획', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, ws } = t;
    const w = (await plan(t, { title: '동시' })).body;
    const both = await Promise.all([go(t, w), go(t, w)]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    const ok = both.find((r) => r.status === 200).body;
    assert.equal(ok.path, 'App/동시/계획.dpx.json');
    assert.equal(Object.values(d.store.data.pipelines).filter((e) => e.runId === ok.runId).length, 1);

    // The lead cannot be told: nothing started, and the plan is back where it was.
    const lead2 = (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan' }], worktree: false, folder: 'App' })).body.sessions[0];
    await until(() => ['idle', 'done'].includes(d.hub.get(lead2.id).status), 10_000);
    const w2 = (await call('POST', '/api/pipeline/plan', { lead: lead2.id, title: '되돌림', goal: 'x', steps: STEPS })).body;
    const send = d.hub.send;
    d.hub.send = () => {
      throw new Error('관리자에게 보내지 못했어요');
    };
    try {
      const r = await go(t, w2);
      assert.equal(r.status, 409);
    } finally {
      d.hub.send = send;
    }
    assert.ok(existsSync(join(ws, w2.path)) && !existsSync(join(ws, 'App', '되돌림')));
    assert.equal(d.store.data.pipelines[w2.path]?.state, 'plan');
    assert.equal(d.store.data.pipelines['App/되돌림/계획.dpx.json'], undefined);
  } finally {
    await t.stop();
  }
});

test('two plans sharing a feature folder: 시작하기 leaves the folder in 기획 and the other plan untouched', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    const a = (await plan(t, { title: '공유' })).body;
    assert.equal(a.path, '기획/공유/계획.dpx.json');
    const lead2 = (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan' }], worktree: false, folder: 'App' })).body.sessions[0];
    await until(() => ['idle', 'done'].includes(d.hub.get(lead2.id).status), 10_000);
    const b = (await call('POST', '/api/pipeline/plan', { lead: lead2.id, title: '공유', goal: 'x', steps: STEPS })).body;
    assert.equal(b.path, '기획/공유/계획-2.dpx.json');
    const r = await go(t, a);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, a.path);
    assert.ok(existsSync(join(ws, a.path)) && existsSync(join(ws, b.path)) && !existsSync(join(ws, 'App', '공유')));
    assert.equal(d.store.data.pipelines[a.path].state, 'running');
    assert.equal(d.store.data.pipelines[b.path].state, 'plan');
    assert.equal(d.store.data.pipelines[b.path].lead, lead2.id);
    assert.match(told(d, lead.id), /같은 기능 폴더에 다른 계획\(계획-2\.dpx\.json\)이 있어 폴더를 옮기지 않고/);
  } finally {
    await t.stop();
  }
});

test('write_plan keeps titles short: a default from the goal is cut at 20 characters, a long title gets a warning', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, ws } = t;
    const w = (await plan(t, { goal: 'PLC 데이터 수신 후 로봇 제어 웹 페이지를 만들어요' })).body;
    assert.equal(w.path, '기획/PLC-데이터-수신-후-로봇-제어-웹/계획.dpx.json');
    assert.equal((await call('GET', `/api/file?path=${enc(w.path)}`)).body.title, 'PLC 데이터 수신 후 로봇 제어 웹');
    assert.equal(w.warnings, undefined);
    const t2 = await start();
    try {
      const long = (await plan(t2, { title: 'PLC 데이터 수신 후 로봇 제어 웹 페이지' })).body;
      assert.equal(long.state, 'plan');
      assert.match(long.warnings.join('|'), /제목이 24자예요\. 20자 안으로/);
      assert.equal(long.path, '기획/PLC-데이터-수신-후-로봇-제어-웹/계획.dpx.json');
      assert.ok(existsSync(join(t2.ws, long.path)));
    } finally {
      await t2.stop();
    }
    assert.ok(existsSync(join(ws, w.path)));
  } finally {
    await t.stop();
  }
});
