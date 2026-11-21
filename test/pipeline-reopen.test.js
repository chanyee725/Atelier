// E28: 계획 다시 열기 carries finished steps over (also across restarts), and 완료 ends the run.
// Runs against a scratch git repo with one commit in a temp dir; agent sessions use the fake CLIs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { until } from './fixtures/fake-cli/index.mjs';
import { start, STEPS, running, told, statusOf } from './helpers/pipeline-app.mjs';

test('계획 다시 열기 ends the stopped run and the next 시작하기 carries the finished steps over', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal((await call('POST', '/api/pipeline/reopen', { path })).status, 409); // running: stop first
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' });
    await until(() => d.store.data.pipelines[path].links[mate.id] === 'api', 10_000);
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);

    const re = await call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.state, 'plan');
    assert.equal(re.body.runId, null);
    assert.deepEqual(re.body.changes, []);
    assert.match(told(d, lead.id), /\[계획 다시 열림\][^]*이미 끝난 단계: api/);
    // The revision started before stays known (#729): the 플랜 tab asks to approve the revision anew.
    const approvedBefore = d.store.data.pipelines[path].lastApprovedRevision;
    assert.ok(Number.isInteger(approvedBefore));
    assert.equal(re.body.lastApprovedRevision, approvedBefore);
    const old = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(old.state, 'stopped');
    // A plan again: no teammates until 시작하기; the lead may revise it and the carry survives.
    assert.equal((await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id })).status, 409);
    const rev = await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: '멈춤 연습 2', steps: STEPS });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    assert.equal((await call('GET', `/api/pipeline?path=${encodeURIComponent(path)}`)).body.lastApprovedRevision, approvedBefore);

    const go = await call('POST', '/api/pipeline/start', { path, revision: rev.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.notEqual(go.body.runId, runId);
    // The task board speaks again (a merge check, another set_task): the mate that finished api does not relink to
    // the new run through its old, closed task (E205); the carried step keeps the sessions it ran with.
    d.hub.emit('tasks', d.hub.tasks);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    const next = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    assert.equal(next.steps.api.state, 'done');
    assert.equal(next.steps.api.carried, runId);
    assert.equal(next.steps.api.sessions[0].sid, mate.id);
    assert.notEqual(next.steps.api.sessions[0].cost, 7.5);
    assert.equal(next.steps.ui.state, 'pending');

    // The lead reopens that old, closed task (same id, same carried step) and closes it again in this run: the mate
    // still does not link to the carried step, so nothing new lands there (E206).
    const oldApi = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api');
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, stage: 'impl' })).status, 200);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, commit: head, stage: 'done' })).status, 200);
    await until(() => d.hub.tasks.find((x) => x.id === oldApi.id)?.stage === 'done', 10_000);
    d.hub.emit('session', { ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5 });
    assert.equal(d.store.data.pipelines[path].links[mate.id], undefined);
    const still = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.deepEqual(still.steps.api.sessions, next.steps.api.sessions);

    // The lead reuses that mate for new work: its session links to the new step, and its cost and tokens land there,
    // not on the carried step.
    const carriedApi = next.steps.api.sessions[0];
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', owner: mate.name, stage: 'impl' });
    await until(() => d.store.data.pipelines[path].links[mate.id] === 'ui', 10_000);
    // Its new turn's numbers, kept on the session so the fake CLI's own events carry the same ones.
    await until(() => ['idle', 'done'].includes(d.hub.get(mate.id).status), 10_000);
    Object.assign(d.hub.get(mate.id), { cost: 7.5, usage: { input: 1234, output: 56 } });
    d.hub.emit('session', d.hub.publicSession(d.hub.get(mate.id)));
    await until(async () => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body.steps.ui.sessions[0]?.cost === 7.5, 10_000);
    const reused = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(reused.steps.ui.sessions[0].sid, mate.id);
    assert.deepEqual(reused.steps.ui.sessions[0].tokens, { input: 1234, output: 56 });
    assert.deepEqual(reused.steps.api.sessions, [carriedApi]);
    assert.equal(reused.steps.api.state, 'done');
    assert.match(told(d, lead.id), /지난 실행에서 끝난 단계\(다시 하지 마라\): api/);
    assert.equal(d.store.data.pipelines[path].carry, undefined);

    // The rest closes: the run ends done and the carried step keeps how the earlier run merged it.
    for (const [step, title] of [['ui', '로그인 화면'], ['review', '리뷰']]) {
      await call('POST', '/api/tasks', { lead: lead.id, title, step, commit: head, stage: 'done' });
    }
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const fin = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(fin.state, 'done');
    assert.equal(fin.steps.api.result?.commit, head);
    await until(() => JSON.parse(readFileSync(join(t.ws, path), 'utf8')).document.content[0]?.attrs?.id === 'run-summary', 10_000);
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기 twice keeps what the first run finished and how it merged (E28)', { timeout: 90_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId: a } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const merged = (step) => until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === step && x.commit)?.mergeCheck?.ok === true, 10_000);
    const runOf = async (id) => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${id}`)).body;
    const reopenAndStart = async () => {
      assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
      const re = await call('POST', '/api/pipeline/reopen', { path });
      assert.equal(re.status, 200, JSON.stringify(re.body));
      const go = await call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
      assert.equal(go.status, 200, JSON.stringify(go.body));
      return go.body.runId;
    };

    // Run A merges api.
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await merged('api');
    const b = await reopenAndStart();
    assert.equal((await runOf(b)).steps.api.carried, a);

    // Run B merges ui and closes api again without a commit: the earlier merge stays.
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', commit: head, stage: 'done' });
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 다시', step: 'api', stage: 'done' });
    await merged('ui');
    const c = await reopenAndStart();
    assert.match(told(d, lead.id), /이미 끝난 단계: api, ui/);
    assert.match(told(d, lead.id), /지난 실행에서 끝난 단계\(다시 하지 마라\): api, ui/);
    const runC = await runOf(c);
    for (const id of ['api', 'ui']) {
      assert.equal(runC.steps[id].state, 'done', id);
      assert.equal(runC.steps[id].carried, b, id);
      assert.deepEqual(runC.steps[id].result, { commit: head, base: 'develop' }, id);
    }
    assert.equal(runC.steps.review.state, 'pending');

    // Run C closes review: both carried steps count as merged in the record.
    await call('POST', '/api/tasks', { lead: lead.id, title: '리뷰', step: 'review', commit: head, stage: 'done' });
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const fin = await runOf(c);
    assert.equal(fin.steps.api.result.commit, head);
    assert.equal(fin.steps.ui.result.commit, head);
    assert.equal(fin.steps.api.state, 'done');
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기, then a server restart: the next 시작하기 still carries the finished steps and how they merged (E28)', { timeout: 90_000 }, async () => {
  let t = await start();
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
    const re = await call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));

    // Restart on the same workspace: the carry is kept on disk, not only in memory.
    await t.stop();
    t = await start(t);
    const reopened = await statusOf(t.call, path);
    assert.equal(reopened.state, 'plan');
    const go = await t.call('POST', '/api/pipeline/start', { path, revision: reopened.draftRevision ?? reopened.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    const next = (await t.call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    assert.equal(next.steps.api.state, 'done');
    assert.equal(next.steps.api.carried, runId);
    assert.deepEqual(next.steps.api.result, { commit: head, base: 'develop' });
    assert.equal(next.steps.ui.state, 'pending');
    assert.equal(t.d.store.data.pipelines[path].carry, undefined);
  } finally {
    await t.stop();
  }
});

test('a paused run with a carried step, then a server restart: its reopened old task links nothing and costs nothing there (E206d)', { timeout: 90_000 }, async () => {
  let t = await start();
  try {
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', t.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const mate = (await t.call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: t.lead.id })).body.sessions[0];
    await t.call('POST', '/api/tasks', { lead: t.lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' });
    await until(() => t.d.store.data.pipelines[path].links[mate.id] === 'api', 10_000);
    await until(() => t.d.hub.tasks.find((x) => x.lead === t.lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    await until(() => ['idle', 'done'].includes(t.d.hub.get(mate.id).status), 10_000);
    assert.equal((await t.call('POST', '/api/pipeline/stop', { path })).status, 200);
    const re = await t.call('POST', '/api/pipeline/reopen', { path });
    assert.equal(re.status, 200, JSON.stringify(re.body));
    const go = await t.call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    const runOf = async () => (await t.call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${go.body.runId}`)).body;
    const before = await runOf();
    assert.equal(before.steps.api.carried, runId);
    assert.equal((await t.call('POST', '/api/pipeline/stop', { path })).status, 200);

    // Restart: the paused run is on disk only. The lead reopens the old api task before 이어서 하기.
    await t.stop();
    t = await start(t);
    const { call, d, lead } = t;
    assert.equal((await statusOf(call, path)).state, 'paused');
    const oldApi = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api');
    assert.ok(oldApi);
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, id: oldApi.id, stage: 'impl' })).status, 200);
    const sess = () => ({ ...d.hub.publicSession(d.hub.get(mate.id)), cost: 7.5, usage: { input: 1234, output: 56 } });
    d.hub.emit('session', sess());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.store.data.pipelines[path].links?.[mate.id], undefined);

    // 이어서 하기: the session reports again; nothing lands on the carried step.
    assert.equal((await call('POST', '/api/pipeline/resume', { path })).status, 200);
    d.hub.emit('session', sess());
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(d.store.data.pipelines[path].links?.[mate.id], undefined);
    // New work on a step this run did not carry still links that session.
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', owner: mate.name, stage: 'impl' });
    await until(() => d.store.data.pipelines[path].links?.[mate.id] === 'ui', 10_000);
    const after = await runOf();
    assert.deepEqual(after.steps.api.sessions, before.steps.api.sessions);
    assert.equal(after.steps.api.state, 'done');
  } finally {
    await t.stop();
  }
});

