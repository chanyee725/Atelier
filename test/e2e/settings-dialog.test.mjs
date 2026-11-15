// Headless check of the settings dialog (E57): opened from the sidebar 테마 row, from Ctrl+K and from ",";
// section switching; one row per provider; connect and disconnect Claude through the fake CLIs; Esc closes.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
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
const SHOTS = process.env.DRAW_SHOTS;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('settings dialog: entry points, sections, provider connect/disconnect with fake CLIs, 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-settings-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-settings-home-'));
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(BASE);
  await page.getByRole('button', { name: '테마', exact: true }).waitFor();

  const dialog = page.getByRole('dialog', { name: '설정' });
  const current = () => dialog.locator('nav button[aria-current="page"]').textContent();

  // 1. Sidebar 설정 row → 일반, theme choices.
  await page.getByRole('button', { name: '테마', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await current(), '일반');
  assert.equal(await dialog.getByRole('radio').count(), 3);
  await dialog.getByRole('radio', { name: '다크' }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await dialog.getByRole('radio', { name: '라이트' }).check();

  // 2. Switch to 모델 연결: one model row (Claude · Fable 5.2).
  await dialog.getByRole('button', { name: '모델 연결' }).click();
  assert.equal(await current(), '모델 연결');
  const rows = dialog.locator('li[data-provider]');
  await rows.first().waitFor();
  assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.dataset.provider)), ['claude']);
  const claude = dialog.locator('li[data-provider="claude"]');
  // Connect: the fake claude reports a logged-in CLI, so the server just turns the connection on.
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결 끊기' }).waitFor();
  assert.match(await claude.getByTestId('provider-status').textContent(), /^연결됨/);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-models-1200.png') });
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결 끊기' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).waitFor();
  assert.equal(await claude.getByTestId('provider-status').textContent(), '연결 안 됨');

  // E509: not connected → the sidebar row reads 연결 안 됨 (text), and a 연결하기 button shows on hover / focus.
  await dialog.getByRole('button', { name: '닫기' }).click();
  const row = page.getByRole('navigation', { name: '모델 연결' }).or(page.locator('ul[aria-label="모델 연결"]')).first();
  await row.getByText('연결 안 됨', { exact: true }).waitFor();
  const connectBtn = row.getByRole('button', { name: '연결하기' });
  await connectBtn.waitFor({ state: 'attached' });
  await row.locator('li').hover();
  assert.equal(await connectBtn.evaluate((el) => getComputedStyle(el).opacity), '1', 'visible on hover');
  await page.mouse.move(0, 0);
  await row.getByRole('button').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'model-connect', 'reachable by Tab');
  assert.equal(await connectBtn.evaluate((el) => getComputedStyle(el).opacity), '1', 'visible on focus-within');
  const sideLogin = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/api/providers/claude/login'));
  await page.keyboard.press('Enter');
  await sideLogin;
  await row.getByText('연결 안 됨', { exact: true }).waitFor({ state: 'detached', timeout: 8000 });
  assert.equal(await connectBtn.count(), 0, 'no 연결하기 once connected');
  await page.getByRole('button', { name: '테마', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '모델 연결' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결 끊기' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).waitFor();

  // #219 review fixes, with a CLI login simulated by rewriting /api/state (the fakes are always logged in).
  const posts = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/providers/') && posts.push(new URL(r.url()).pathname));
  // (3) A double click sends one request: the second click while the first runs is dropped.
  await page.route('**/api/providers/claude/login', async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).dblclick();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결 끊기' }).waitFor();
  assert.equal(posts.filter((p) => p === '/api/providers/claude/login').length, 1, `one login request: ${posts}`);
  await page.unroute('**/api/providers/claude/login');
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결 끊기' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).waitFor();
  // (1) The login runs, then ends without connecting: polling stops and the dialog says so.
  let busy = true;
  await page.route('**/api/state', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.providers.claude = { ...body.providers.claude, busy, connected: false, error: null };
    await route.fulfill({ response: res, json: body });
  });
  await dialog.getByRole('button', { name: '실행' }).click();
  await dialog.getByRole('button', { name: '모델 연결' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 취소' }).waitFor();
  busy = false;
  await dialog.getByText('로그인이 끝났지만 연결되지 않았어요. 다시 해 주세요.').waitFor({ timeout: 5000 });
  // A poll already in flight when the login ended may still land on a loaded machine (#447): let it settle, then count.
  await page.waitForTimeout(1000);
  let polls = 0;
  page.on('request', (r) => r.url().endsWith('/api/state') && polls++);
  await page.waitForTimeout(2500);
  assert.equal(polls, 0, 'no polling once the login ended');
  // (2) Closing the dialog while a login runs cancels it.
  busy = true;
  await dialog.getByRole('button', { name: '다시 확인' }).click();
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 취소' }).waitFor();
  // 다시 확인 starts polling again while the login runs (#228 review).
  polls = 0;
  await page.waitForTimeout(2500);
  assert.ok(polls >= 1, `polling restarted after 다시 확인: ${polls}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  for (let i = 0; i < 50 && !posts.includes('/api/providers/claude/cancel'); i++) await page.waitForTimeout(50);
  assert.ok(posts.includes('/api/providers/claude/cancel'), `cancel sent on close: ${posts}`);
  await page.unroute('**/api/state');
  // (2b) Esc while the login request is still in flight (the server refreshes every CLI first): once it
  // returns unconnected, the closed dialog cancels the login the server started meanwhile (#228 review).
  await page.route('**/api/providers/claude/login', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ json: { ok: true, connected: false } });
  });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('모델 연결 열기');
  await page.getByRole('option', { name: /^모델 연결 열기/ }).first().click();
  await dialog.waitFor();
  posts.length = 0;
  await claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }).click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.ok(!posts.includes('/api/providers/claude/cancel'), `no cancel before the login returns: ${posts}`);
  for (let i = 0; i < 50 && !posts.includes('/api/providers/claude/cancel'); i++) await page.waitForTimeout(50);
  assert.deepEqual(posts, ['/api/providers/claude/login', '/api/providers/claude/cancel'], `cancel after a late login: ${posts}`);
  await page.unroute('**/api/providers/claude/login');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('설정 열기');
  await page.getByRole('option', { name: /^설정 열기/ }).first().click();
  await dialog.waitFor();

  // 3. 실행: guard fields read from the Dispatch settings.
  await dialog.getByRole('button', { name: '실행' }).click();
  await dialog.getByLabel('5시간 한도 (%)').waitFor();
  assert.equal(await dialog.getByLabel('5시간 한도 (%)').inputValue(), '90');

  // Esc closes and focus returns to the page.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // 4. Ctrl+K → 설정 열기; 5. "," shortcut; 모델 연결 열기 opens on that section.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('모델 연결 열기');
  await page.getByRole('option', { name: /^모델 연결 열기/ }).first().click();
  await dialog.waitFor();
  assert.equal(await current(), '모델 연결');
  await dialog.getByRole('button', { name: '닫기' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('설정 열기');
  await page.getByRole('option', { name: /^설정 열기/ }).first().click();
  await dialog.waitFor();
  assert.equal(await current(), '일반');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // Opened from the command menu (gone by now): focus lands on the 설정 row, not on <body> (#242).
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-settings-trigger')), true);
  await page.locator('body').click({ position: { x: 600, y: 400 } });
  await page.keyboard.press('Comma');
  await dialog.waitFor();
  // "," typed inside the dialog does not reopen or close anything.
  await page.keyboard.press('Comma');
  assert.equal(await dialog.count(), 1);
  // Ctrl+K and G P stay quiet behind the open dialog (#228 review).
  await page.keyboard.press('Control+k');
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('combobox', { name: '명령 찾기' }).count(), 0, 'no command menu over the settings dialog');
  assert.equal(await dialog.count(), 1);
  // The dashboard's create keys stay quiet too: the native <dialog> has no role attribute (#242).
  // They ask for a name with window.prompt, which Playwright dismisses on its own, so count the prompts (#252).
  // A listener takes over dismissing, so it dismisses too (or the page would hang on the prompt).
  let prompts = 0;
  const onPrompt = (d) => {
    prompts++;
    d.dismiss().catch(() => {});
  };
  page.on('dialog', onPrompt);
  for (const k of ['d', 'c', 'p', '/']) await page.keyboard.press(k);
  await page.waitForTimeout(200);
  page.off('dialog', onPrompt);
  assert.equal(prompts, 0, 'no name prompt behind the settings dialog');
  assert.equal(await page.locator('main[data-screen="dashboard"]').count(), 1, 'no new file behind the settings dialog');
  assert.equal(await dialog.count(), 1);

  // 6. 390px: dialog fits, section and action targets are at least 44px tall.
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: '모델 연결' }).click();
  await claude.waitFor();
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, `dialog fits 390px: ${JSON.stringify(box)}`);
  for (const b of [dialog.getByRole('button', { name: '모델 연결' }), claude.getByRole('button', { name: 'Claude · Fable 5.2 연결', exact: true }), dialog.getByRole('button', { name: '닫기' })]) {
    const h = (await b.boundingBox()).height;
    assert.ok(h >= 44, `target ≥ 44px at 390px, got ${h}`);
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-models-390.png') });
  // Every row has a visible status dot, also when not connected.
  for (const dot of await rows.locator('i[aria-hidden]').all()) assert.notEqual(await dot.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');

  // 7. 390px: a sidebar model row in the drawer closes the drawer and opens 설정 on 모델 연결.
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
  await drawer.waitFor();
  await drawer.getByRole('button', { name: /^Claude · Fable 5.2 / }).click();
  await dialog.waitFor();
  assert.equal(await current(), '모델 연결');
  await drawer.waitFor({ state: 'detached' });
  // The opener went away with the drawer: closing returns focus to the menu button, not <body> (#230 review).
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '메뉴 열기', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 300)));

  // Only fakes ran, and none of them was asked to log out of the CLI itself.
  assert.ok(fake.calls().every((c) => !(c.bin === 'claude' && c.args.join(' ') === 'auth logout')));
  assert.deepEqual(errors, []);
});
