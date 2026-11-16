// Headless check (#550): sidebar model-row focus following ends once the user leaves the row. After a no-op and a press
// on an empty spot, an outside change to the row (another tab disconnects) must not pull focus to 연결하기 or ⋯.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Same scratch setup as model-row.test.mjs: fake CLIs only, scratch HOME, scratch git repo, own port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('model row focus: no-op, then a press outside, then an outside change does not pull focus', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-modelrow-focus-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-modelrow-focus-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const fake = fakeCliBin();
  const port = await freePort();
  // Fakes first; git's own folder after them (fakes win any name clash).
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', FAKE_CLI_LOG: fake.env.FAKE_CLI_LOG, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const status = await (await fetch(`${BASE}/api/dispatch`)).json();
  assert.equal(status.enabled, true, `Dispatch should be on in the scratch repo: ${JSON.stringify(status)}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const posts = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/providers/') && posts.push(new URL(r.url()).pathname));
  await page.goto(BASE);
  const trigger = page.getByRole('button', { name: /^테마/ });
  await trigger.waitFor();
  const row = page.locator('ul[aria-label="모델 연결"]');
  const connect = row.getByRole('button', { name: /연결하기$/ });
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);

  // A no-op on the row (다시 확인) leaves ⋯ in place and tracked. A press on an empty spot leaves focus on <body>.
  // A later outside change (here: disconnect through the API, as another tab would) must not pull focus to 연결하기.
  await row.getByText('연결 안 됨', { exact: true }).waitFor();
  await row.locator('li').hover();
  await connect.click();
  const more = row.getByRole('button', { name: 'Claude · Fable 5.2 메뉴' });
  await more.waitFor({ state: 'attached', timeout: 8000 });
  await row.locator('li').hover();
  await more.click();
  await page.getByRole('menuitem', { name: '다시 확인' }).click();
  for (let i = 0; i < 50 && !posts.includes('/api/providers/refresh'); i++) await page.waitForTimeout(50);
  assert.ok(posts.includes('/api/providers/refresh'));
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'model-menu');
  await page.waitForTimeout(300);
  await page.mouse.click(700, 400);
  assert.equal(await active(), 'BODY', 'the empty spot takes no focus');
  const res = await page.evaluate(async () => (await fetch('/api/providers/claude/logout', { method: 'POST', headers: { 'x-drawing': '1' } })).status);
  assert.equal(res, 200);
  await page.evaluate(() => window.dispatchEvent(new Event('drawing:models-changed')));
  await row.getByText('연결 안 됨', { exact: true }).waitFor({ timeout: 8000 });
  await connect.waitFor({ state: 'attached' });
  await page.waitForTimeout(300);
  assert.equal(await active(), 'BODY', 'focus stays where the user left it, not on 연결하기');

  assert.deepEqual(errors, []);
});
