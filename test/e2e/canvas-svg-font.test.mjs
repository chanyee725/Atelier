// Headless browser check that an SVG export carries the canvas font inside it (E504e, #453). Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const STR = '한글 라벨 Label 123';
const label = {
  id: 'hello',
  type: 'text',
  x: 100,
  y: 100,
  width: 200,
  height: 15,
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 5,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  index: 'a0',
  text: STR,
  originalText: STR,
  fontSize: 13,
  fontFamily: 9,
  textAlign: 'left',
  verticalAlign: 'top',
  containerId: null,
  autoResize: true,
  lineHeight: 1.15,
};

test('an SVG export of a canvas with Hangul text inlines the canvas font', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-svg-font-'));
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
  const f = await call('POST', '/api/file', { path: 'svgfont', title: '글꼴' });
  await call('PUT', '/api/file?path=svgfont', { ...f, canvas: { ...f.canvas, elements: [label] } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  const fontLogs = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  page.on('console', (m) => /font family|Maximum call stack/i.test(m.text()) && fontLogs.push(m.text().slice(0, 300)));
  await page.goto(`${BASE}/#file=svgfont`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(1000);

  await page.mouse.click(1200, 750);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  await page.getByRole('menu', { name: '내보내기' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export="svg"]').click()]);
  const svg = readFileSync(await dl.path(), 'utf8');

  assert.match(svg, /^<svg/);
  assert.ok(svg.includes('한글'), 'the Hangul text is in the SVG');
  const face = svg.match(/@font-face\s*\{[^}]*font-family:\s*"?Liberation Sans"?;[^}]*src:\s*url\(([^)]{0,60})/);
  assert.ok(face, `a face for the canvas font: ${svg.slice(0, 600)}`);
  assert.ok(face[1].startsWith('data:font/woff2;base64,'), `the face is inlined, not linked: ${face[1]}`);
  assert.ok(!svg.includes('127.0.0.1'), 'no loopback address in the SVG');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no address at all, other than the SVG namespace');
  // The inlined data is a real WOFF2 file.
  const b64 = svg.slice(svg.indexOf('data:font/woff2;base64,') + 'data:font/woff2;base64,'.length).match(/^[A-Za-z0-9+/=]+/)[0];
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(bytes.length > 10_000, `the face holds the font: ${bytes.length} bytes`);
  assert.deepEqual(fontLogs, [], 'no font failure on the console');
  assert.deepEqual(errors, []);
});
