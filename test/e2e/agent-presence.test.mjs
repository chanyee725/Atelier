// Headless check of the live agent list and named cursors (E528, #592): a fake Claude session working in project
// `Proj` edits a diagram; the `agents` feed (SSE in the page and GET) lists it with the file it holds, and its
// cursor tag carries its own name. Then an outside API writer that sends `x-drawing-session` gets its own label.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Scratch HOME, scratch git repo and workspace, fake CLIs only; refuses to go on unless the server log names its
// port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const rect = (id, x, y) => ({ id, type: 'rectangle', x, y, width: 120, height: 60, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false });

test('agent list and named cursors: a fake session in a project, then a named outside writer', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-presence-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-presence-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(join(ws, 'Proj'), { recursive: true });
  const abs = join(ws, 'Proj', 'demo.dpx.json');

  const fileWith = (elements, revision) => JSON.stringify({ version: 4, title: 'demo', document: { type: 'doc', content: [] }, canvas: { elements, appState: {} }, blocks: [], revision });
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-presence' },
    { $sleep: 4000 }, // the page opens the file first
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: abs, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith([rect('r1', 0, 0), rect('r2', 400, 0)], 50) } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { $sleep: 20_000 }, // still working while the test looks
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

  const call = async (m, u, b, extra = {}) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1', ...extra }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  await call('POST', '/api/file', { path: 'Proj/demo.dpx.json', title: 'demo', canvas: { elements: [rect('r1', 0, 0)], appState: {} } });
  assert.deepEqual((await call("GET", "/api/workspace/agents").catch((e) => { throw new Error(e.message + "\n" + log); })).agents, []);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=${encodeURIComponent('Proj/demo.dpx.json')}`);
  await page.locator('.excalidraw').first().waitFor();
  // The page's own view of the feed: every `agents` event it receives.
  await page.evaluate((base) => {
    window.__agents = [];
    new EventSource(`${base}/api/events`).addEventListener('agents', (e) => window.__agents.push(JSON.parse(e.data).agents));
  }, BASE);

  await call('POST', '/api/providers/claude/login');
  const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'draw a box' }], worktree: false, folder: 'Proj' });
  const s = sessions[0];
  assert.ok(s.name);

  // The feed lists the session in Proj, then with the file it holds.
  await page.waitForFunction((sid) => window.__agents.some((l) => l.some((a) => a.sid === sid)), s.id, { timeout: 10_000 });
  await page.waitForFunction((sid) => window.__agents.at(-1)?.some((a) => a.sid === sid && a.file === 'Proj/demo.dpx.json'), s.id, { timeout: 15_000 });
  const row = (await page.evaluate(() => window.__agents.at(-1))).find((a) => a.sid === s.id);
  assert.equal(row.name, s.name);
  assert.equal(row.role, 'impl');
  assert.equal(row.project, 'Proj');
  assert.equal(row.color, s.color);
  assert.ok(row.model);
  const listed = (await call('GET', '/api/workspace/agents?project=Proj')).agents;
  assert.deepEqual(listed.map((a) => [a.name, a.file]), [[s.name, 'Proj/demo.dpx.json']]);
  assert.deepEqual((await call('GET', '/api/workspace/agents?project=Other')).agents, []);

  // Its cursor carries its own name.
  await page.locator('[data-agent-cursor]', { hasText: s.name }).first().waitFor({ timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-presence-session.png') });

  // An outside writer naming itself (cleaned: no HTML).
  // After the session's edit call has settled (server/cursor SETTLE_MS), so the write is not credited to it.
  await page.waitForTimeout(3500);
  const cur = await call('GET', `/api/file?path=${encodeURIComponent('Proj/demo.dpx.json')}`);
  await call('PUT', `/api/file?path=${encodeURIComponent('Proj/demo.dpx.json')}`, { ...cur, canvas: { elements: [...cur.canvas.elements, rect('r9', 0, 400)], appState: {} } }, { 'x-drawing-session': '<i>Nova</i>' });
  await page.locator('[data-agent-cursor]', { hasText: 'iNova/i' }).first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-agent-cursor] i').count(), 0, 'HTML in the label was rendered');
  await page.waitForFunction(() => window.__agents.at(-1)?.some((a) => a.outside && a.name === 'iNova/i' && a.file === 'Proj/demo.dpx.json'), null, { timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-presence-outside.png') });

  // Nothing about the writer is on disk.
  const files = readdirSync(ws, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));
  for (const f of files) assert.equal(readFileSync(f, 'utf8').includes('Nova'), false, f);
  assert.deepEqual(errors, []);
});
