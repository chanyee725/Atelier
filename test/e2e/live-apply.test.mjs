// Headless check of live apply (E520, #543): an outside writer changes files through the API in steps; each step
// shows up without a page reload, and the open document keeps its scroll position.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server runs on a free port with a scratch workspace in a scratch git repo; it refuses to go on unless its log names both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { which } from '../../server/dispatch/cli.js';

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

const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const head = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });
const docOf = (...c) => ({ type: 'doc', content: c });
const CODE = (n) => `Start [icon: server] > ${Array.from({ length: n }, (_, i) => `Node${i}`).join(' > ')}`;

test('outside changes apply live: new file, new paragraphs, a growing diagram', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-live-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-live-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const port = await freePort();
  const PATH = dirname(which('git'));
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
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
  const q = (p) => `/api/file?path=${encodeURIComponent(p)}`;
  // What an outside writer does: read the file, change it, write it back against the revision it read.
  const write = async (path, patch) => {
    const cur = await call('GET', q(path));
    return call('PUT', q(path), { revision: cur.revision, title: cur.title, document: cur.document, canvas: cur.canvas, blocks: cur.blocks, ...patch });
  };

  const filler = Array.from({ length: 60 }, (_, i) => para(`Filler line ${i} of the open document.`));
  await call('POST', '/api/file', { path: 'open.dpx.json', title: 'open', document: docOf(head('Intro'), ...filler) });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=open.dpx.json`);
  await page.locator('.doc-editor').waitFor();
  await page.evaluate(() => (window.__sentinel = 'same page'));

  // Scroll the document down and put the cursor in a paragraph near the top of the view.
  const scrolled = await page.evaluate(() => {
    let el = document.querySelector('.doc-editor');
    while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement;
    if (!el) return -1;
    el.scrollTop = 600;
    window.__scroller = el;
    return el.scrollTop;
  });
  assert.ok(scrolled > 300, `document did not scroll: ${scrolled}`);
  const before = await page.evaluate(() => window.__scroller.scrollTop);

  // Step 1: a new project folder appears in the open page's sidebar, and a new root file on the home page, without a reload.
  const home2 = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  home2.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await home2.goto(`${BASE}/`);
  await home2.locator('[data-doc-row="open.dpx.json"]').waitFor({ timeout: 10_000 });
  await home2.evaluate(() => (window.__sentinel = 'same home'));
  await call('POST', '/api/folder', { path: 'made-by-agent' });
  await page.locator('[data-move-path="made-by-agent"]').waitFor({ timeout: 10_000 });
  await call('POST', '/api/file', { path: 'made-by-agent.dpx.json', title: 'Made by agent', document: docOf(para('hello')) });
  await home2.locator('[data-doc-row="made-by-agent.dpx.json"]').waitFor({ timeout: 10_000 });
  assert.equal(await home2.evaluate(() => window.__sentinel), 'same home', 'the home page reloaded');
  await home2.close();

  // Step 2: paragraphs and a heading are added to the open document, then text changes in place, then a block goes.
  await write('open.dpx.json', { document: docOf(head('Intro'), ...filler, head('Added heading'), para('Added by the agent, step one.')) });
  await page.getByText('Added by the agent, step one.').waitFor({ timeout: 10_000 });
  await page.locator('.doc-editor h2', { hasText: 'Added heading' }).waitFor();
  await write('open.dpx.json', { document: docOf(head('Intro'), ...filler.slice(0, 59), head('Added heading'), para('Added by the agent, step two (changed).')) });
  await page.getByText('step two (changed)').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('step one.') && !document.body.innerText.includes('Filler line 59'), null, { timeout: 5000 });
  const afterText = await page.evaluate(() => ({ s: window.__scroller.scrollTop, same: window.__sentinel }));
  assert.equal(afterText.same, 'same page', 'the page reloaded');
  assert.ok(Math.abs(afterText.s - before) <= 2, `document scroll jumped: ${before} -> ${afterText.s}`);

  // This page's own save (the document autosaves) must not raise an outside-writer cursor or reload anything.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.doc-editor p')].find((p) => { const r = p.getBoundingClientRect(); return r.top > 250 && r.bottom < 600; });
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.querySelector('.doc-editor').focus();
  });
  await page.keyboard.type('x');
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('[data-agent-cursor]').count(), 0, 'this page\'s own save raised a cursor');
  assert.equal(await page.evaluate(() => window.__sentinel), 'same page', 'the page reloaded after its own save');

  // Step 3: a diagram grows over several writes; each shows without a page reload.
  const blockId = 'b_live1';
  let doc = docOf(head('Intro'), ...filler.slice(0, 59), head('Added heading'), para('Added by the agent, step two (changed).'));
  doc = { ...doc, content: [...doc.content, { type: 'diagram', attrs: { blockId } }] };
  let mine = null;
  const zoom = async () => parseInt(await page.locator('.reset-zoom-button').first().innerText(), 10);
  for (const n of [2, 4, 6]) {
    await write('open.dpx.json', { document: doc, blocks: [{ id: blockId, type: 'architecture', code: CODE(n), x: 0, y: 0, w: 400, h: 300 }] });
    // The first write adds the diagram to the document; later ones change it while the canvas view is up.
    if (mine === null) await page.waitForFunction(() => document.querySelectorAll('figure.doc-diagram img').length > 0, null, { timeout: 15_000 });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__sentinel), 'same page', `the page reloaded at ${n} nodes`);
    if (mine === null) {
      // The canvas is up: zoom out, the user's own zoom must survive the next outside writes.
      const end = await page.evaluate(() => window.__scroller.scrollTop);
      assert.ok(Math.abs(end - before) <= 2, `document scroll jumped while the diagram grew: ${before} -> ${end}`);
      await page.getByRole('button', { name: '캔버스', exact: true }).click();
      await page.waitForSelector('.excalidraw canvas', { timeout: 30_000 });
      await page.waitForTimeout(1500);
      for (let i = 0; i < 2; i++) await page.locator('.zoom-out-button').first().click();
      await page.waitForTimeout(400);
      mine = await zoom();
    } else {
      assert.equal(await zoom(), mine, `the zoom changed at ${n} nodes`);
      // An API write with no session behind it shows the generic cursor.
      await page.locator('[data-agent-cursor]', { hasText: '에이전트' }).first().waitFor({ timeout: 8000 });
    }
  }
  assert.deepEqual(errors, []);
});
