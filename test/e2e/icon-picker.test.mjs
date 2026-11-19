// Headless browser check (#734): the icon picker in the code panel searches the bundled icons and writes the picked
// one onto the node at the caret; the drawing shows it, and no request leaves the local server.
// Needs a Chromium and playwright-core, so it only runs on request:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('icon picker puts a bundled icon on the node at the caret', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-icons-'));
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
    rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const f = await call('POST', '/api/file', { path: 'icons', title: 'Icons' });
  await call('PUT', '/api/file?path=icons', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'architecture', code: 'title T\nWeb\nPostgres DB\nAWS Lambda', x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  const outside = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  page.on('request', (r) => !r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && outside.push(r.url()));
  await page.goto(`${BASE}/#file=icons`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);

  const panel = page.getByRole('complementary', { name: '다이어그램 코드' });
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(400);
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await panel.locator('.cm-content').waitFor();
  const text = async () => (await panel.locator('.cm-content').innerText()).replace(/\u00a0/g, ' ');

  // Caret on "Web", search, pick the first match with Enter.
  await panel.locator('.cm-line').nth(1).click();
  await panel.locator('[data-icon-picker]').click();
  const input = page.getByPlaceholder('아이콘 찾기 (postgres, aws-ec2 …)');
  await input.waitFor();
  await input.fill('aws ec2');
  await page.locator('[data-slot="command-item"]').first().waitFor();
  assert.equal(await page.locator('[data-slot="command-item"]').first().getAttribute('data-value'), 'aws-ec2');
  assert.ok(await page.locator('[data-slot="command-item"] svg').first().isVisible(), 'a preview is drawn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(tmpdir(), 'atelier-icon-picker.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.equal(await text(), 'title T\nWeb [icon: aws-ec2]\nPostgres DB\nAWS Lambda');
  assert.equal(await panel.isVisible(), true, 'the code panel stays open');

  // Escape closes only the picker.
  await panel.locator('[data-icon-picker]').click();
  await input.waitFor();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await input.count(), 0);
  assert.equal(await panel.isVisible(), true);

  // The per-diagram switch writes `autoIcons off`.
  await panel.locator('[data-prop="autoIcons"]').selectOption('off');
  await page.waitForTimeout(300);
  assert.match(await text(), /^title T\nautoIcons off\n/);
  assert.deepEqual(errors, []);
  assert.deepEqual(outside, [], 'no request leaves the local server');
});
