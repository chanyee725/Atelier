// Project view (#592): only the project's own files, no 미분류 anywhere in the file list, and a 지금 작업 중 panel of
// agent sessions with the file each holds, updated live from the `agents` event without a reload.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace inside a scratch git repo (one commit) in a
// temp dir, and refuses to go on unless the server's own log names that port and folder. No CLI is started: the agent
// feed is played into the page (GET answer and the event stream), so the panel is checked on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOTS = process.env.DRAW_SHOTS;
const freePort = () =>
  new Promise((ok, no) => {
    const s = createServer();
    s.once('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

test('project view: own files only, no 미분류, live agents with held files', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-pview-'));
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
    ['Sim/01-구성', '01. 구성'],
    ['Sim/02-화면', '02. 화면'],
    ['Sim/02-화면/상세', '화면 상세'],
    ['Other/x', '다른 문서'],
    ['메모', '메모'],
  ]) assert.equal((await call('POST', '/api/file', { path: p, title })).status, 201);

  const agent = (sid, x) => ({ sid, name: sid, role: 'impl', roleName: '구현자', color: '#2563eb', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', state: 'running', project: 'Sim', file: null, at: Date.now(), ...x });
  const first = [agent('Otto', { file: 'Sim/02-화면.dpx.json' }), agent('Remy', { project: 'Other', file: 'Other/x.dpx.json' })];
  const next = [agent('Otto', { file: 'Sim/02-화면/상세.dpx.json' }), agent('Cal', { role: 'lead', roleName: '관리자', state: 'waiting', color: '#9333ea' })];

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.route('**/api/workspace/agents*', (r) => r.fulfill({ json: { agents: first } }));
  // The event stream: the first connection sends nothing new; later ones (EventSource reconnects after the body ends)
  // send the next snapshot, so the panel must change with no reload.
  let streams = 0;
  await page.route('**/api/events', (r) => {
    streams++;
    const body = `retry: 300\n\n${streams > 1 ? `event: agents\ndata: ${JSON.stringify({ agents: next })}\n\n` : ''}`;
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body });
  });
  await page.goto(BASE);

  // The file list has no 미분류 tab or group; the loose file is still in 전체.
  const dash = page.locator('main[data-screen="dashboard"]');
  await dash.waitFor();
  assert.deepEqual(await dash.getByRole('tablist', { name: '보기' }).getByRole('tab').allInnerTexts(), ['전체', '최근', '프로젝트별']);
  assert.equal(await dash.getByText('미분류').count(), 0);
  await dash.getByRole('tab', { name: '전체' }).click();
  await dash.locator('[data-doc-row="메모.dpx.json"]').waitFor();

  // The project view lists only its own files and sub-documents.
  await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: 'Sim' }).first().click();
  const home = page.locator('main[data-screen="project"]');
  await home.waitFor();
  const rows = home.locator('[data-doc-row]');
  await rows.first().waitFor();
  assert.deepEqual((await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-doc-row')))).sort(), ['Sim/01-구성.dpx.json', 'Sim/02-화면.dpx.json', 'Sim/02-화면/상세.dpx.json']);

  // 지금 작업 중: only this project's agents, with the file each holds; the row it holds carries the same tag.
  const panel = home.locator('[data-slot="agent-panel"]');
  const names = () => panel.locator('li[data-agent]').evaluateAll((els) => els.map((e) => e.getAttribute('data-agent')));
  await panel.locator('li[data-agent="Otto"]').waitFor();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'project-view-1440.png') });
  assert.deepEqual(await names(), ['Otto']);
  assert.match(await panel.locator('li[data-agent="Otto"]').innerText(), /구현자 · Opus 5\.5[\s\S]*02\. 화면/);
  assert.equal(await home.locator('[data-doc-row="Sim/02-화면.dpx.json"] > div [data-held-by]').getAttribute('data-held-by'), 'Otto');

  // A new snapshot moves Otto to another file and brings Cal in, with no reload.
  await page.waitForFunction(() => document.querySelector('[data-slot="agent-panel"] li[data-agent="Cal"]'), null, { timeout: 10_000 });
  assert.deepEqual(await names(), ['Otto', 'Cal']);
  assert.match(await panel.locator('li[data-agent="Otto"]').innerText(), /화면 상세/);
  assert.match(await panel.locator('li[data-agent="Cal"]').innerText(), /잡고 있는 파일 없음/);
  assert.equal(await home.locator('[data-doc-row="Sim/02-화면.dpx.json"] > div [data-held-by]').count(), 0);
  assert.equal(await home.locator('[data-doc-row="Sim/02-화면/상세.dpx.json"] [data-held-by]').getAttribute('data-held-by'), 'Otto');

  // The held file is a link to it.
  await panel.locator('li[data-agent="Otto"]').getByRole('button', { name: /화면 상세/ }).click();
  await page.waitForFunction(() => !document.querySelector('main[data-screen="project"]'));
  assert.deepEqual(errors, []);
});