test('a carried step closed again with a new commit keeps the new commit (E28)', { timeout: 90_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, root } = t;
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
    const { path } = await running(t);
    const first = git('rev-parse', 'HEAD');
    const runOf = async (id) => (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${id}`)).body;
    const merged = (commit) => until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.commit === commit)?.mergeCheck?.ok === true, 10_000);
    const reopenAndStart = async () => {
      assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
      const re = await call('POST', '/api/pipeline/reopen', { path });
      assert.equal(re.status, 200, JSON.stringify(re.body));
      const go = await call('POST', '/api/pipeline/start', { path, revision: re.body.draftRevision ?? re.body.revision });
      assert.equal(go.status, 200, JSON.stringify(go.body));
      return go.body.runId;
    };

    // Run A merges api at the first commit.
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: first, stage: 'done' });
    await merged(first);
    const b = await reopenAndStart();
    assert.equal((await runOf(b)).steps.api.result.commit, first);

    // Run B closes the carried api step again at a newer commit on develop.
    writeFileSync(join(root, 'api.txt'), 'fix\n');
    git('add', 'api.txt');
    git('commit', '-qm', 'fix api');
    const second = git('rev-parse', 'HEAD');
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 다시', step: 'api', commit: second, stage: 'done' });
    await merged(second);
    const c = await reopenAndStart();
    const runC = await runOf(c);
    assert.equal(runC.steps.api.carried, b);
    assert.deepEqual(runC.steps.api.result, { commit: second, base: 'develop' });
    assert.equal(runC.steps.ui.state, 'pending');
  } finally {
    await t.stop();
  }
});

test('계획 다시 열기 logs (metadata only) when the run record cannot be read, and still reopens (E28)', { timeout: 90_000 }, async () => {
  let t = await start();
  const logged = [];
  const error = console.error;
  try {
    const { call, d, lead, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', commit: head, stage: 'done' });
    await until(() => d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'api')?.mergeCheck?.ok === true, 10_000);
    assert.equal((await call('POST', '/api/pipeline/stop', { path })).status, 200);
    // Restart so the paused run is no longer in memory, then lose its record on disk.
    await t.stop();
    t = await start(t);
    const files = readdirSync(t.ws, { recursive: true }).filter((f) => f.endsWith(`${runId}.json`));
    assert.equal(files.length, 1, JSON.stringify(files));
    rmSync(join(t.ws, files[0]));

    console.error = (...a) => logged.push(a.map(String).join(' '));
    const re = await t.call('POST', '/api/pipeline/reopen', { path });
    console.error = error;
    assert.equal(re.status, 200, JSON.stringify(re.body));
    assert.equal(re.body.state, 'plan');
    const line = logged.find((l) => l.startsWith('pipeline reopen record:'));
    assert.ok(line, JSON.stringify(logged));
    // Metadata only: an error code, never the plan path, run id or text.
    assert.equal(line.includes(path) || line.includes(runId), false, line);
  } finally {
    console.error = error;
    await t.stop();
  }
});

test('완료: closing every step ends the run done, writes the summary block once and labels the versions (E28)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws, root } = t;
    const { path, runId } = await running(t);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const mate = (await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id })).body.sessions[0];
    // api merged at a commit on develop, ui closed without a commit (abandoned), review still open.
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, commit: head, stage: 'done' })).status, 200);
    await call('POST', '/api/tasks', { lead: lead.id, title: '로그인 화면', step: 'ui', stage: 'done' });
    await call('POST', '/api/tasks', { lead: lead.id, title: '리뷰', step: 'review', stage: 'review' });
    assert.equal((await statusOf(call, path)).state, 'running');
    const review = d.hub.tasks.find((x) => x.lead === lead.id && x.step === 'review');
    await call('POST', '/api/tasks', { lead: lead.id, id: review.id, commit: head, stage: 'done' });
    await until(async () => (await statusOf(call, path)).state === 'done', 10_000);
    const st = await statusOf(call, path);
    assert.ok(st.doneAt > 0);
    assert.deepEqual(st.blockers, []);

    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(path)}&id=${runId}`)).body;
    assert.equal(rec.state, 'done');
    assert.equal(rec.steps.api.result.commit, head);
    assert.equal(rec.steps.api.result.base, 'develop');
    assert.deepEqual(rec.steps.ui.result, { abandoned: true });
    assert.equal(rec.steps.ui.state, 'skipped');

    // The summary block is first in the document, written once.
    await until(() => JSON.parse(readFileSync(join(ws, path), 'utf8')).document.content[0]?.attrs?.id === 'run-summary', 10_000);
    const file = JSON.parse(readFileSync(join(ws, path), 'utf8'));
    const text = JSON.stringify(file.document);
    assert.match(text, /✓ 완료/);
    assert.match(text, /그만둠/);
    assert.match(text, new RegExp(`develop ${head.slice(0, 7)}`));
    assert.equal(file.document.content.filter((n) => n.attrs?.id === 'run-summary').length, 1);
    // Metadata only: no session transcript text reaches the file.
    assert.doesNotMatch(text, /plan it/);

    // History: draft, approved and done versions are labelled.
    await until(async () => {
      const h = (await call('GET', `/api/history?path=${encodeURIComponent(path)}`)).body;
      return h.versions.some((v) => v.labels?.includes('done'));
    }, 10_000);
    const labels = (await call('GET', `/api/history?path=${encodeURIComponent(path)}`)).body.versions.flatMap((v) => v.labels ?? []);
    for (const l of ['draft', 'approved', 'done']) assert.ok(labels.includes(l), `label ${l}`);

    // A done plan does not run or change again.
    assert.equal((await call('POST', '/api/pipeline/start', { path, revision: file.revision })).status, 409);
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path, goal: 'again', steps: STEPS })).status, 409);

    // 복제해서 새 계획: a fresh draft next to it, same plan, no summary, owned by the same lead.
    const dup = await call('POST', '/api/pipeline/duplicate', { path });
    assert.equal(dup.status, 200, JSON.stringify(dup.body));
    assert.notEqual(dup.body.path, path);
    // The copy stays in the original's area and feature folder (#782).
    assert.equal(dup.body.path, `${path.slice(0, path.lastIndexOf('/'))}/계획-2.dpx.json`);
    assert.match(path, /^App\/[^/]+\/계획\.dpx\.json$/);
    assert.equal(dup.body.lead, lead.id);
    const copy = JSON.parse(readFileSync(join(ws, dup.body.path), 'utf8'));
    assert.deepEqual(copy.plan, file.plan);
    assert.equal(copy.document.content.filter((n) => n.attrs?.id === 'run-summary').length, 0);
    const cst = await statusOf(call, dup.body.path);
    assert.equal(cst.state, 'plan');
    assert.deepEqual(cst.blockers, []);

    // The copy runs on its own: the first run's closed tasks (same lead, same step ids) do not finish it.
    const st2 = await call('POST', '/api/pipeline/start', { path: dup.body.path, revision: dup.body.revision });
    assert.equal(st2.status, 200, JSON.stringify(st2.body));
    await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API 2', step: 'api', stage: 'impl' });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await statusOf(call, dup.body.path)).state, 'running');
    for (const [title, step] of [['서버 API 2', 'api'], ['로그인 화면 2', 'ui'], ['리뷰 2', 'review']]) {
      await call('POST', '/api/tasks', { lead: lead.id, title, step, stage: 'done' });
    }
    await until(async () => (await statusOf(call, dup.body.path)).state === 'done', 10_000);
    const rec2 = (await call('GET', `/api/runs/run?path=${encodeURIComponent(dup.body.path)}&id=${st2.body.runId}`)).body;
    for (const id of ['api', 'ui', 'review']) assert.deepEqual(rec2.steps[id].result, { abandoned: true }, id);
    assert.doesNotMatch(JSON.stringify(rec2), new RegExp(head));
    assert.equal((await call('POST', '/api/pipeline/duplicate', { path: 'nope.dpx.json' })).status, 404);
    assert.equal((await call('POST', '/api/pipeline/duplicate', {})).status, 400);
  } finally {
    await t.stop();
  }
});
