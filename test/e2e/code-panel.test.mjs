// Headless browser check: a `</>` badge on a node opens the "기능 코드" panel, the preview highlights the range, Esc closes it.
// Needs a Chromium and playwright-core, so it only runs on request:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace inside a scratch git repo (one commit, one
// tracked file) in a temp dir, and refuses to go on unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOT = process.env.DRAW_SHOT_DIR;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('code badge opens the panel with the range highlighted; Esc closes it', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-code-'));
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { stdio: 'ignore' });
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.py'), Array.from({ length: 80 }, (_, i) => `line_${i + 1} = ${i + 1}`).join('\n') + '\n');
  git('add', 'src/app.py');
  git('commit', '-q', '-m', 'init');
  const ws = join(repo, 'docs');
  mkdirSync(ws);
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
    rmSync(repo, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  const f = await call('POST', '/api/file', { path: 'code', title: 'Code' });
  await call('PUT', '/api/file?path=code', {
    ...f,
    version: 2,
    blocks: [{ id: 'b1', type: 'architecture', code: 'Web [icon: user, code: "src/app.py:40-44#run"]\nApi\nWeb > Api', x: 0, y: 0, w: 0, h: 0 }],
    document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=code`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(500);

  // Only the node with code has a badge.
  const badge = page.locator('[data-code-badge="Web"]');
  await badge.waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-code-badge]').count(), 1);

  const panel = page.getByRole('complementary', { name: '기능 코드' });
  assert.equal(await panel.count(), 0);
  await badge.click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('heading', { name: 'Web' }).count(), 1);
  assert.equal(await panel.locator('[data-code-ref="src/app.py:40-44"]').count(), 1);

  // The preview shows the range highlighted, scrolled into view inside the preview box only.
  const preview = panel.locator('[data-code-preview]');
  await preview.waitFor();
  const hl = await panel.locator('[data-hl]').allInnerTexts();
  assert.equal(hl.length, 5);
  assert.match(hl[0], /40\s+line_40 = 40/);
  assert.match(hl[4], /44\s+line_44 = 44/);
  const box = await preview.boundingBox();
  const first = await panel.locator('[data-hl]').first().boundingBox();
  assert.ok(first.y >= box.y && first.y + first.height <= box.y + box.height, 'highlighted range is visible in the preview');
  assert.ok((await preview.evaluate((el) => el.scrollTop)) > 0, 'preview scrolled to the range');
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'the page itself did not scroll');
  if (SHOT) await page.screenshot({ path: join(SHOT, 'code-panel.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 0, 'Esc closes the panel');
  assert.deepEqual(errors, []);
});
