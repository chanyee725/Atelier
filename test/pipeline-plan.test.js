// Plans and approval (E20): write_plan, the create_sessions gate, 시작하기, set_task.step and note_step.
// Runs against a scratch git repo with one commit in a temp dir; agent sessions use the fake CLIs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { until } from './fixtures/fake-cli/index.mjs';
import { start, STEPS } from './helpers/pipeline-app.mjs';

test('write_plan writes a draft, gates create_sessions, and 시작하기 hands the approved revision to the lead', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead, ws } = t;
    // Bad input is refused with a plain reason and writes nothing.
    const bad = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '', steps: STEPS });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /goal/);
    // Only a lead may write a plan.
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: 'nobody', goal: 'x', steps: STEPS })).status, 400);

    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '로그인 개편', goal: '매직 링크로 로그인해요', steps: STEPS, risks: ['쿠키 이름이 바뀌어요'] });
    const asked = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: 'x', steps: STEPS, asks: ['q?'] });
    assert.equal(asked.status, 400);
    assert.match(asked.body.error, /discussions/);
    assert.equal(w.status, 200, JSON.stringify(w.body));
    // A new plan is drafted in 기획 (#1045); its area is the lead's (no step file is in a workspace folder).
    assert.equal(w.body.path, '기획/로그인-개편/계획.dpx.json');
    assert.equal(w.body.area, 'App');
    assert.equal(w.body.state, 'plan');
    const file = JSON.parse(readFileSync(join(ws, w.body.path), 'utf8'));
    assert.deepEqual(file.plan.steps.map((s) => s.id), ['api', 'ui', 'review']);
    assert.equal(file.blocks[0].id, file.plan.block);
    assert.equal(file.blocks[0].type, 'flowchart');

    // Status: in plan, nothing blocks, 3 sessions; the draft has no changes yet.
    let st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.deepEqual(st.body.blockers, []);
    assert.equal(st.body.sessions, 3);
    assert.deepEqual(st.body.changes, []);

    // The gate: no teammates before approval.
    const gated = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'x' }], worktree: false, parent: lead.id });
    assert.equal(gated.status, 409);
    assert.match(gated.body.error, /계획 승인 전이에요/);
    // set_task with a step needs a running plan.
    const early = await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api' });
    assert.equal(early.status, 409);

    // The person edits the plan (model of one step), so the start shows the change.
    const cur = (await call('GET', `/api/file?path=${encodeURIComponent(w.body.path)}`)).body;
    cur.plan.steps[1].model = 'claude-sonnet-5-5';
    const saved = await call('PUT', `/api/file?path=${encodeURIComponent(w.body.path)}`, { ...cur });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.deepEqual(st.body.changes, ['단계 ui 모델 claude-fable-5-2 → claude-sonnet-5-5']);
    // Any known model runs as named (#587).
    assert.deepEqual(st.body.blockers, []);

    // A stale revision is refused; the current one starts.
    const stale = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: w.body.revision });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.revision, saved.body.revision);
    // The refused start did not start anything: still a plan, no run, lead not told.
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.equal(st.body.runId, null);
    assert.doesNotMatch(d.hub.transcript(lead.id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n'), /계획 승인/);
    const go = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: saved.body.revision });
    assert.equal(go.status, 200, JSON.stringify(go.body));
    assert.equal(go.body.state, 'running');
    assert.ok(go.body.runId);
    // 시작하기 moved the feature folder to the area; the plan's state went with it.
    const moved = 'App/로그인-개편/계획.dpx.json';
    assert.equal(go.body.path, moved);
    assert.ok(existsSync(join(ws, moved)) && !existsSync(join(ws, '기획', '로그인-개편')));
    assert.equal(d.store.data.pipelines[moved]?.state, 'running');
    assert.equal(d.store.data.pipelines[w.body.path], undefined);
    const told = d.hub.transcript(lead.id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n');
    assert.match(told, new RegExp(`\\[계획 승인 · rev ${saved.body.revision}\\]`));
    assert.match(told, /단계 ui 모델/);
    assert.match(told, /계획 폴더를 기획\/로그인-개편에서 App\/로그인-개편로 옮겼다/);
    assert.equal((await call('POST', '/api/pipeline/start', { path: moved, revision: saved.body.revision })).status, 409);
    // Running plans are not rewritten.
    assert.equal((await call('POST', '/api/pipeline/plan', { lead: lead.id, path: moved, goal: 'x', steps: STEPS })).status, 409);

    // After approval: teammates, tasks tied to steps, notes.
    await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
    const made = await call('POST', '/api/sessions', { items: [{ role: 'impl', task: 'api' }], worktree: false, parent: lead.id });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const mate = made.body.sessions[0];
    assert.equal((await call('POST', '/api/tasks', { lead: lead.id, title: '없는 단계', step: 'nope' })).status, 409);
    const task = await call('POST', '/api/tasks', { lead: lead.id, title: '서버 API', step: 'api', owner: mate.name, stage: 'impl' });
    assert.equal(task.status, 200, JSON.stringify(task.body));
    assert.equal(task.body.step, 'api');
    const noted = await call('POST', '/api/pipeline/note', { lead: lead.id, step: 'api', text: '  리뷰 must-fix 1건\n고쳐서 다시 올림 ' });
    assert.equal(noted.status, 200, JSON.stringify(noted.body));
    assert.equal(noted.body.note, '리뷰 must-fix 1건 고쳐서 다시 올림');
    assert.equal((await call('POST', '/api/pipeline/note', { lead: lead.id, step: 'nope', text: 'x' })).status, 409);

    // The teammate's session lands in the run record under its step (metadata only).
    const runId = go.body.runId;
    await until(() => t.app.ctx.modules.pipeline && d.store.data.pipelines[moved].links[mate.id] === 'api', 10_000);
    await t.app.ctx.modules.runs.recorder.endRun(runId, 'done');
    const rec = (await call('GET', `/api/runs/run?path=${encodeURIComponent(moved)}&id=${runId}`)).body;
    assert.equal(rec.file, moved);
    assert.equal(rec.steps.api.note, '리뷰 must-fix 1건 고쳐서 다시 올림');
    assert.equal(rec.steps.api.sessions[0].sid, mate.id);
    assert.equal(rec.steps.api.sessions[0].name, mate.name);
    assert.equal(rec.plan.revision, saved.body.revision);
  } finally {
    await t.stop();
  }
});

