// E27: 멈추기, 이어서 하기, a trashed plan document and the limit guard.
// Runs against a scratch git repo with one commit in a temp dir; agent sessions use the fake CLIs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { until } from './fixtures/fake-cli/index.mjs';
import { start, STEPS, running, told, statusOf } from './helpers/pipeline-app.mjs';

test('멈추기 pauses the plan and holds the team; 이어서 하기 hands the open steps back to the lead', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    const { path, runId } = await running(t);
    assert.equal((await call('POST', '/api/pipeline/resume', { path })).status, 409);
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, stage: 'done' });
    await until(() => ['idle', 'done'].includes(d.hub.get(mate.id).status), 10_000);

    // No header, no stop.
    const base = `http://127.0.0.1:${t.app.server.address().port}`;
    const bare = await fetch(`${base}/api/pipeline/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
    assert.equal(bare.status, 403);

    const interrupted = [];
    const real = d.hub.interrupt.bind(d.hub);
    d.hub.interrupt = (id) => {
      interrupted.push(id);
      return real(id);
    };
    d.hub.get(mate.id).status = 'running'; // mid-turn, as far as the hub knows
    const stopped = await call('POST', '/api/pipeline/stop', { path });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.equal(stopped.body.state, 'paused');
    assert.equal(stopped.body.pause.by, 'stop');
    assert.deepEqual(interrupted, [mate.id]);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 409);
    const rec = JSON.parse(readFileSync(join(ws, '.drawing', 'runs', ...path.split('/'), `${runId}.json`), 'utf8'));
    assert.equal(rec.state, 'paused');
    assert.equal(rec.pause.by, 'stop');
    // Paused: no new teammates, no plan rewrite, and teammate reports wait.
    const gated = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id });
    assert.equal(gated.status, 409);
    assert.match(gated.body.error, /멈춰 있어요/);
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: 'x', steps: STEPS })).status, 409);
    d.hub.rt(mate.id).pendingReport = '[mate 보고] 끝';
    d.hub.deliverReport(d.hub.get(mate.id));
    assert.doesNotMatch(told(d, lead.id), /\[mate 보고\]/);

    const go = await call('POST', '/api/pipeline/resume', { path });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.equal(go.body.state, 'running');
    assert.equal(go.body.pause, null);
    const said = told(d, lead.id);
    assert.match(said, /\[계획 이어서 하기 · rev \d+\]/);
    assert.match(said, /끝나지 않은 단계: ui, review/);
    assert.match(said, /\[mate 보고\] 끝/);
    const live = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(live.state, 'running');
  } finally {
    await t.stop();
  }
});

test('a trashed plan document pauses its run, 멈추기 still works without the document, and a restart leaves no live lead (#775)', { timeout: 90_000 }, async () => {
  let t = await start();
  try {
    const { call, d, lead, ws } = t;
    const { path, runId } = await running(t);
    // Wait for the run record on disk: only a file with run records sends the trash event.
    await until(() => {
      try {
        return readdirSync(join(ws, '.drawing', 'runs', ...path.split('/'))).length > 0;
      } catch {
        return false;
      }
    }, 10_000);
    const del = await call('DELETE', `/api/file?path=${encodeURIComponent(path)}`);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    await until(() => d.store.data.pipelines[path]?.state === 'paused', 10_000);
    assert.equal(d.store.data.pipelines[path].pause.by, 'stop');

    // An entry left running before this fix: 멈추기 finds it by path although the document is in the trash.
    d.store.data.pipelines[path].state = 'running';
    const stopped = await call('POST', '/api/pipeline/stop', { path });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
    assert.equal(stopped.body.state, 'paused');
    assert.equal(stopped.body.runId, runId);

    // After a restart the lead has no process, so the folder-switch guard does not count its plan as running.
    d.store.data.pipelines[path].state = 'running';
    d.store.save();
    await t.stop();
    t = await start(t);
    assert.equal(t.d.hub.alive(lead.id), false);
    assert.equal(t.d.hub.alive('nobody'), false);
  } finally {
    await t.stop();
  }
});

test('the limit guard pauses a running plan and resumes it after the reset; 이어서 하기 waits for it', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead } = t;
    const pipe = t.app.ctx.modules.pipeline;
    const { path, runId } = await running(t);
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', stage: 'impl' });
    const resetAt = Date.now() + 60 * 60 * 1000;
    d.hub.limitHit = () => ({ key: 'five:x', reason: '5시간 한도 93%', resetAt });
    d.hub.checkTickets(); // saves the lead's open work as a ticket, like a real rate_limit_event
    await pipe.syncLimit();
    let st = await statusOf(call, path);
    assert.equal(st.state, 'paused');
    assert.equal(st.pause.by, 'limit');
    assert.equal(st.pause.resetAt, resetAt);
    assert.match(st.blockers[0], /한도에 걸려 있어요/);
    const refused = await call('POST', '/api/pipeline/resume', { path });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /한도에 걸려 있어요/);
    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(rec.state, 'paused');
    assert.deepEqual(Object.keys(rec.pause).sort(), ['at', 'by', 'resetAt']);

    // The window clears: one message to the lead (the ticket), carrying the plan's open steps.
    d.hub.limitHit = () => null;
    await pipe.syncLimit();
    st = await statusOf(call, path);
    assert.equal(st.state, 'running');
    const said = told(d, lead.id);
    assert.equal(said.match(/\[Dispatch 티켓 재개\]/g)?.length, 1);
    assert.match(said, /\[계획 이어서 하기 · rev \d+\][^\n]*\n끝나지 않은 단계: api, ui, review/);
    assert.equal(said.match(/\[계획 이어서 하기/g).length, 1);
    // A second look changes nothing.
    await pipe.syncLimit();
    assert.equal(told(d, lead.id).match(/\[계획 이어서 하기/g).length, 1);
  } finally {
    await t.stop();
  }
});
