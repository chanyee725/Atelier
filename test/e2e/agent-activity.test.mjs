// Headless check of agent activity across the app (E537, #654): a fake Claude session and a fake Codex session edit
// the same document. The agent panel takes 4 of 10 parts beside the text with one card each (status line, current
// target, recent steps), the sidebar lists both under "작업 중인 에이전트" (a click opens the file), and the bell's
// feed records their work (start, finish) with an unread badge that clears when the feed opens; a toast shows.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_SHOTS=<dir> also saves light/dark x desktop/narrow screenshots there.
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOTS = process.env.DRAW_SHOTS;
const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const h = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });

test('agent activity: two fake sessions on one document — 6:4 panel, sidebar list, bell feed and toast', { skip: SKIP, timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-activity-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-activity-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(join(ws, 'P'), { recursive: true });
  const abs = join(ws, 'P', 'plan.dpx.json');
  const gate = (n) => join(home, `gate-${n}`);
  const release = (n) => writeFileSync(gate(n), '');
  const fileWith = (content, revision) => JSON.stringify({ version: 4, title: 'plan', document: { type: 'doc', content }, canvas: { elements: [], appState: {} }, blocks: [], revision });
  const start = [h('계획'), p('소개 문단이에요.')];
  const step1 = [...start, p('첫 단계를 적어요.')];
  const step2 = [...step1, h('화면 지도'), p('코덱스가 이어서 적어요.')];
  const claude = [
    { type: 'system', subtype: 'init', session_id: 'fake-activity' },
    { $waitFor: gate(1) },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: abs, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith(step1, 50) } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { $waitFor: gate(3) },
    { type: 'assistant', message: { id: 'm9', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ];
  const codex = [
    { type: 'thread.started', thread_id: 'fake-activity-codex' },
    { $waitFor: gate(2) },
    { type: 'item.completed', item: { type: 'file_change', changes: [{ kind: 'update', path: abs }] } },
    { $write: { file: abs, text: fileWith(step2, 60) } },
    { $waitFor: gate(4) },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ];
  const fake = fakeCliBin({ scenarios: { claude, codex } });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
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
  const call = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  await call('POST', '/api/file', { path: 'P/plan.dpx.json', title: 'plan', document: { type: 'doc', content: start } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=P/plan.dpx.json`);
  await page.locator('.doc-editor').waitFor();
  await page.locator('[role="radio"], button', { hasText: /^문서$/ }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-activity-badge]').count(), 0, 'no unread activity yet');

  await call('POST', '/api/providers/claude/login');
  await call('POST', '/api/providers/openai/key', { key: 'sk-fake-activity-key' });
  const a = (await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'write the plan' }], worktree: false })).sessions[0];
  const b = (await call('POST', '/api/sessions', { items: [{ role: 'impl', model: 'gpt-fake-codex', perm: 'auto', prompt: 'continue the plan' }], worktree: false })).sessions[0];
  assert.ok(a.name && b.name && a.name !== b.name);
  release(1);
  await page.waitForFunction(() => document.querySelectorAll('[data-margin-card]').length >= 1, null, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  release(2);

  // 1. Both cards in the panel, beside the text 6:4, each with a status line.
  await page.waitForFunction(() => document.querySelectorAll('[data-margin-card]').length === 2, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const row = await page.evaluate(() => {
    const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
    return { host: w('.doc-margin'), main: w('.doc-margin-main'), aside: w('.doc-margin-aside') };
  });
  assert.ok(Math.abs(row.main - row.host * 0.6) <= 2 && Math.abs(row.aside - row.host * 0.4) <= 2, `text and panel split 6:4: ${JSON.stringify(row)}`);
  const statuses = await page.locator('[data-margin-status]').allTextContents();
  assert.equal(statuses.length, 2);
  for (const s of statuses) assert.match(s, /중…?$/, `a status line per card: ${JSON.stringify(statuses)}`);
  const names = (await page.locator('[data-margin-card] .margin-name').allTextContents()).join(' ');
  assert.ok(names.includes(a.name) && names.includes(b.name), names);

  // 2. The sidebar lists both, with the file; a click opens it.
  await page.waitForFunction(() => document.querySelectorAll('[data-working-agent]').length >= 2, null, { timeout: 10_000 });
  const side = await page.locator('[data-working-agents]').textContent();
  assert.ok(side.includes(a.name) && side.includes(b.name) && side.includes('plan'), side);

  // 3. The bell: unread badge, a toast in view, the feed records the starts; opening it clears the badge.
  await page.locator('[data-activity-badge]').waitFor({ timeout: 10_000 });
  await page.locator('[data-activity-toast]').first().waitFor({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'activity-two-agents-1600.png') });
  await page.locator('[data-activity-bell]').click();
  const feed = page.locator('[data-activity-feed]');
  await feed.waitFor();
  const items = await feed.locator('[data-activity-item]').allTextContents();
  assert.ok(items.some((x) => x.includes(a.name) && x.includes('시작했어요')), JSON.stringify(items));
  assert.ok(items.some((x) => x.includes(b.name)), JSON.stringify(items));
  await page.waitForFunction(() => !document.querySelector('[data-activity-badge]'), null, { timeout: 5_000 });
  const fb = await feed.boundingBox();
  assert.ok(fb.x >= 0 && fb.y >= 0 && fb.x + fb.width <= 1600 && fb.y + fb.height <= 900, `the feed stays in the viewport: ${JSON.stringify(fb)}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'activity-feed-1600.png') });
  await page.keyboard.press('Escape');

  // 4. The Codex session ends: a finish event comes in and shows in the feed.
  release(4);
  release(3);
  await page.locator('[data-activity-badge]').waitFor({ timeout: 20_000 });
  await page.locator('[data-activity-bell]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-activity-item]')].some((e) => /끝냈어요/.test(e.textContent)), null, { timeout: 10_000 });
  // The log is written a moment after a change.
  let stored = { events: [] };
  for (let i = 0; i < 30 && !stored.events.some((e) => e.kind === 'finish'); i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { stored = JSON.parse(readFileSync(join(ws, '.drawing', 'activity.json'), 'utf8')); } catch { /* not yet */ }
  }
  assert.ok(stored.events.some((e) => e.kind === 'finish'), 'the log on disk has the finish');
  assert.ok(!JSON.stringify(stored).includes('done'), 'metadata only: no reply text on disk');
  assert.deepEqual(errors, []);
});
