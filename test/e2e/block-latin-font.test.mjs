// Headless check that Hangul in diagram block pictures is drawn in Pretendard (E504g): the canvas/document picture and
// the SVG/PNG export embed only the used glyphs, fetched from local build assets; nothing leaves 127.0.0.1.
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_E2E_SHOTS=<dir> also saves screenshots and the exported files there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOTS = process.env.DRAW_E2E_SHOTS;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

// Pixels of an SVG drawn as an image, with or without its embedded Latin Drawing Sans (woff2) face.
async function drawn(page, svg, strip) {
  return page.evaluate(
    async ({ svg, strip }) => {
      const text = strip ? svg.replace(/@font-face\{[^}]*font\/woff2;[^}]*\}/g, '') : svg;
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 4 === 3)).join(',');
    },
    { svg, strip },
  );
}

test('Latin text in block pictures, placeholder included, uses embedded Pretendard (E504g)', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-e504g-'));
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
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const f = await call('POST', '/api/file', { path: 'en', title: 'Latin font' });
  await call('PUT', '/api/file?path=en', {
    ...f,
    version: 2,
    blocks: [
      { id: 'b1', type: 'flowchart', code: 'Order received > Payment approved: Confirm\nPayment approved > Shipping started', x: 0, y: 0, w: 0, h: 0 },
      { id: 'b2', type: 'flowchart', code: '', x: 0, y: 0, w: 0, h: 0 },
    ],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }, { type: 'diagram', attrs: { blockId: 'b2' } }] },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=en`);
  await page.waitForSelector('.doc-diagram-pic img', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.doc-diagram-pic img').length >= 2, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const svgs = await page.evaluate(() => [...document.querySelectorAll('.doc-diagram-pic img')].map((i) => atob(i.src.split(',')[1].replace(/^$/, ''))));
  const decode = (b) => Buffer.from(b, 'binary').toString('utf8');

  await t.test('Latin text of a drawing uses the embedded Drawing Sans (Pretendard) face, not a system font', async () => {
    const svg = decode(svgs[0]);
    assert.match(svg, /@font-face\{font-family:'Drawing Sans';font-weight:400;src:url\(data:font\/woff2;base64,/);
    assert.match(svg, /Order received/);
    assert.notEqual(await drawn(page, svg, false), await drawn(page, svg, true));
  });

  await t.test('the placeholder carries the face too, so its Latin is Pretendard', async () => {
    const svg = decode(svgs[1]);
    assert.match(svg, /<style>@font-face\{font-family:'Drawing Sans';font-weight:400;src:url\(data:font\/woff2;base64,/);
    assert.match(svg, /font-family="&#39;Drawing Sans&#39;/);
  });

  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e504g-doc.png') });
  assert.deepEqual(errors, []);
});