test('the 알림함 lists plans that wait for 시작하기 until they start, are reopened or deleted (#786)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, lead } = t;
    const waiting = async () => (await call('GET', '/api/pipeline/waiting')).body.plans;
    assert.deepEqual(await waiting(), []);
    const a = (await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '가', goal: 'x', steps: STEPS })).body;
    const b = (await call('POST', '/api/pipeline/plan', { lead: lead.id, path: '결제/나', title: '나', goal: 'y', steps: STEPS })).body;
    let list = await waiting();
    assert.deepEqual(list.map((p) => p.path).sort(), [a.path, b.path].sort());
    const first = list.find((p) => p.path === a.path);
    assert.equal(first.title, '가');
    assert.equal(first.lead, lead.name);
    assert.equal(typeof first.since, 'number');
    // Started: gone. Paused and reopened by the person: still gone.
    const started = await call('POST', '/api/pipeline/start', { path: a.path, revision: a.revision });
    assert.equal(started.status, 200);
    assert.deepEqual((await waiting()).map((p) => p.path), [b.path]);
    // 시작하기 moved it out of 기획 (#1045).
    assert.equal(started.body.path, 'App/가/계획.dpx.json');
    assert.equal((await call('POST', '/api/pipeline/stop', { path: started.body.path })).status, 200);
    assert.equal((await call('POST', '/api/pipeline/reopen', { path: started.body.path })).status, 200);
    assert.deepEqual((await waiting()).map((p) => p.path), [b.path]);
    // Deleted: gone.
    assert.equal((await call('DELETE', `/api/file?path=${encodeURIComponent(b.path)}`)).status, 200);
    assert.deepEqual(await waiting(), []);
  } finally {
    await t.stop();
  }
});

test('the dashboard 승인 대기 card gets revision, blockers and a gone lead, and 정리 drops such a plan (#836)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, lead, d } = t;
    const waiting = async () => (await call('GET', '/api/pipeline/waiting')).body.plans;
    const a = (await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '가', goal: 'x', steps: STEPS })).body;
    let [p] = await waiting();
    assert.equal(p.revision, a.revision);
    assert.deepEqual(p.blockers, []);
    assert.equal(p.leadGone, false);
    // 정리 is only for a plan whose lead is gone.
    assert.equal((await call('POST', '/api/pipeline/dismiss', { path: a.path })).status, 409);
    d.hub.remove(lead.id);
    [p] = await waiting();
    assert.equal(p.leadGone, true);
    assert.equal(p.lead, null);
    assert.ok(p.blockers.includes('계획을 쓴 관리자 세션이 없어요'));
    const gone = await call('POST', '/api/pipeline/dismiss', { path: a.path });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.deepEqual(await waiting(), []);
    // The document stays.
    assert.equal((await call('GET', `/api/pipeline?path=${encodeURIComponent(a.path)}`)).status, 200);
  } finally {
    await t.stop();
  }
});

