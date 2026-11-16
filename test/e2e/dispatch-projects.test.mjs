// Headless check of the project views (E505d, #484): the 세션 board lists the workspace's projects with open-session
// counts, picking one (or opening #folder=) shows only its sessions, usage labels what is account-wide, and a project
// home has a 세션 tab with its sessions and a link to the filtered board.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH of fake agent CLIs; it refuses to go on unless its log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('세션 board and project home follow the project', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-proj-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-proj-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(join(ws, 'alpha'), { recursive: true });
  mkdirSync(join(ws, 'beta'));
  writeFileSync(join(ws, 'alpha', '.project.json'), JSON.stringify({ name: '알파' }));
  writeFileSync(join(ws, 'beta', '.project.json'), JSON.stringify({ name: '베타' }));

  const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'fake-proj' }, { type: 'result', subtype: 'success' }] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { HOME: home, DRAW_PORT: String(port), ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  let page;
  let step = 'server start';
  const at = (s) => { step = s; };
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  try {
    for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
    const call = async (m, u, b) => {
      const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
      const body = await res.json();
      assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
      return body;
    };

    at('seed projects and sessions');
    await call('POST', '/api/providers/claude/login');
    await call('POST', '/api/file', { path: 'alpha/계획', title: '계획' });
    await call('POST', '/api/file', { path: 'beta/계획', title: '계획' });
    const projects = (await call('GET', '/api/workspace/projects')).projects;
    const alpha = projects.find((p) => p.name === '알파').path;
    const beta = projects.find((p) => p.name === '베타').path;
    // Session names are picked by the server, so the test reads them back.
    const mk = async (folder) => (await call('POST', '/api/sessions', { worktree: false, folder, items: [{ role: 'impl', task: 'x' }] })).sessions[0].name;
    const [a1, a2] = [await mk(alpha), await mk(alpha)];
    const b1 = await mk(beta);
    const u1 = await mk(undefined);

    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
    const errors = [];
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
    await page.goto(`${BASE}/dispatch`);
    const rail = page.getByRole('navigation', { name: '프로젝트' });
    const cards = page.locator('main button[class*="rounded-lg"]');

    at('rail lists 전체, projects and 미분류');
    await rail.getByRole('link', { name: /알파/ }).waitFor();
    assert.deepEqual(await rail.getByRole('link').evaluateAll((els) => els.map((e) => e.querySelector('span').textContent)), ['전체', '베타', '알파', '미분류']);
    assert.equal(await rail.getByRole('link', { name: /전체/ }).getAttribute('aria-current'), 'page');
    await page.getByText(a1, { exact: true }).waitFor();
    await page.getByText(b1, { exact: true }).waitFor();
    await page.getByText(u1, { exact: true }).waitFor();

    at('pick a project');
    await rail.getByRole('link', { name: /알파/ }).click();
    await page.waitForFunction(() => location.hash.startsWith('#folder='));
    await page.getByText(a2, { exact: true }).waitFor();
    assert.equal(await page.getByText(b1, { exact: true }).count(), 0);
    assert.equal(await page.getByText(u1, { exact: true }).count(), 0);
    assert.equal(await rail.getByRole('link', { name: /알파/ }).getAttribute('aria-current'), 'page');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-board.png') });

    at('forced colours: a focused rail item keeps a visible outline (#524)');
    await page.emulateMedia({ forcedColors: 'active' });
    const outline = (name) => rail.getByRole('link', { name }).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
    });
    const picked = await outline(/알파/);
    assert.equal(picked.style, 'solid', 'the picked item keeps its Highlight outline');
    await page.keyboard.press('Shift'); // keyboard modality, so programmatic focus matches :focus-visible
    for (const name of [/베타/, /알파/]) {
      await rail.getByRole('link', { name }).focus();
      const o = await outline(name);
      assert.equal(o.style, 'solid', `${name} shows a focus outline`);
      assert.equal(o.width, '2px');
      assert.equal(o.offset, '1px', 'focus sits outside the item, unlike the inset selected outline');
    }
    await page.emulateMedia({ forcedColors: 'none' });
    await page.locator('body').focus();

    at('timeline and usage keep the project');
    await page.getByRole('navigation', { name: '세션 화면' }).getByRole('link', { name: '타임라인' }).click();
    await page.locator(`[data-row="${a1}"]`).waitFor();
    assert.equal(await page.locator(`[data-row="${b1}"]`).count(), 0);
    assert.match(await page.evaluate(() => location.hash), /^#timeline&folder=/);
    await page.getByRole('navigation', { name: '세션 화면' }).getByRole('link', { name: '사용량' }).click();
    await page.getByRole('heading', { name: '알파 사용량' }).waitFor();
    await page.getByRole('heading', { name: /한도 · 계정 전체/ }).waitFor();
    await page.getByText('이 프로젝트의 세션만').waitFor();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-usage.png') });

    at('미분류 and a link with #folder=');
    await page.goto(`${BASE}/dispatch#folder=`);
    await page.getByText(u1, { exact: true }).waitFor();
    assert.equal(await page.getByText(a1, { exact: true }).count(), 0);
    await page.goto(`${BASE}/dispatch#folder=${encodeURIComponent(beta)}`);
    await page.getByText(b1, { exact: true }).waitFor();
    assert.equal(await page.getByText(a1, { exact: true }).count(), 0);
    await page.goBack();
    await page.getByText(u1, { exact: true }).waitFor();

    at('project list fails: 미분류 does not file every session (#522)');
    await page.route('**/api/workspace/projects', (r) => r.fulfill({ status: 500, body: '{}' }));
    await page.goto(`${BASE}/dispatch#folder=`);
    await page.reload(); // a hash-only goto keeps the loaded page
    await page.getByText('프로젝트 목록이 없어서 미분류를 가려낼 수 없어요.').waitFor();
    assert.equal(await page.getByText(u1, { exact: true }).count(), 0);
    assert.equal(await page.getByText(a1, { exact: true }).count(), 0);
    await page.unroute('**/api/workspace/projects');

    at('project usage fails, then 다시 불러오기 (#522)');
    let failUsage = true;
    await page.route(/\/api\/usage\?folder=/, (r) => (failUsage ? r.fulfill({ status: 500, body: '{}' }) : r.continue()));
    await page.goto(`${BASE}/dispatch#usage&folder=${encodeURIComponent(alpha)}`);
    await page.reload();
    const panel = page.getByRole('region', { name: '알파 사용량' });
    await panel.getByText('프로젝트 사용량을 불러오지 못했어요.').waitFor();
    failUsage = false;
    await panel.getByRole('button', { name: '다시 불러오기' }).click();
    await panel.getByText('2개', { exact: true }).waitFor();
    assert.equal(await panel.getByText('프로젝트 사용량을 불러오지 못했어요.').count(), 0);
    await page.unroute(/\/api\/usage\?folder=/);

    at('narrow screen: rail becomes a row');
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto(`${BASE}/dispatch`);
    await rail.getByRole('link', { name: /알파/ }).waitFor();
    const [a, b] = await rail.getByRole('link').evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().top));
    assert.equal(a, b, 'rail entries sit on one row');
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-narrow.png') });

    at('project home 세션 tab');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/`);
    await page.getByText('알파').first().waitFor();
    await page.getByRole('link', { name: /알파/ }).first().click().catch(async () => { await page.getByText('알파').first().click(); });
    await page.getByRole('tab', { name: '세션' }).click();
    await page.getByRole('region', { name: '세션' }).getByText(a1, { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '세션' }).getByText(b1, { exact: true }).count(), 0);
    await page.getByRole('region', { name: '실행 기록' }).getByText('아직 없어요', { exact: false }).waitFor();
    const link = page.getByRole('link', { name: /세션 보드에서 보기/ });
    assert.equal(await link.getAttribute('href'), `/dispatch#folder=${encodeURIComponent(alpha)}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e505d-home.png') });
    assert.deepEqual(errors, []);
  } catch (e) {
    const shot = join(tmpdir(), `dispatch-projects-fail-${Date.now()}.png`);
    await page?.screenshot({ path: shot, fullPage: true }).catch(() => {});
    throw new Error(`[step: ${step}] ${e.message}\nscreenshot: ${shot}\nserver log tail:\n${log.slice(-1500)}`, { cause: e });
  }
});
