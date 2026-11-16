// Headless check of the sidebar model row and 테마 menu (E509): 연결 안 됨 text, 연결하기 on hover/focus, 연결 중 with 취소,
// ⋯ menu with 연결 끊기, the 테마 menu, and that no settings dialog, "," shortcut or 설정 command is left.
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

test('model row and theme menu: connect, cancel, disconnect with fake CLIs, no settings dialog, 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-modelrow-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-modelrow-home-'));
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
  const trigger = page.getByRole('button', { name: '테마', exact: true });
  await trigger.waitFor();
  const row = page.locator('ul[aria-label="모델 연결"]');
  const connect = row.getByRole('button', { name: /연결하기$/ });
  const opacity = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity);

  // 1. 테마 menu: three choices, one checked; choosing applies at once. No settings dialog anywhere.
  await trigger.click();
  const menu = page.getByRole('menu', { name: '테마' });
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole('menuitemradio').allInnerTexts(), ['라이트', '다크', '시스템']);
  await menu.getByRole('menuitemradio', { name: '다크' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await trigger.click();
  assert.equal(await page.getByRole('menuitemradio', { name: '다크' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemradio', { name: '라이트' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true, 'focus returns to the 테마 row');
  assert.equal(await page.getByRole('dialog').count(), 0, 'no settings dialog');
  await page.locator('body').click({ position: { x: 700, y: 400 } });
  await page.keyboard.press('Comma');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('설정');
  assert.equal(await page.getByRole('option', { name: /설정 열기|모델 연결 열기/ }).count(), 0, 'no settings commands');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0, ', opens nothing');

  // 2. Not connected: text 연결 안 됨; 연결하기 shows on hover and on focus-within.
  await row.getByText('연결 안 됨', { exact: true }).waitFor();
  await connect.waitFor({ state: 'attached' });
  await page.mouse.move(700, 400);
  assert.equal(await opacity(connect), '0', 'hidden until hover or focus');
  await row.locator('li').hover();
  assert.equal(await opacity(connect), '1', 'visible on hover');
  await page.mouse.move(700, 400);
  await trigger.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'model-connect', 'reachable by Tab');
  assert.equal(await opacity(connect), '1', 'visible on focus-within');
  assert.notEqual(await connect.evaluate((el) => getComputedStyle(el).boxShadow), 'none', 'visible focus ring');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'row-not-connected-1440.png') });

  // 3. Enter connects (fake CLI is logged in): one login request, then usage/connected and a ⋯ menu, no 연결하기.
  await page.keyboard.press('Enter');
  await row.getByText('연결 안 됨', { exact: true }).waitFor({ state: 'detached', timeout: 8000 });
  assert.equal(posts.filter((p) => p === '/api/providers/claude/login').length, 1);
  assert.equal(await connect.count(), 0);
  const more = row.getByRole('button', { name: 'Claude · Fable 5.2 메뉴' });
  await more.waitFor({ state: 'attached' });

  // 4. ⋯ menu: 연결 끊기 and 다시 확인; disconnect goes back to 연결 안 됨 and shows 연결하기 again.
  await row.locator('li').hover();
  await more.click();
  const rowMenu = page.getByRole('menu');
  assert.deepEqual(await rowMenu.getByRole('menuitem').allInnerTexts(), ['연결 끊기', '다시 확인']);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'row-menu-1440.png') });
  await rowMenu.getByRole('menuitem', { name: '다시 확인' }).click();
  for (let i = 0; i < 50 && !posts.includes('/api/providers/refresh'); i++) await page.waitForTimeout(50);
  assert.ok(posts.includes('/api/providers/refresh'));
  await row.locator('li').hover();
  await more.click();
  await page.getByRole('menuitem', { name: '연결 끊기' }).click();
  await row.getByText('연결 안 됨', { exact: true }).waitFor();
  assert.ok(posts.includes('/api/providers/claude/logout'));
  await connect.waitFor({ state: 'attached' });

  // 5. A double click on 연결하기 sends one request (the second is dropped).
  posts.length = 0;
  await page.route('**/api/providers/claude/login', async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await row.locator('li').hover();
  await connect.dblclick();
  await more.waitFor({ state: 'attached' });
  assert.equal(posts.filter((p) => p === '/api/providers/claude/login').length, 1, `one login request: ${posts}`);
  await page.unroute('**/api/providers/claude/login');
  await row.locator('li').hover();
  await more.click();
  await page.getByRole('menuitem', { name: '연결 끊기' }).click();
  await row.getByText('연결 안 됨', { exact: true }).waitFor();

  // 6. A login that runs: 연결 중 with 취소 always visible; 취소 sends cancel. When it ends unconnected the row says so, and polling stops.
  let busy = true;
  await page.route('**/api/state', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.providers.claude = { ...body.providers.claude, busy, connected: false, error: null, url: busy ? 'https://example.test/login' : null };
    await route.fulfill({ response: res, json: body });
  });
  await row.locator('li').hover();
  await connect.click();
  await row.getByText('연결 중', { exact: true }).waitFor({ timeout: 8000 });
  await page.mouse.move(700, 400);
  const cancel = row.getByRole('button', { name: 'Claude · Fable 5.2 연결 취소' });
  assert.equal(await opacity(cancel), '1', '취소 visible without hover');
  assert.equal(await row.getByRole('link', { name: '로그인 페이지 열기' }).getAttribute('href'), 'https://example.test/login');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'row-busy-1440.png') });
  busy = false;
  await row.getByText('로그인이 끝났지만 연결되지 않았어요. 다시 해 주세요.').waitFor({ timeout: 8000 });
  await page.waitForTimeout(1000);
  let polls = 0;
  page.on('request', (r) => r.url().endsWith('/api/state') && polls++);
  await page.waitForTimeout(2500);
  assert.equal(polls, 0, 'no polling once the login ended');
  busy = true;
  posts.length = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('drawing:models-changed')));
  await cancel.waitFor();
  await cancel.click();
  for (let i = 0; i < 50 && !posts.includes('/api/providers/claude/cancel'); i++) await page.waitForTimeout(50);
  assert.ok(posts.includes('/api/providers/claude/cancel'), `cancel sent: ${posts}`);
  await page.unroute('**/api/state');
  await page.evaluate(() => window.dispatchEvent(new Event('drawing:models-changed')));
  // The real login in step 6 connected the fake CLI: the row shows the ⋯ menu again; disconnect for the next step.
  await more.waitFor({ state: 'attached', timeout: 8000 });
  await row.locator('li').hover();
  await more.click();
  await page.getByRole('menuitem', { name: '연결 끊기' }).click();
  await row.getByText('연결 안 됨', { exact: true }).waitFor({ timeout: 8000 });

  // 7. 390px: in the drawer 연결하기 and 테마 are always shown, at least 44px tall; connecting keeps the drawer open.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '메뉴 열기' }).click();
  const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
  await drawer.waitFor();
  const dconnect = drawer.getByRole('button', { name: /연결하기$/ });
  assert.equal(await opacity(dconnect), '1');
  assert.ok((await dconnect.boundingBox()).height >= 44);
  assert.ok((await drawer.getByRole('button', { name: '테마', exact: true }).boundingBox()).height >= 44);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'row-not-connected-390.png') });
  await drawer.getByRole('button', { name: '테마', exact: true }).click();
  const m390 = page.getByRole('menu', { name: '테마' });
  await m390.waitFor();
  await page.waitForTimeout(300); // the open animation scales the menu from 95%
  for (const it of await m390.getByRole('menuitemradio').all()) assert.ok((await it.boundingBox()).height >= 44, 'menu item ≥ 44px');
  await page.keyboard.press('Escape');
  await m390.waitFor({ state: 'detached' });
  assert.equal(await drawer.count(), 1, 'Esc closes the menu only, not the drawer');
  await dconnect.click({ timeout: 5000 });
  await drawer.getByRole('button', { name: 'Claude · Fable 5.2 메뉴' }).waitFor();
  assert.equal(await drawer.count(), 1, 'drawer stays open');

  // Only fakes ran, and none of them was asked to log out of the CLI itself.
  assert.ok(fake.calls().every((c) => !(c.bin === 'claude' && c.args.join(' ') === 'auth logout')));
  assert.deepEqual(errors, []);
});
