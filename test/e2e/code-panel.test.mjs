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

const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';

/**
 * Scratch repo (one commit, src/app.py with 200 lines), a server on a free port against its docs/ folder, one file
 * written through the API by `seed(call)`, and a headless page on the canvas view of that file.
 */
async function openCanvas(t, file, seed) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-code-'));
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { stdio: 'ignore' });
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.py'), Array.from({ length: 200 }, (_, i) => `line_${i + 1} = ${i + 1}`).join('\n') + '\n');
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
  await seed(call);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=${file}`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift+1');
  await page.waitForTimeout(500);
  return { page, errors };
}

test('code badge opens the panel with the range highlighted; Esc closes it', { skip: SKIP, timeout: 120_000 }, async (t) => {
  const { page, errors } = await openCanvas(t, 'code', async (call) => {
    const f = await call('POST', '/api/file', { path: 'code', title: 'Code' });
    await call('PUT', '/api/file?path=code', {
      ...f,
      version: 2,
      blocks: [{ id: 'b1', type: 'architecture', code: 'Web [icon: user, code: "src/app.py:40-44#run"]\nApi [code: "src/app.py:100-160#long"]\nWeb > Api', x: 0, y: 0, w: 0, h: 0 }],
      document: { type: 'doc', content: [{ type: 'diagram', attrs: { blockId: 'b1' } }] },
    });
  });

  // Only the node with code has a badge.
  const badge = page.locator('[data-code-badge="Web"]');
  await badge.waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-code-badge]').count(), 2);

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

  // #538: a shorter window shrinks the preview box; the short range is centred again in the new box.
  const centreOffset = async () => {
    const b = await preview.boundingBox();
    const hlBoxes = await panel.locator('[data-hl]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom]));
    return (hlBoxes[0][0] + hlBoxes.at(-1)[1]) / 2 - (b.y + b.height / 2);
  };
  assert.ok(Math.abs(await centreOffset()) <= 3, `range centred before resize (${await centreOffset()})`);
  await page.setViewportSize({ width: 1500, height: 700 });
  await page.waitForTimeout(400);
  assert.ok(Math.abs(await centreOffset()) <= 3, `range centred again after resize (${await centreOffset()})`);
  // Once the user scrolls the preview, a resize leaves their position alone.
  await preview.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.waitForTimeout(400);
  assert.equal(await preview.evaluate((el) => el.scrollTop), 0, 'a user scroll is kept on resize');

  // #528: the node is selected, yet the left style panel stays hidden while the code panel is open.
  const style = page.locator('.excalidraw .App-menu__left');
  assert.equal(await style.isVisible(), false, 'style panel hidden while the code panel is open');
  // Closing the code panel with the node still selected brings the style panel back.
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await style.waitFor({ state: 'visible', timeout: 5000 });
  await badge.click();
  await panel.waitFor();
  assert.equal(await style.isVisible(), false, 'style panel hidden again on reopen');

  // #526: a long range (100-160) opens with its FIRST line visible near the top of the preview, not the middle.
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await page.locator('[data-code-badge="Api"]').click();
  await panel.waitFor();
  await panel.getByRole('heading', { name: 'Api' }).waitFor();
  await panel.locator('[data-code-ref="src/app.py:100-160"]').waitFor();
  const longHl = panel.locator('[data-hl]');
  await longHl.first().waitFor();
  assert.equal(await longHl.count(), 61);
  const pBox = await preview.boundingBox();
  const l1 = await longHl.first().boundingBox();
  assert.ok(l1.y >= pBox.y && l1.y - pBox.y <= 40, `first highlighted line near the top of the preview (offset ${l1.y - pBox.y})`);
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await badge.click();
  await panel.getByRole('heading', { name: 'Web' }).waitFor();

  // An open menu owns Esc: the first press closes only the menu, the second closes the panel.
  await page.locator('[data-testid="main-menu-trigger"]').click();
  await page.locator('.excalidraw .dropdown-menu, .excalidraw [role="menu"]').first().waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.excalidraw .dropdown-menu, .excalidraw [role="menu"]').count(), 0, 'first Esc closes the menu');
  assert.equal(await panel.count(), 1, 'the panel stays while a menu was open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 0, 'second Esc closes the panel');

  // #493/#511: while the "다이어그램 코드" panel covers it, the hidden code panel ignores Esc and comes back after.
  await badge.click();
  await panel.getByRole('heading', { name: 'Web' }).waitFor();
  const at = await badge.boundingBox();
  await page.mouse.dblclick(at.x - 20, at.y + 20);
  const blockPanel = page.getByRole('complementary', { name: '다이어그램 코드' });
  await blockPanel.waitFor({ timeout: 5000 });
  assert.equal(await panel.count(), 0, 'code panel hidden behind the diagram-code panel');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await blockPanel.count()) await blockPanel.getByRole('button', { name: '닫기', exact: true }).click();
  await blockPanel.waitFor({ state: 'detached' });
  await panel.getByRole('heading', { name: 'Web' }).waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
});

test('a code-linked free-form shape opens the panel and keeps the style panel visible', { skip: SKIP, timeout: 120_000 }, async (t) => {
  const { page, errors } = await openCanvas(t, 'shape', async (call) => {
    const f = await call('POST', '/api/file', { path: 'shape', title: 'Shape' });
    const base = { angle: 0, strokeColor: '#1e1e1e', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, updated: 1, link: null, locked: false };
    const rect = {
      ...base, id: 'shape_1', type: 'rectangle', x: 0, y: 0, width: 240, height: 120, backgroundColor: '#a5d8ff', fillStyle: 'solid', roundness: null,
      boundElements: [{ id: 'label_1', type: 'text' }],
      customData: { codeRefs: { refs: [{ path: 'src/app.py', start: 40, end: 44 }] } },
    };
    const label = {
      ...base, id: 'label_1', type: 'text', x: 90, y: 47, width: 60, height: 25, backgroundColor: 'transparent', fillStyle: 'solid', roundness: null, boundElements: null,
      text: '저장', originalText: '저장', fontSize: 20, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: 'shape_1', autoResize: true, lineHeight: 1.25,
    };
    await call('PUT', '/api/file?path=shape', { ...f, canvas: { ...f.canvas, elements: [rect, label] }, blocks: [] });
  });

  // #540: the badge is labelled with the shape's own text, not the generic "도형".
  await page.locator('[data-code-badge="저장"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-code-badge="도형"]').count(), 0);
  const panel = page.getByRole('complementary', { name: '기능 코드' });
  assert.equal(await panel.count(), 0);
  // A plain click on the shape selects it and opens the panel; its style panel stays.
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await panel.waitFor({ timeout: 10000 });
  assert.equal(await panel.locator('[data-code-ref="src/app.py:40-44"]').count(), 1);
  const style = page.locator('.excalidraw .App-menu__left');
  await style.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await style.isVisible(), true, 'style panel stays visible for a shape target');
  assert.equal(await panel.getByRole('heading', { name: '저장' }).count(), 1);
  // Closing the panel with the shape still selected leaves the style panel where it was.
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(await style.isVisible(), true, 'style panel still visible after closing the code panel');
  assert.deepEqual(errors, []);
});
