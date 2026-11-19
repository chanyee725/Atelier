// Headless browser check (#729): the 플랜 tab draws the open pipeline file's plan as nodes and arrows, each step in its
// live state colour (#687) with agent initial badges, and only for pipeline files.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const CODE = ['plan [label: "계획"]', 'impl [label: "구현"]', 'review [label: "리뷰"]', 'test [label: "테스트"]', 'merge [label: "머지"]', 'plan > impl > review > merge', 'impl > test > merge'].join('\n');
const STEPS = ['plan', 'impl', 'review', 'test', 'merge'];

test('플랜 tab: steps as nodes, arrows for order, live state colours and badges', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  // A scratch git repo with one commit, the workspace inside it.
  const repo = mkdtempSync(join(tmpdir(), 'draw-plan-tab-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd: repo, stdio: 'ignore' });
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

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const plan = { v: 1, block: 'b1', defaults: { role: 'impl' }, steps: STEPS.map((id) => ({ id, node: id, ...(id === 'plan' ? { role: 'lead' } : {}) })) };
  const f = await call('POST', '/api/file', { path: 'run', title: 'Run' });
  const put = await call('PUT', '/api/file?path=run', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'flowchart', code: CODE, x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
    plan,
  });
  assert.ok(!put.error, JSON.stringify(put));
  await call('POST', '/api/file', { path: 'note', title: 'Note' });

  // A running run on disk: plan done (carried over), impl working, test failed, the rest waiting.
  const T0 = Date.now() - 20 * 60e3;
  const id = `${T0}-abcdef`;
  const step = (state, startedAt, sessions = []) => ({ state, startedAt, endedAt: null, sessions });
  const record = {
    v: 1,
    id,
    file: 'run.dpx.json',
    plan: { revision: 1, hash: 'sha256:x', snapshot: plan },
    startedAt: T0,
    endedAt: null,
    state: 'running',
    steps: {
      plan: { ...step('done', T0, [{ sid: 's1', name: 'Mira', state: 'done' }]), endedAt: T0 + 60e3, carried: 'earlier' },
      impl: step('working', T0 + 60e3, [{ sid: 's2', name: 'Juno', state: 'working' }]),
      review: step('pending', null),
      test: step('blocked', T0 + 2 * 60e3, [{ sid: 's3', name: 'Pell', state: 'failed' }]),
      merge: step('pending', null),
    },
    totals: { cost: 0, mtok: 0 },
    timeline: [[T0 + 3 * 60e3, 'test', 'failed']],
  };
  const dir = join(ws, '.drawing', 'runs', 'run.dpx.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(record));

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));

  // A plain document has no 플랜 tab.
  await page.goto(`${BASE}/#file=note`);
  await page.getByRole('button', { name: '문서', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('button', { name: '플랜', exact: true }).count(), 0);

  await page.goto(`${BASE}/#file=run`);
  await page.getByRole('button', { name: '플랜', exact: true }).click();
  const view = page.locator('[data-plan-view]');
  await view.waitFor({ timeout: 30000 });
  const node = (s) => view.locator(`[data-step="${s}"]`);
  await node('impl').waitFor();
  assert.equal(await view.locator('[data-step]').count(), 5);
  assert.equal(await view.locator('.plan-edge').count(), 5);
  assert.equal(await node('plan').getAttribute('data-tone'), 'done');
  assert.equal(await node('impl').getAttribute('data-tone'), 'active');
  assert.equal(await node('test').getAttribute('data-tone'), 'failed');
  assert.equal(await node('merge').getAttribute('data-tone'), 'pending');
  assert.equal(await node('impl').getAttribute('aria-label'), '2 구현 · 진행 · Juno(구현자)');
  assert.equal(await node('impl').locator('.plan-badge').innerText(), 'J');
  // Left to right by order: impl after plan, review and test side by side after impl.
  const box = async (s) => (await node(s).boundingBox());
  const [p, i, r, te] = [await box('plan'), await box('impl'), await box('review'), await box('test')];
  assert.ok(i.x > p.x + p.width && r.x > i.x + i.width && te.x === r.x && te.y > r.y, JSON.stringify({ p, i, r, te }));
  if (process.env.DRAW_E2E_SHOT) await page.screenshot({ path: process.env.DRAW_E2E_SHOT });
  assert.deepEqual(errors, []);
});
