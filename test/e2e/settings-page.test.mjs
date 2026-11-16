// Headless check of the 설정 page (#587): the modal's 전체 설정 열기 link opens /dispatch#settings; team values, a
// role's default model and a switch are saved with one 저장; the limits form and per-provider usage show; 390px fits.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude can start. It refuses to go on unless the server log names its port and workspace.
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

test('설정 page: link from the modal, save team settings and a role model, limits form, 390px', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
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
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const state = async () => (await (await fetch(`${BASE}/api/state`)).json());

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));

  // 1. The modal links to the full page.
  await page.goto(BASE);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '설정' });
  await dialog.waitFor();
  await dialog.getByRole('link', { name: '전체 설정 열기' }).click();
  await page.waitForURL(/\/dispatch#settings$/);
  const settings = page.getByTestId('settings-page');
  await settings.waitFor();
  assert.equal(await page.getByRole('link', { name: '설정', exact: true }).getAttribute('aria-current'), 'page');

  // 2. Team values show their saved/default values; change a number, a switch and a role model, then save once.
  const team = page.getByRole('form', { name: '팀' });
  const maxChildren = team.getByRole('spinbutton', { name: /^관리자 한 명이 둘 수 있는 팀원/ });
  assert.equal(await maxChildren.inputValue(), '8');
  await maxChildren.fill('4');
  const reply = team.getByRole('checkbox', { name: '답변 스타일 지침 넣기' });
  assert.equal(await reply.isChecked(), true);
  await reply.uncheck();
  const before = await state();
  const role = before.roles[0];
  const other = before.models.find((m) => m.id !== role.model);
  assert.ok(other, 'a second model to pick');
  await team.getByRole('combobox', { name: role.name }).selectOption(other.id);
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('저장했어요.').waitFor();
  let s = await state();
  assert.equal(s.settings.team.maxChildren, 4);
  assert.equal(s.settings.team.replyStyle, false);
  assert.equal(s.settings.team.roleModels[role.id], other.id);
  assert.equal(s.roles.find((r) => r.id === role.id).model, other.id);
  assert.equal(s.settings.team.rotateLead, before.settings.team.rotateLead, 'untouched values stay');

  // 3. A bad value is not sent; saving with nothing changed says so.
  await maxChildren.fill('0');
  await team.getByRole('button', { name: '저장' }).click();
  assert.equal((await state()).settings.team.maxChildren, 4);
  await maxChildren.fill('4');
  await team.getByRole('button', { name: '저장' }).click();
  await team.getByText('바뀐 게 없어요.').waitFor();

  // 4. After a reload the saved values are shown; the limits form and the usage section are there.
  await page.reload();
  await settings.waitFor();
  assert.equal(await page.getByRole('spinbutton', { name: /^관리자 한 명이 둘 수 있는 팀원/ }).inputValue(), '4');
  assert.equal(await page.getByRole('combobox', { name: role.name }).inputValue(), other.id);
  const limits = page.getByRole('form', { name: '한도' });
  await limits.getByRole('spinbutton', { name: /^5시간 한도/ }).waitFor();
  await limits.getByRole('spinbutton', { name: /^5시간 한도/ }).fill('80');
  await limits.getByRole('button', { name: '저장' }).click();
  await limits.getByText('저장했어요.').waitFor();
  assert.equal((await state()).settings.guard.five, 0.8);
  await page.getByRole('region', { name: '모델별 사용량' }).waitFor();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-page-1440.png'), fullPage: true });

  // 5. Narrow width: nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(wide <= 390, `no sideways scroll at 390px: ${wide}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'settings-page-390.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