test('blockers: unknown role, cycle, no lead; moving the file keeps its approval state', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead } = t;
    // write_plan refuses an unknown role with the valid list and maps common aliases (#788).
    const unknown = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '순환', steps: [{ id: 'a', title: 'A', role: 'nobody' }] });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /역할 "nobody"을 몰라요\. 쓸 수 있는 역할: .*impl, review/);
    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '순환', steps: [{ id: 'a', title: 'A', role: 'implementer' }, { id: 'b', title: 'B', role: 'reviewer', after: ['a'] }] });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual(JSON.parse(readFileSync(join(t.ws, w.body.path), 'utf8')).plan.steps.map((s) => s.role), ['impl', 'review']);
    let st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.deepEqual(st.body.blockers, []);

    // Writing again without a path revises the same draft.
    const again = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '순환', steps: [{ id: 'a', title: 'A', role: 'impl', after: ['b'] }, { id: 'b', title: 'B', role: 'impl', after: ['a'] }] });
    assert.equal(again.body.path, w.body.path);
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(w.body.path)}`);
    assert.match(st.body.blockers.join('|'), /서로를 기다려요/);
    assert.deepEqual(st.body.changes, []);

    // A file nobody's lead wrote cannot start.
    const plain = await call('POST', '/api/file', { path: 'plans/hand', plan: { v: 1, block: 'b1', steps: [{ id: 's', node: 's', role: 'nobody' }] }, blocks: [{ id: 'b1', type: 'flowchart', code: 's', x: 0, y: 0, w: 0, h: 0 }] });
    assert.equal(plain.status, 201, JSON.stringify(plain.body));
    st = await call('GET', `/api/pipeline?path=${encodeURIComponent(plain.body.path)}`);
    assert.equal(st.body.state, 'plan');
    assert.match(st.body.blockers.join('|'), /관리자가 쓴 계획이 아니에요/);
    assert.match(st.body.blockers.join('|'), /역할 "nobody"을 몰라요/);
    const refused = await call('POST', '/api/pipeline/start', { path: plain.body.path, revision: plain.body.revision });
    assert.equal(refused.status, 409);
    assert.ok(refused.body.blockers.length);

    // Move: the approval state follows the file.
    const mv = await call('POST', '/api/move', { from: w.body.path, to: 'done/cycle.dpx.json', type: 'file' });
    assert.equal(mv.status, 200, JSON.stringify(mv.body));
    assert.equal(d.store.data.pipelines['done/cycle.dpx.json']?.lead, lead.id);
    assert.equal(d.store.data.pipelines[w.body.path], undefined);
  } finally {
    await t.stop();
  }
});

test('a one-step plan with autostart starts at once', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, lead } = t;
    const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '오타 고치기', steps: [{ title: '오타', role: 'impl', model: 'claude-fable-5-2' }], autostart: true });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.equal(w.body.state, 'running');
    assert.ok(w.body.runId);
    // Two steps with autostart stay a draft.
    const two = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '둘', steps: [{ title: 'a', role: 'impl' }, { title: 'b', role: 'impl' }], autostart: true });
    assert.equal(two.body.state, 'plan');
  } finally {
    await t.stop();
  }
});

test('a new plan is drafted in 기획/<feature>/ with its area: the one write_plan names, else the steps\', else the lead\'s (#782, #1045)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, ws } = t;
    mkdirSync(join(ws, 'Proj'));
    mkdirSync(join(ws, 'Other'));
    const fresh = async () => {
      const s = (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan it' }], worktree: false })).body.sessions[0];
      await until(() => ['idle', 'done'].includes(d.hub.get(s.id).status), 10_000);
      return s;
    };
    const one = [{ title: 'a', role: 'impl', files: ['Proj/doc.dpx.json'] }];
    // Area or feature names that are not one plain folder are refused and write nothing, even with a path.
    for (const [key, bad] of [['area', '../x'], ['area', 'Proj/sub'], ['area', '.drawing'], ['area', '..'], ['area', 'worktrees'], ['feature', 'a/b'], ['feature', '..'], ['feature', '.hidden'], ['feature', 'x\\y'], ['folder', '../x'], ['area', 'a\u0000b']]) {
      const r = await call('POST', '/api/pipeline/plan', { lead: t.lead.id, [key]: bad, goal: '틀린 폴더', steps: one });
      assert.equal(r.status, 400, `${key}=${bad}`);
      assert.match(r.body.error, /폴더 하나/);
      const withPath = await call('POST', '/api/pipeline/plan', { lead: t.lead.id, path: 'Proj/ok', [key]: bad, goal: 'x', steps: one });
      assert.equal(withPath.status, 400, `${key}=${bad} with path`);
    }
    assert.ok(!existsSync(join(ws, 'x')) && !existsSync(join(ws, 'worktrees')) && !existsSync(join(ws, 'Proj', 'ok.dpx.json')));
    // A new plan is drafted in 기획/<feature>/ (#1045). The named area and feature win; the area is only recorded
    // (made on 시작하기), and the lead does not move to 기획.
    const named = await call('POST', '/api/pipeline/plan', { lead: t.lead.id, area: 'Server', feature: '단일-폴더-저장', title: '이름 붙인 계획', goal: 'x', steps: one });
    assert.equal(named.status, 200, JSON.stringify(named.body));
    assert.equal(named.body.path, '기획/단일-폴더-저장/계획.dpx.json');
    assert.equal(named.body.area, 'Server');
    assert.equal(d.store.data.pipelines[named.body.path].area, 'Server');
    assert.ok(!existsSync(join(ws, 'Server')));
    assert.equal(d.hub.get(t.lead.id).folder, 'App');
    // A second plan for the same feature (another lead) gets 계획-2; the older `folder` still names the area.
    const lead1 = await fresh();
    const again = await call('POST', '/api/pipeline/plan', { lead: lead1.id, folder: 'Server', feature: '단일-폴더-저장', goal: 'x', steps: one });
    assert.equal(again.body.path, '기획/단일-폴더-저장/계획-2.dpx.json');
    assert.equal(again.body.area, 'Server');
    // A path that differs from an existing folder only in letter case reuses that folder (#1026).
    mkdirSync(join(ws, 'Server'));
    const lead5 = await fresh();
    const byPath = await call('POST', '/api/pipeline/plan', { lead: lead5.id, path: 'SERVER/경로-계획', goal: 'x', steps: one });
    assert.equal(byPath.body.path, 'Server/경로-계획.dpx.json', JSON.stringify(byPath.body));
    assert.ok(!existsSync(join(ws, 'SERVER')));
    // No area and a lead without one: the folder most step files sit in; the feature defaults to the title.
    const lead2 = await fresh();
    const inferred = await call('POST', '/api/pipeline/plan', { lead: lead2.id, title: '추론', goal: 'x', steps: [...one, { title: 'b', role: 'impl', files: ['./Proj/x/y.dpx.json'] }, { title: 'c', role: 'review', files: ['Other/z.dpx.json'] }] });
    assert.equal(inferred.body.path, '기획/추론/계획.dpx.json');
    assert.equal(inferred.body.area, 'Proj');
    // A tie and no area of the lead's: written to 기획 anyway, with a line at the top saying it stays there.
    const lead3 = await fresh();
    const mixed = await call('POST', '/api/pipeline/plan', { lead: lead3.id, title: '섞임', goal: 'x', steps: [...one, { title: 'b', role: 'impl', files: ['Other/z.dpx.json'] }] });
    assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
    assert.equal(mixed.body.path, '기획/섞임/계획.dpx.json');
    assert.equal(mixed.body.area, null);
    const doc = JSON.parse(readFileSync(join(ws, mixed.body.path), 'utf8')).document;
    assert.match(JSON.stringify(doc.content[0]), /기획 폴더에 그대로 있어요/);
    assert.doesNotMatch(readFileSync(join(ws, inferred.body.path), 'utf8'), /그대로 있어요/);
  } finally {
    await t.stop();
  }
});

test('시작하기 takes per-step overrides for this run only (#972)', { timeout: 60_000 }, async () => {
  const t = await start();
  try {
    const { call, d, lead } = t;
    const w = (await call('POST', '/api/pipeline/plan', { lead: lead.id, title: '덮어쓰기', goal: 'x', steps: STEPS })).body;
    const go = (overrides) => call('POST', '/api/pipeline/start', { path: w.path, revision: w.revision, overrides });
    // Bad shapes and unknown steps are refused and start nothing.
    assert.equal((await go({ nope: { n: 2 } })).status, 400);
    assert.equal((await go({ ui: { n: 9 } })).status, 400);
    assert.equal((await go({ ui: { perm: 'bypassPermissions' } })).status, 400);
    assert.equal((await go({ ui: { color: 'red' } })).status, 400);
    assert.equal((await go('x')).status, 400);
    // A model of a provider that is not connected blocks like a plan with that model would.
    const blocked = await go({ ui: { model: 'gpt-5' } });
    assert.equal(blocked.status, 409);
    assert.equal((await call('GET', `/api/pipeline?path=${encodeURIComponent(w.path)}`)).body.state, 'plan');
    // Accepted: the lead is told what changed; the file keeps the approved plan.
    const ok = await go({ review: { model: 'claude-sonnet-5-5', n: 2 }, ui: { effort: 'low' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.overrides.some((c) => /review/.test(c)));
    const told = d.hub.transcript(lead.id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n');
    assert.match(told, /시작 창에서 사용자가 이번 실행만 바꾼 구성/);
    assert.match(told, /단계 review 모델 claude-fable-5-2 → claude-sonnet-5-5/);
    const file = (await call('GET', `/api/file?path=${encodeURIComponent(ok.body.path)}`)).body;
    assert.equal(file.plan.steps.find((s) => s.id === 'review').model, 'claude-fable-5-2');
  } finally {
    await t.stop();
  }
});
