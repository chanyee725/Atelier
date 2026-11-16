// Headless check that the agent cursor keeps the session's own name (E536, #653): a fake Claude session writes one
// document 5 times over about 30 s, the way real sessions do it: curl to /api/file with the path without .dpx.json,
// a partly encoded path, and a saved script run later (bash save.sh). The label must show the session's name the
// whole time, never the generic outside-writer name "에이전트", and the cursor must stay between the writes.
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
// Space between writes: past the server's settle time (3 s) and the old cursor fade time (6.4 s).
const GAP_MS = 6500;

test('agent cursor name: a session writes 5 times over 30 s; the label keeps its name', { skip: SKIP, timeout: 240_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-cursorname-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-cursorname-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(join(ws, 'Sim Studio'), { recursive: true });
  const rel = 'Sim Studio/07-서버-저장';
  const abs = join(ws, `${rel}.dpx.json`);
  const gate = (n) => join(home, `gate-${n}`);
  const release = (n) => writeFileSync(gate(n), '');
  const port = await freePort();
  const api = `http://127.0.0.1:${port}/api/file`;

  // Tool calls as the session makes them; the file write stands for what the call does (the fake runs no command).
  const call = (n, name, input) => ({ type: 'assistant', message: { id: `m${n}`, content: [{ type: 'tool_use', id: `t${n}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const result = (n) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'ok' }] } });
  const fileWith = (content, revision) => JSON.stringify({ version: 4, title: '서버 저장', document: { type: 'doc', content }, canvas: { elements: [], appState: {} }, blocks: [], revision });
  const curl = (path) => `curl -s -X PUT -H 'x-drawing: 1' -H 'content-type: application/json' '${api}?path=${path}' --data @body.json`;
  const steps = [
    [h('서버 저장'), p('첫 번째 글이에요.')],
    [h('서버 저장'), p('첫 번째 글이에요.'), p('두 번째 글이에요.')],
    [h('서버 저장'), p('첫 번째 글이에요.'), p('두 번째 글이에요.'), p('세 번째 글이에요.')],
    [h('서버 저장'), p('첫 번째 글이에요.'), p('두 번째 글이에요.'), p('세 번째 글이에요.'), p('네 번째 글이에요.')],
    [h('서버 저장'), p('첫 번째 글이에요.'), p('두 번째 글이에요.'), p('세 번째 글이에요.'), p('네 번째 글이에요.'), p('다섯 번째 글이에요.')],
  ];
  const write = (n, name, input) => [call(n, name, input), { $sleep: 300 }, { $write: { file: abs, text: fileWith(steps[n - 1], 50 + n) } }, result(n)];
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-cursor-name' },
    { $waitFor: gate(1) }, // the page has the file open
    // 1: the path without .dpx.json, encoded.
    ...write(1, 'Bash', { command: curl(encodeURIComponent(rel)) }),
    { $sleep: GAP_MS },
    // 2: partly encoded (the space only), still without the extension.
    ...write(2, 'Bash', { command: curl(rel.replace(' ', '%20')) }),
    { $sleep: GAP_MS },
    // 3: a script that names the file is written, then run later: the write comes from `bash save.sh`.
    call(30, 'Write', { file_path: join(ws, 'save.sh'), content: curl(encodeURIComponent(rel)) }),
    result(30),
    ...write(3, 'Bash', { command: 'bash save.sh' }),
    { $sleep: GAP_MS },
    // 4: the full path with the extension (this one always worked).
    ...write(4, 'Bash', { command: curl(encodeURIComponent(`${rel}.dpx.json`)) }),
    { $sleep: GAP_MS },
    // 5: the script again.
    ...write(5, 'Bash', { command: 'bash save.sh' }),
    { $waitFor: gate(2) }, // the test has seen the last write
    { type: 'assistant', message: { id: 'm9', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ];
  const fake = fakeCliBin({ scenario });
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

  const req = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  await req('POST', '/api/file', { path: `${rel}.dpx.json`, title: '서버 저장', document: { type: 'doc', content: [h('서버 저장')] } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=${encodeURIComponent(`${rel}.dpx.json`)}`);
  await page.locator('.doc-editor h2', { hasText: '서버 저장' }).waitFor();

  // Every name the label shows and whether the cursor is there, on every frame from here on.
  await page.evaluate(() => {
    const names = (window.__names = []);
    const gaps = (window.__gaps = []);
    let seen = false;
    const tick = () => {
      const el = document.querySelector('[data-doc-agent-cursor] .agent-cursor-name');
      if (el) {
        seen = true;
        if (names.at(-1) !== el.textContent) names.push(el.textContent);
      } else if (seen) gaps.push(performance.now());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await req('POST', '/api/providers/claude/login');
  const { sessions } = await req('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'write the doc' }], worktree: false });
  const name = sessions[0].name;
  assert.ok(name);
  const started = Date.now();
  release(1);

  await page.locator('.doc-editor p', { hasText: '첫 번째' }).waitFor({ timeout: 15_000 });
  const cursor = page.locator('[data-doc-agent-cursor]');
  await cursor.waitFor({ state: 'attached', timeout: 10_000 });
  for (const word of ['두 번째', '세 번째', '네 번째', '다섯 번째']) {
    await page.locator('.doc-editor p', { hasText: word }).waitFor({ timeout: GAP_MS + 15_000 });
    // The caret follows each write: the server credited it to this session.
    await page.waitForFunction(
      (w) => {
        const el = document.querySelector('[data-doc-agent-cursor]');
        const block = [...document.querySelectorAll('.doc-editor p')].find((e) => e.textContent.includes(w));
        if (!el || !block || el.style.visibility === 'hidden') return false;
        const c = el.querySelector('.doc-agent-caret').getBoundingClientRect();
        const b = block.getBoundingClientRect();
        return c.top >= b.top - 2 && c.bottom <= b.bottom + 2;
      },
      word,
      { timeout: 10_000, polling: 'raf' },
    );
    assert.equal(await cursor.locator('.agent-cursor-name').textContent(), name, `after "${word}"`);
  }
  const took = Date.now() - started;
  assert.ok(took >= 25_000, `the writes were spread out: ${took} ms`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'agent-cursor-name.png') });

  const names = await page.evaluate(() => window.__names);
  assert.deepEqual(names, [name], `the label only ever showed the session's name: ${JSON.stringify(names)}`);
  assert.deepEqual(await page.evaluate(() => window.__gaps), [], 'the cursor stayed between the writes');
  // Only this session's cursor: no outside-writer cursor next to it.
  assert.equal(await page.locator('[data-doc-agent-cursor]').count(), 1);

  release(2);
  await cursor.waitFor({ state: 'detached', timeout: 15_000 });
  assert.deepEqual(errors, []);
});
