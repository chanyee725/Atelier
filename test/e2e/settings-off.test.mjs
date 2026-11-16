// Headless check of 설정 with Dispatch off (#620): a workspace outside git. The 설정 modal and the full page still
// render: the theme choice works, and the session sections (team, role models, usage, limits) are read-only, each
// with one line saying why and what to do. Nothing is saved.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('설정 with Dispatch off: modal and page render, theme works, session sections read-only with the reason', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  // A plain folder, not a git repo: Dispatch is off with reason not-git.
  const ws = mkdtempSync(join(tmpdir(), 'draw-settings-off-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-settings-off-home-'));
  const fake = fakeCliBin();
  const port = await freePort();
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
    rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const status = await (await fetch(`${BASE}/api/dispatch`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.reason, 'not-git');

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  const posts = [];
  page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/settings') && posts.push(r.url()));
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

  // 1. The modal: the limits fields show read-only with their defaults and the reason; the theme choice works.
  await page.goto(BASE);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정' });
  await dialog.waitFor();
  const note = dialog.getByTestId('settings-off-note');
  await note.waitFor();
  assert.match(await note.innerText(), /git 저장소 밖.*다시 열면 바꿀 수 있어요/);
  const five = dialog.getByRole('spinbutton', { name: /^5시간 한도/ });
  assert.equal(await five.isDisabled(), true);
  assert.notEqual(await five.inputValue(), '');
  assert.equal(await dialog.getByRole('button', { name: '저장' }).count(), 0, 'nothing to save');
  const themes = dialog.getByRole('radiogroup', { name: '화면 테마' });
  await themes.getByRole('radio', { name: '다크', exact: true }).click();
  assert.equal(await theme(), 'dark');
  await themes.getByRole('radio', { name: '라이트', exact: true }).click();
  assert.equal(await theme(), 'light');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-off-modal-1440.png` });

  // 2. The full page renders too, with every session section read-only and its reason.
  await dialog.getByRole('link', { name: '전체 설정 열기' }).click();
  await page.waitForURL(/\/dispatch#settings$/);
  const settings = page.getByTestId('settings-page');
  await settings.waitFor();
  assert.equal(await settings.getAttribute('data-dispatch'), 'off');
  const team = page.getByRole('form', { name: '팀' });
  const maxChildren = team.getByRole('spinbutton', { name: /^관리자 한 명이 둘 수 있는 팀원/ });
  assert.equal(await maxChildren.isDisabled(), true);
  assert.equal(await maxChildren.inputValue(), '8', 'defaults show');
  assert.equal(await team.getByRole('button', { name: '저장' }).count(), 0);
  await page.getByRole('region', { name: '모델별 사용량' }).getByTestId('settings-off-note').waitFor();
  assert.equal(await page.getByRole('form', { name: '한도' }).getByRole('spinbutton', { name: /^5시간 한도/ }).isDisabled(), true);
  // Team, usage and limits each say why.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="settings-off-note"]').length === 3);
  for (const t of await page.getByTestId('settings-off-note').allInnerTexts()) assert.match(t, /git 저장소 밖/);
  await page.getByRole('radiogroup', { name: '화면 테마' }).getByRole('radio', { name: '다크', exact: true }).click();
  assert.equal(await theme(), 'dark');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-off-page-1440.png`, fullPage: true });

  // 3. Narrow width: nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 390, `no sideways scroll at 390px: ${wide}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-off-page-390.png`, fullPage: true });

  assert.deepEqual(posts, [], 'nothing saved');
  assert.deepEqual(errors, []);
});
