// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// Project mode (E30a): the server started with --project-mode opens only the Dispatch run screen.
// Scratch git repo in a temp dir, scratch HOME, fake CLIs only; the server log must name this workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
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

test('project mode: / opens the run screen, not the editor', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 60_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-pmode-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-pmode-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'pipelines');
  mkdirSync(ws);
  const fake = fakeCliBin({ scenario: [] });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', '--project-mode', ws], {
    env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  let browser;
  t.after(async () => {
    await browser?.close();
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForURL(/\/dispatch$/);
  await page.getByText('세션', { exact: true }).first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-testid="sidebar"], aside').count(), 0, 'no editor sidebar');
  // E30d: the run header is exactly 48px tall at 1280px (it was 49px).
  const headerH = await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().height);
  assert.equal(headerH, 48, `run header height ${headerH}`);
  // E30c: the PR/CI switch is on the run screen and flips through the real route.
  const sw = page.getByRole('switch', { name: 'PR·CI 추적', exact: true });
  await sw.waitFor({ timeout: 10_000 });
  assert.equal(await sw.isChecked(), true);
  await sw.click();
  await page.getByRole('switch', { name: 'PR·CI 추적', exact: true, checked: false }).waitFor();
  const on = async () => (await (await fetch(`http://127.0.0.1:${port}/api/workspace/pr-tracking`)).json()).on;
  assert.equal(await on(), false);
  await sw.click();
  await page.getByRole('switch', { name: 'PR·CI 추적', exact: true, checked: true }).waitFor();
  assert.equal(await on(), true);

  // The header nav stays whole next to the switch at phone and desktop widths, also with a broken settings.json (409).
  const nav = page.getByRole('navigation', { name: '세션 화면' });
  const navFits = () =>
    nav.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { fits: r.width > 0 && el.scrollWidth <= el.clientWidth + 1 && r.left >= 0 && r.right <= innerWidth + 1, width: r.width, scroll: el.scrollWidth };
    });
  const errorText = page.getByText('설정 파일을 읽을 수 없어요.');
  for (const broken of [false, true]) {
    if (broken) writeFileSync(join(ws, '.drawing', 'settings.json'), '{ not json');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.reload();
      await sw.waitFor({ timeout: 10_000 });
      if (broken) await errorText.waitFor({ timeout: 10_000 });
      const m = await navFits();
      // #431: 48px at phone width too while there is no error line (the height comes from min-h, not from padding).
      if (!broken) assert.equal(await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().height), 48, `run header height at ${width}px`);
      assert.ok(m.fits, `nav clipped at ${width}px (broken settings: ${broken}): ${JSON.stringify(m)}`);
      if (broken) {
        const box = await errorText.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `error text off screen at ${width}px`);
      }
    }
  }
  // The name stays fixed; the broken-file cause reaches screen readers as the description.
  const described = await sw.evaluate((el) => (el.getAttribute('aria-describedby') || '').split(' ').map((id) => document.getElementById(id)?.textContent).join(' '));
  assert.equal(await sw.getAttribute('aria-label'), null, 'name comes from the visible label, not a duplicate aria-label');
  assert.match(described, /설정 파일을 읽을 수 없어요/);
  assert.deepEqual(errors, []);
});
