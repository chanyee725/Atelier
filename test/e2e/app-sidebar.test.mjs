// Headless browser check of the app shell (design doc 6 §2.1, §9 ①): views, the project's 문서 (#778), frames, shortcuts, drawer.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_SHOTS=<folder> also saves screenshots (light/dark × 1440/390, home and document).
// It starts its own server on a free port against a scratch workspace inside a scratch git repo (one commit) in a
// temp dir, and refuses to go on unless the server's own log names that port and folder. No provider is connected,
// so no agent CLI is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

test('app sidebar: project name, 문서, dashboard home, frames A/B, shortcuts, 390px drawer', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-shell-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.js', ws], { env: { ...process.env, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = (m, u, b) => fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
  for (const [p, title] of [
    ['결제 시스템/로그인 로직', '로그인 로직'],
    ['결제 시스템/로그인 로직/토큰 갱신', '토큰 갱신'],
    ['결제 시스템/데이터 수집 로직', '데이터 수집 로직'],
    ['온보딩/첫 화면 흐름', '첫 화면 흐름'],
    ['아이디어 메모', '아이디어 메모'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);
  await call('POST', '/api/folder', { path: '인프라' });
  writeFileSync(join(ws, '온보딩', '.project.json'), JSON.stringify({ name: '온보딩 개편', description: '첫 사용 흐름 다시 짜기' }));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const open = async (theme, width) => {
    const page = await browser.newPage({ viewport: { width, height: width > 500 ? 900 : 844 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.addInitScript((th) => localStorage.setItem('drawing.theme', th), theme);
    await page.goto(BASE);
    return page;
  };
  // A sidebar row by its visible text (row actions have their own labels).
  const row = (scope, re) => scope.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: re }).first();
  const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });

  // Desktop, light.
  let page = await open('light', 1440);
  const nav = page.getByRole('navigation', { name: '사이드바' });
  const frame = () => page.locator('[data-slot="sidebar-inset"]').getAttribute('data-frame');
  await nav.getByRole('button', { name: '결제 시스템', exact: false }).first().waitFor();
  assert.equal(await nav.getByRole('button', { name: /^대시보드/ }).getAttribute('aria-current'), 'page');
  assert.equal(await frame(), 'floating');
  // Top-left: the project's name, no folder switch (#778): the git project folder that holds the workspace (#782).
  assert.ok((await nav.locator('[data-project-name]').innerText()).endsWith(basename(repo)));
  assert.equal(await nav.getByRole('button', { name: /폴더 바꾸기/ }).count(), 0);
  assert.equal(await nav.getByRole('button', { name: '새 프로젝트' }).count(), 0);
  // 문서: top folders sorted by name (the meta name wins over the folder name), then the loose documents.
  const group = nav.locator('[data-slot="sidebar-group"]').filter({ hasText: '문서' });
  assert.equal(await group.locator('[data-slot="sidebar-group-label"]').innerText(), '문서');
  const topRows = group.locator(':scope > ul > li > [data-slot="sidebar-menu-button"] > span.truncate');
  assert.deepEqual(await topRows.allInnerTexts(), ['결제 시스템', '온보딩 개편', '인프라', '아이디어 메모']);

  // Dashboard home (#778): cards only, no tabs, 새로 만들기 chips or find box on the page (#793).
  const dash = page.locator('main[data-screen="dashboard"]');
  await dash.getByRole('heading', { level: 1, name: '대시보드' }).waitFor();
  for (const title of ['실행 중인 세션', '이슈']) await dash.getByRole('heading', { name: title }).first().waitFor();
  assert.equal(await dash.getByRole('tablist').count(), 0);
  assert.equal(await dash.getByRole('group', { name: '새로 만들기' }).count(), 0);
  assert.equal(await dash.locator('input[type="search"]').count(), 0);
  // `/` opens the command menu on 문서 only; typing finds a nested document (#793).
  await page.keyboard.press('/');
  const find = page.getByRole('combobox', { name: '명령 찾기' });
  await find.waitFor();
  await page.getByRole('button', { name: '문서만 찾기 풀기' }).waitFor();
  await page.keyboard.type('토큰');
  await page.getByRole('option', { name: /토큰 갱신/ }).first().waitFor();
  await page.keyboard.press('Escape');
  await find.waitFor({ state: 'detached' });
  await shot(page, 'light-dash-1440');
  await page.evaluate(() => document.activeElement?.blur());

  // G P opens the menu on projects only; the 프로젝트만 chip is a button that widens it again (#216 review).
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  const chip = page.getByRole('button', { name: '프로젝트만 찾기 풀기' });
  await chip.waitFor();
  await page.getByRole('combobox', { name: '명령 찾기' }).fill('없는이름');
  await page.getByText('맞는 프로젝트가 없어요. 프로젝트만을 풀면 모든 명령에서 찾아요.').waitFor();
  await chip.click();
  await chip.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'combobox');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '명령 찾기' }).waitFor({ state: 'detached' });
  await page.evaluate(() => document.activeElement?.blur());

  await page.keyboard.press('r');
  assert.equal(await nav.getByRole('button', { name: /최근/ }).getAttribute('aria-current'), 'page');
  await page.keyboard.press('a');
  assert.equal(await nav.getByRole('button', { name: /^대시보드/ }).getAttribute('aria-current'), 'page');

  // A folder in 문서 unfolds its documents in place (the dashboard stays); a document with sub-documents shows a count.
  const pay = row(nav, /결제 시스템/);
  await pay.click();
  assert.equal(await pay.getAttribute('aria-expanded'), 'true');
  assert.equal(await nav.getByRole('button', { name: /^대시보드/ }).getAttribute('aria-current'), 'page');
  assert.equal(await frame(), 'floating');
  const login = row(nav, /^로그인 로직/);
  await login.waitFor();
  assert.match(await login.innerText(), /1$/);
  await shot(page, 'light-home-1440');

  // Unfold the sub-documents, open one: the document screen sits flush (frame A) and the row is current.
  await nav.getByRole('button', { name: '로그인 로직 하위 문서 펼치기' }).click();
  await row(nav, /토큰 갱신/).click();
  await page.locator('.ProseMirror').waitFor();
  assert.equal(await frame(), 'attached');
  assert.equal(await row(nav, /토큰 갱신/).getAttribute('aria-current'), 'page');
  // One-letter keys belong to the editor while it has focus.
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('a');
  assert.equal(await frame(), 'attached');
  // ...and to the canvas while it has focus: R picks the rectangle tool, not 최근.
  const cbox = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(cbox.x + cbox.width - 80, cbox.y + cbox.height - 80);
  await page.keyboard.press('r');
  assert.equal(await frame(), 'attached');
  assert.ok(await page.locator('input[data-testid="toolbar-rectangle"]').isChecked(), 'R picked the rectangle tool');
  assert.notEqual(await nav.getByRole('button', { name: /최근/ }).getAttribute('aria-current'), 'page');
  await page.keyboard.press('Escape');
  await shot(page, 'light-doc-1440');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('a');
  assert.equal(await frame(), 'floating');
  // B opens the archive (trash) dialog; Escape closes it.
  await page.keyboard.press('b');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  // One row per provider, named by the provider (not a model, #620), with text next to the dot. The row is a button
  // that opens the 설정 modal at its 모델 연결 section (#624); its name says the state and what it does.
  const models = nav.getByRole('list', { name: '모델 연결' });
  await models.waitFor();
  assert.deepEqual((await models.locator('li').allInnerTexts()).map((s) => s.split('\n')[0]), ['Claude', 'OpenAI Codex', 'Gemini']);
  for (const s of await models.locator('li').allInnerTexts()) assert.match(s, /연결 안 됨|연결됨|설치 안 됨|로그인 중|%|한도/);
  const modelRow = models.getByRole('button', { name: /^Claude (연결 안 됨|연결됨|설치 안 됨|로그인 중|.*%.*|.*한도.*), 연결 관리$/ });
  await modelRow.waitFor({ state: 'attached' });
  assert.equal(await modelRow.getAttribute('aria-haspopup'), 'dialog');
  // Clicking the row opens 설정 > 모델 연결; nothing is connected in a scratch repo, so Claude's action is 연결.
  await modelRow.click();
  const settings = page.getByRole('dialog', { name: '설정' });
  await settings.waitFor();
  const providers = settings.getByRole('region', { name: '모델 연결' });
  await providers.waitFor();
  assert.equal(await settings.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '모델 연결' }).getAttribute('aria-current'), 'true');
  await providers.getByRole('button', { name: 'Claude 연결', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  assert.equal(await modelRow.evaluate((el) => el === document.activeElement), true, 'focus returns to the model row');
  await page.close();

  page = await open('dark', 1440);
  await page.locator('main[data-screen="dashboard"]').waitFor();
  await shot(page, 'dark-dash-1440');
  await row(page.getByRole('navigation', { name: '사이드바' }), /결제 시스템/).click();
  await page.waitForTimeout(300);
  await shot(page, 'dark-home-1440');
  await row(page.getByRole('navigation', { name: '사이드바' }), /^로그인 로직/).click();
  await page.locator('.ProseMirror').waitFor();
  await shot(page, 'dark-doc-1440');
  await page.close();

  // 390px: the sidebar is a drawer; its rows are 44px touch targets; opening a file closes it.
  for (const theme of ['light', 'dark']) {
    page = await open(theme, 390);
    assert.equal(await page.getByRole('navigation', { name: '사이드바' }).count(), 0);
    await shot(page, `${theme}-home-390`);
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    const drawer = page.getByRole('dialog').getByRole('navigation', { name: '사이드바' });
    await drawer.waitFor();
    const all = drawer.getByRole('button', { name: /^대시보드/ });
    assert.ok((await all.boundingBox()).height >= 44, 'drawer rows are 44px');
    await row(drawer, /결제 시스템/).click();
    await page.waitForTimeout(400);
    await shot(page, `${theme}-nav-390`);
    await row(page.getByRole('dialog'), /^로그인 로직/).click();
    await page.locator('.ProseMirror').waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole('dialog').count(), 0, 'drawer closed after opening a file');
    await shot(page, `${theme}-doc-390`);
    await page.close();
  }
  assert.deepEqual(errors, []);
});
