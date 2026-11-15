// Headless check that Hangul in diagram block pictures is drawn in Pretendard (E504f): the canvas/document picture and
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

// Pixels of an SVG drawn as an image, with or without its embedded Pretendard (woff) faces.
async function drawn(page, svg, strip) {
  return page.evaluate(
    async ({ svg, strip }) => {
      const text = strip ? svg.replace(/@font-face\{[^}]*font\/woff;[^}]*\}/g, '') : svg;
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

test('Hangul in diagram pictures and exports uses embedded Pretendard glyphs (E504f)', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-e504f-'));
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
  const f = await call('POST', '/api/file', { path: 'kr', title: '한글 글꼴' });
  const code = '주문 접수 > 결제 승인: 확인\n결제 승인 > 배송 시작';
  await call('PUT', '/api/file?path=kr', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'flowchart', code, x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const origins = new Set();
  const fonts = [];
  const errors = [];
  page.on('request', (r) => {
    if (/^(data|blob):/.test(r.url())) return;
    origins.add(new URL(r.url()).origin);
    if (/Pretendard-\w+\.subset\.\d+-[\w-]+\.woff$/.test(new URL(r.url()).pathname)) fonts.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=kr`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForSelector('.doc-diagram-pic img', { timeout: 30000 });
  await page.waitForTimeout(1500);

  await t.test('the document picture embeds only the used Hangul, as Drawing Sans', async () => {
    const src = await page.locator('.doc-diagram-pic img').first().getAttribute('src');
    const svg = Buffer.from(src.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');
    const faces = svg.match(/@font-face\{[^}]*font\/woff;[^}]*\}/g) ?? [];
    assert.ok(faces.length >= 1, 'a Pretendard face is embedded');
    for (const face of faces) assert.match(face, /^@font-face\{font-family:'Drawing Sans';font-weight:(400|600);src:url\(data:font\/woff;base64,[A-Za-z0-9+/=]+\) format\('woff'\);unicode-range:U\+[0-9a-f]+(,U\+[0-9a-f]+)*\}$/);
    const ranges = faces.flatMap((x) => /unicode-range:([^}]+)/.exec(x)[1].split(',')).map((u) => String.fromCodePoint(parseInt(u.slice(2), 16)));
    assert.deepEqual([...new Set(ranges)].sort(), [...new Set([...code.replace(/[^가-힣]/g, '')])].sort(), 'exactly the Hangul in the code');
    assert.ok(fonts.length >= 1 && fonts.length <= 12, `fetched ${fonts.length} font files`);
    // The embedded glyphs, not a system font, draw the Hangul.
    assert.notEqual(await drawn(page, svg, false), await drawn(page, svg, true));
  });

  await t.test('the page Pretendard is there for inline diagram SVG', async () => {
    const n = await page.evaluate(async () => (await document.fonts.load('16px "Pretendard Variable"', '한')).length);
    assert.ok(n >= 1);
  });

  const downloadBlock = async (kind) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export-block="${kind}"]`).first().click()]);
    const path = await dl.path();
    if (SHOTS) copyFileSync(path, join(SHOTS, `e504f-export.${kind}`));
    return readFileSync(path);
  };

  await t.test('SVG and PNG export carry the Hangul faces and no outside address', async () => {
    const svg = (await downloadBlock('svg')).toString('utf8');
    assert.match(svg, /@font-face\{font-family:'Drawing Sans';font-weight:\d+;src:url\(data:font\/woff;base64,/);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no external address in the SVG');
    assert.ok(svg.length < 200_000, `${svg.length} bytes`);
    const png = await downloadBlock('png');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  });

  await t.test('the canvas picture embeds the faces too, and nothing left 127.0.0.1', async () => {
    const files = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')].map((i) => i.src).filter((s) => s.startsWith('data:image/svg+xml'));
      return imgs.map((s) => atob(s.split(',')[1]).includes('font/woff;'));
    });
    assert.ok(files.length >= 1 && files.every(Boolean));
    if (SHOTS) {
      await page.screenshot({ path: join(SHOTS, 'e504f-app.png') });
      await page.locator('.doc-diagram-pic').first().screenshot({ path: join(SHOTS, 'e504f-doc-block.png') });
    }
    assert.deepEqual([...origins], [BASE]);
    assert.deepEqual(errors, []);
  });
});
