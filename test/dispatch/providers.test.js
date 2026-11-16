// Model connection (E525, #570): the real auth.js against the fake `claude auth login|logout|status`.
// Contract: docs/design/model-connection-contract.md. Scratch git repo in a temp dir; no real claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.js';
import * as workspace from '../../server/workspace/index.js';
import * as dispatch from '../../server/dispatch/index.js';
import { fakeCliBin, until } from '../fixtures/fake-cli/index.mjs';

const W = { 'content-type': 'application/json', 'x-drawing': '1' };
const ORIGINAL = { ...process.env };
const fake = fakeCliBin();
after(() => { process.env = ORIGINAL; fake.cleanup(); });

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'drawing-e525-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(root, 'pipelines');
  mkdirSync(ws);
  return { root, ws };
}

/** Starts Drawing with the real provider code; `env` goes into process.env (the CLI seam reads it). */
async function start(env) {
  process.env = { ...ORIGINAL, ...env };
  const { root, ws } = scratchRepo();
  const moduleList = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: (ctx) => dispatch.setup(ctx, { limitsFile: join(root, 'limits.json') }) },
  ];
  const pub = mkdtempSync(join(tmpdir(), 'drawing-e525-pub-'));
  writeFileSync(join(pub, 'index.html'), '<!doctype html>');
  const app = await createApp({ workspaceDir: ws }, { publicDir: pub, moduleList });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body = {}) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: W, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const claude = async () => (await (await fetch(`${base}/api/state`)).json()).providers.claude;
  const stop = async () => {
    await app.close();
    rmSync(pub, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  };
  return { base, post, claude, stop, root };
}

const withFake = (dir, extra = {}) => ({
  PATH: `${fake.dir}:${ORIGINAL.PATH}`,
  FAKE_CLI_LOG: fake.log,
  FAKE_CLI_AUTH: join(dir, 'auth-state'),
  ...extra,
});

test('not checked before connect; login runs the CLI login, shows busy + URL, then connects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '400' }));
  try {
    const before = await s.claude();
    assert.equal(before.installed, null);
    assert.equal(before.connected, false);
    assert.equal(fake.calls().length, 0, 'no CLI before the user connects');

    // The SSE stream carries every providers change.
    const ac = new AbortController();
    const events = [];
    const sse = fetch(`${s.base}/api/events`, { signal: ac.signal }).then(async (res) => {
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        for (const m of dec.decode(chunk).matchAll(/event: providers\ndata: (.*)\n/g)) events.push(JSON.parse(m[1]));
      }
    }).catch(() => {});

    const res = await s.post('/api/providers/claude/login');
    assert.deepEqual(res.body, { ok: true, connected: false });
    const busy = await until(async () => { const p = await s.claude(); return p.busy && p.url ? p : null; });
    assert.equal(busy.url, 'https://login.example.invalid/oauth?fake=1');
    assert.equal(busy.installed, true);
    // A second login while busy starts nothing new.
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: false });

    const done = await until(async () => { const p = await s.claude(); return !p.busy && p.connected ? p : null; });
    assert.equal(done.error, null);
    assert.equal(done.url, null);
    assert.equal(done.cliLoggedIn, true);
    assert.equal(done.keySupported, false);
    assert.ok(!('proc' in done) && !('cancelled' in done));
    assert.equal(fake.calls().filter((c) => c.args.join(' ') === 'auth login').length, 1);

    await until(() => events.some((p) => p.claude.busy) && events.some((p) => p.claude.connected));
    ac.abort();
    await sse;
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel stops the login without an error; logout disconnects and reconnect is instant', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '10000' }));
  try {
    await s.post('/api/providers/claude/login');
    await until(async () => (await s.claude()).busy);
    assert.deepEqual((await s.post('/api/providers/claude/cancel')).body, { ok: true });
    const off = await until(async () => { const p = await s.claude(); return p.busy ? null : p; });
    assert.equal(off.error, null, 'a cancel is not an error');
    assert.equal(off.connected, false);
    assert.equal(off.url, null);
    // Cancel with nothing running is a no-op.
    assert.deepEqual((await s.post('/api/providers/claude/cancel')).body, { ok: true });

    // CLI logged in on the machine → connect at once, no browser login.
    writeFileSync(join(dir, 'auth-state'), 'fake\n');
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: true });
    assert.equal((await s.claude()).connected, true);

    // Disconnect from Drawing only: the CLI stays logged in.
    assert.deepEqual((await s.post('/api/providers/claude/logout')).body, { ok: true });
    const out = await s.claude();
    assert.equal(out.connected, false);
    assert.equal(out.cliLoggedIn, true);
    assert.deepEqual((await s.post('/api/providers/claude/login')).body, { ok: true, connected: true });

    // cli: true also logs the CLI out.
    await s.post('/api/providers/claude/logout', { cli: true });
    const gone = await s.claude();
    assert.equal(gone.connected, false);
    assert.equal(gone.cliLoggedIn, false);
    assert.ok(fake.calls().some((c) => c.args.join(' ') === 'auth logout'));
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed login shows an error and stays disconnected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawing-e525-auth-'));
  const s = await start(withFake(dir, { FAKE_CLI_LOGIN_MS: '50', FAKE_CLI_LOGIN_EXIT: '1' }));
  try {
    await s.post('/api/providers/claude/login');
    const p = await until(async () => { const c = await s.claude(); return c.error ? c : null; });
    assert.equal(p.busy, false);
    assert.equal(p.connected, false);
    assert.match(p.error, /로그인이 끝나지 않았어요/);
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude not installed: login answers 400 and installed turns false', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'drawing-e525-nobin-'));
  // git only: no fake (and the CLI seam refuses a real claude under test).
  const gitDir = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim().replace(/\/git$/, '');
  const s = await start({ PATH: `${empty}:${gitDir}` });
  try {
    const res = await s.post('/api/providers/claude/login');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Claude CLI를 찾지 못했어요/);
    const p = await s.claude();
    assert.equal(p.installed, false);
    assert.equal(p.busy, false);
  } finally {
    await s.stop();
    rmSync(empty, { recursive: true, force: true });
  }
});
