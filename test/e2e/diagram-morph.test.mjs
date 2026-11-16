// Headless check of live diagram morphs (E520, #543): an outside code change to a block animates old → new on the canvas
// and in the document preview (a morph layer shows, then goes), and the zoom the user chose stays. Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Needs `npm run build` first. It starts its own server on a free port against a scratch workspace inside a scratch
// git repo (one commit) in a temp dir. Other sessions' servers may share ports, so it refuses to go on (and writes
// nothing) unless the server log names this run's port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';
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



const run = async (t, part) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-morph-'));
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

  const api = (method, path, body) => fetch(`${BASE}/api/file${path ? `?path=${path}` : ''}`, { method, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: body && JSON.stringify(body) });
  const doc = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'diagram', attrs: { blockId: 'b1' } }] };
  const blk = (code) => ({ id: 'b1', type: 'flowchart', code, x: 0, y: 0, w: 900, h: 420 });
  const made = await api('POST', '', { path: 'morph.dpx.json', title: 'morph', document: doc, blocks: [blk('direction right\n\nA > B\n')] });
  assert.ok(made.ok, `POST /api/file: ${made.status}`);
  const put = async (code) => {
    const cur = await (await api('GET', 'morph.dpx.json')).json();
    const r = await api('PUT', 'morph.dpx.json', { ...cur, blocks: cur.blocks.map((b) => ({ ...b, code })) });
    assert.ok(r.ok, `PUT: ${r.status}`);
  };

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=morph.dpx.json`);
  await page.waitForSelector('.doc-diagram img', { timeout: 30000 });
  // A morph lasts ~250 ms: count the layers that appear instead of polling for one.
  await page.evaluate(() => {
    window.__morphs = { doc: 0, canvas: 0 };
    new MutationObserver(() => {
      window.__morphs.doc = Math.max(window.__morphs.doc, document.querySelectorAll('.doc-diagram [data-morph-layer]').length);
      window.__morphs.canvas = Math.max(window.__morphs.canvas, document.querySelectorAll('[data-morph-overlay] [data-morph-layer]').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  // Document preview: the picture morphs, then the layer goes and the new picture shows.
  // The page's own first save (if any) settles before an outside writer comes.
  await page.waitForTimeout(3000);
  const srcBefore = await page.locator('.doc-diagram img').getAttribute('src');
  await put('direction right\n\nA > B > C > D\n');
  await page.waitForFunction(() => window.__morphs.doc > 0, null, { timeout: 8000 });
  await page.waitForSelector('[data-morph-layer]', { state: 'detached', timeout: 4000 });
  assert.notEqual(await page.locator('.doc-diagram img').getAttribute('src'), srcBefore, 'the document picture shows the new drawing');
  if (part === 'doc') return assert.deepEqual(errors, []);
  // Canvas: zoom out, change again, the morph layer shows and the zoom stays.
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const zoom = async () => parseInt(await page.locator('.reset-zoom-button').first().innerText(), 10);
  for (let i = 0; i < 2; i++) await page.locator('.zoom-out-button').first().click();
  await page.waitForTimeout(400);
  const mine = await zoom();
  await put('direction right\n\nA > B > C > D > E > F\n');
  await page.waitForFunction(() => window.__morphs.canvas > 0, null, { timeout: 8000 });
  await page.waitForSelector('[data-morph-layer]', { state: 'detached', timeout: 4000 });
  assert.equal(await zoom(), mine, 'the zoom the user chose is kept');
  assert.deepEqual(errors, []);
};

test('an outside diagram change morphs in the document preview (E520)', { skip: SKIP, timeout: 180_000 }, (t) => run(t, 'doc'));
// The canvas pane stays mounted for an outside change of block code (canApplyLive in externalChange.ts).
test('an outside diagram change morphs on the canvas and the zoom stays (E520)', { skip: SKIP, timeout: 180_000 }, (t) => run(t, 'canvas'));
