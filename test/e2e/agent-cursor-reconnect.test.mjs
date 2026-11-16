// Headless check (#656): when the event stream reconnects, the page drops every cursor and margin card (clearCursors
// in web/src/App.tsx, clearFile in web/src/doc/marginStore.ts) and the server sends the cursors of sessions still at
// work to the new connection, so the resident document cursor and the margin card come back.
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

test('stream reconnect: the resident doc cursor and the margin card come back while the session works', { skip: SKIP, timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-reconnect-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-reconnect-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const abs = join(ws, 'plan.dpx.json');
  const gate = (n) => join(home, `gate-${n}`);
  const release = (n) => writeFileSync(gate(n), '');

  const fileWith = (content, revision) => JSON.stringify({ version: 4, title: 'plan', document: { type: 'doc', content }, canvas: { elements: [], appState: {} }, blocks: [], revision });
  const start = [h('계획'), p('소개 문단이에요.')];
  const step1 = [...start, p('첫 단계를 적어요.')];
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-reconnect' },
    { $waitFor: gate(1) },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: abs, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith(step1, 50) } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { $waitFor: gate(2) }, // still at work while the page reconnects
    { type: 'assistant', message: { id: 'm9', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ];
  const fake = fakeCliBin({ scenario });
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
  await call('POST', '/api/file', { path: 'plan.dpx.json', title: 'plan', document: { type: 'doc', content: start } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  // Keep a handle on the page's EventSource, so the test can drop the stream the way a restarting server does.
  await page.addInitScript(() => {
    const Orig = window.EventSource;
    window.__streams = [];
    window.EventSource = class extends Orig {
      constructor(...a) {
        super(...a);
        window.__streams.push(this);
      }
    };
  });
  await page.goto(`${BASE}/#file=plan.dpx.json`);
  await page.locator('.doc-editor p', { hasText: '소개 문단' }).waitFor();

  await call('POST', '/api/providers/claude/login');
  const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'write the plan' }], worktree: false });
  const name = sessions[0].name;
  assert.ok(name);
  release(1);

  const card = page.locator('[data-margin-card]');
  const cursor = page.locator('[data-doc-agent-cursor]');
  await card.waitFor({ timeout: 15_000 });
  await cursor.waitFor({ timeout: 15_000 });
  assert.match(await card.locator('.margin-name').textContent(), new RegExp(name));

  // The stream closes for good (as on a non-200 answer); the client opens a new one after its retry delay. That one
  // first meets a stand-in stream that opens and sends nothing, so the page's clear shows on its own: card and cursor go.
  await page.route('**/api/events', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 1500\n\n' }));
  await page.evaluate(() => {
    const es = window.__streams.at(-1);
    es.close();
    es.onerror?.(new Event('error'));
  });
  await card.waitFor({ state: 'detached', timeout: 10_000 });
  await cursor.waitFor({ state: 'detached', timeout: 10_000 });
  // The browser retries the ended stand-in on its own, now against the server, which replays the cursors of
  // sessions still at work.
  await page.unroute('**/api/events');

  // Both come back from the server's replay, for the same session.
  await card.waitFor({ timeout: 10_000 });
  await cursor.waitFor({ timeout: 10_000 });
  assert.match(await card.locator('.margin-name').textContent(), new RegExp(name));
  assert.match(await cursor.textContent(), new RegExp(name));
  assert.equal(await card.count(), 1);
  assert.equal(await cursor.count(), 1);

  release(2);
  await card.waitFor({ state: 'detached', timeout: 20_000 });
  assert.deepEqual(errors, []);
});
