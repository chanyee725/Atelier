// Headless browser check for the idle "move the canvas" hint (E503, #438). Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SKIP = { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 };
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const rect = (id, extra = {}) => ({
  id, type: 'rectangle', x: 200, y: 200, width: 160, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
  fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
  seed: 1, version: 5, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, index: 'a0', ...extra,
});

async function open(t, path, elements) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-hint-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.js', ws], { env: { ...process.env, DRAW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    rmSync(ws, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  // Another session's server may share ports: write only once the log names this workspace.
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);
  const call = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) })).json();
  const f = await call('POST', '/api/file', { path, title: '안내' });
  if (elements.length) await call('PUT', `/api/file?path=${path}`, { ...f, canvas: { ...f.canvas, elements } });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(`${BASE}/#file=${path}`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(800);
  return page;
}

// The canvas must still be on screen, or a missing hint would prove nothing.
const shown = async (page) => {
  assert.equal(await page.locator('.excalidraw canvas').count() > 0, true, 'the canvas is open');
  return page.locator('.excalidraw .HintViewer').first().isVisible();
};

test('the pan hint shows on an empty canvas and is hidden once elements are there', SKIP, async (t) => {
  const page = await open(t, 'empty', []);
  assert.equal(await shown(page), true, 'empty canvas shows the hint');
  await page.mouse.click(1100, 700); // focus the canvas first
  await page.keyboard.press('r');
  await page.mouse.move(600, 300);
  await page.mouse.down();
  await page.mouse.move(750, 400, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(1100, 700);
  await page.waitForTimeout(400);
  assert.equal(await shown(page), false, 'hidden after drawing a shape');
  await page.mouse.click(600, 350); // the left edge: select the shape, then delete it
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  await page.mouse.click(1100, 700);
  await page.waitForTimeout(400);
  assert.equal(await shown(page), true, 'deleted elements do not count: shown again');
});

test('the pan hint is hidden when a file with elements is loaded', SKIP, async (t) => {
  const page = await open(t, 'loaded', [rect('r')]);
  assert.equal(await shown(page), false);
});

test('a file holding only deleted elements still shows the hint', SKIP, async (t) => {
  const page = await open(t, 'deleted', [rect('gone', { isDeleted: true })]);
  assert.equal(await shown(page), true);
});
