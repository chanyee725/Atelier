// Shared by the pipeline test files: a server on a scratch git repo (one commit, temp dir) with the fake CLIs,
// a lead session, a sample plan and a started run.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as runs from '../../server/runs/index.js';
import * as dispatch from '../../server/dispatch/index.js';
import * as pipeline from '../../server/pipeline/index.js';
import { fakeCliBin, fakeSpawner, until } from '../fixtures/fake-cli/index.mjs';

export const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

export function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e20-'));
  dirs.push(root);
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'ws');
  mkdirSync(ws);
  return { root, ws };
}

/** A server on a fresh scratch repo, or with `again`, a restart on the same repo, workspace and fake CLIs. */
export async function start(again = null) {
  const { root, ws } = again ?? scratchRepo();
  const bin = again?.bin ?? fakeCliBin();
  if (!again) dirs.push(bin.dir);
  const p = { installed: true, connected: true, busy: false, url: null, error: null };
  const deps = {
    limitsFile: join(root, 'limits.json'),
    providerStatus: async () => ({ claude: { ...p }, openai: { ...p, connected: false }, gemini: { ...p, connected: false } }),
    codexModels: async () => [],
    login: () => {},
    logout: async () => {},
    cancelLogin: () => {},
    spawnCli: fakeSpawner(bin),
  };
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'runs', setup: runs.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, deps) },
    { name: 'pipeline', setup: pipeline.setup },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e20-pub-'));
  dirs.push(pub);
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const W = { 'content-type': 'application/json', 'x-drawing': '1' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: method === 'GET' ? {} : W, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  // Connect Claude the way the UI does (the CLI reports itself logged in).
  assert.equal((await call('POST', '/api/providers/claude/login')).body.connected, true);
  const d = app.ctx.modules.dispatch;
  // The lead works for area App, so its plans go to App/<feature>/계획.dpx.json (#782).
  if (!again) mkdirSync(join(ws, 'App'), { recursive: true });
  const lead = again?.lead ?? (await call('POST', '/api/sessions', { items: [{ role: 'lead', task: 'plan it' }], worktree: false, folder: 'App' })).body.sessions[0];
  if (!again) await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
  return { app, call, d, lead, root, ws, bin, stop: () => app.close() };
}

export const STEPS = [
  { id: 'api', title: '서버 API', role: 'impl', model: 'claude-fable-5-2', done: 'auth.test 통과', files: ['server/auth.js'] },
  { id: 'ui', title: '로그인 화면', role: 'impl', model: 'claude-fable-5-2' },
  { id: 'review', title: '리뷰', role: 'review', model: 'claude-fable-5-2', after: ['api', 'ui'] },
];

export async function running(t, steps = STEPS) {
  const { call, d, lead } = t;
  const w = await call('POST', '/api/pipeline/plan', { lead: lead.id, goal: '멈춤 연습', steps });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const go = await call('POST', '/api/pipeline/start', { path: w.body.path, revision: w.body.revision });
  assert.equal(go.status, 200, JSON.stringify(go.body));
  await until(() => ['idle', 'done'].includes(d.hub.get(lead.id).status), 10_000);
  // 시작하기 moves a draft from 기획 to its area (#1045): the running plan lives at the path start returns.
  return { path: go.body.path, runId: go.body.runId };
}
export const told = (d, id) => d.hub.transcript(id).filter((m) => m.kind === 'user').map((m) => m.text).join('\n');
export const statusOf = async (call, path) => (await call('GET', `/api/pipeline?path=${encodeURIComponent(path)}`)).body;
