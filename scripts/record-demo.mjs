// Records the README demo video headlessly: write a document, add a diagram with `/`, edit its code and watch the
// picture change, touch it up on the canvas, then the session board with one running (fake) agent.
//
//   npm run build
//   CHROME=/path/to/chrome PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/record-demo.mjs [outDir]
//
// outDir defaults to docs/images. PLAYWRIGHT_CORE must match a Playwright ffmpeg build in ~/.cache/ms-playwright
// (recordVideo needs it); the system ffmpeg then turns the raw video into demo.mp4 (H.264, 1280px wide). No GIF is made.
//
// No new dependency: it uses an existing playwright-core and Chrome, like the e2e tests. The server runs on a free
// port against a scratch workspace inside a scratch git repo (one commit) in a temp dir, with a scratch HOME and the
// fake agent CLIs from test/fixtures, so no real provider, path, name or token reaches the screen. It refuses to go
// on unless the server's own log names that port and workspace.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../test/fixtures/fake-cli/index.mjs';
import { which } from '../server/dispatch/cli.js';

const { CHROME, PLAYWRIGHT_CORE } = process.env;
if (!CHROME || !PLAYWRIGHT_CORE) {
  console.error('set CHROME and PLAYWRIGHT_CORE (see the header of this file)');
  process.exit(2);
}
const outDir = resolve(process.argv[2] ?? 'docs/images');
const SHOTS = process.env.DEMO_SHOTS; // optional folder for step screenshots
const W = 1440;
const H = 900;

const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scratch = mkdtempSync(join(tmpdir(), 'demo-'));
// A fixed folder name, so the sidebar shows "atelier-demo" and not a random temp name.
const repo = join(scratch, 'atelier-demo');
mkdirSync(repo);
const home = mkdtempSync(join(tmpdir(), 'demo-home-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 'demo', GIT_AUTHOR_EMAIL: 'demo@example.invalid', GIT_COMMITTER_NAME: 'demo', GIT_COMMITTER_EMAIL: 'demo@example.invalid' } });
git('init', '-q');
writeFileSync(join(repo, 'README'), 'demo\n');
git('add', '.');
git('commit', '-qm', 'init');
const ws = join(repo, 'workspace');
mkdirSync(ws);
const gate = join(home, 'gate-end');
const fake = fakeCliBin({
  scenario: [
    { type: 'system', subtype: 'init', session_id: 'fake-demo' },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { $waitFor: gate },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ],
});
const port = await freePort();
const PATH = `${fake.dir}:${dirname(which('git'))}`;
const server = spawn(process.execPath, ['server/index.js', ws], {
  env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
const BASE = `http://127.0.0.1:${port}`;
let browser;
const cleanup = async () => {
  writeFileSync(gate, '');
  await browser?.close().catch(() => {});
  server.kill();
  fake.cleanup();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};

try {
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await sleep(100);
  if (!(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`))) throw new Error(`unexpected server log: ${log}`);
  const call = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    if (!res.ok) throw new Error(`${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };

  // Fake data: one project with a document, a few tasks, and one running fake session.
  await call('POST', '/api/file', { path: '결제 서비스/주문 흐름', title: '주문 흐름' });
  await call('POST', '/api/file', { path: '결제 서비스/환불 규칙', title: '환불 규칙' });
  await call('POST', '/api/tasks', { title: '주문 API 만들기', stage: 'impl', owner: 'Ivy', eta_minutes: 25 });
  await call('POST', '/api/tasks', { title: '결제 화면 검토', stage: 'review', owner: 'Rae' });
  await call('POST', '/api/tasks', { title: '환불 규칙 정리', stage: 'plan', owner: 'Noa', eta_minutes: 40 });
  await call('POST', '/api/providers/claude/login');
  await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: '주문 API 테스트 돌리기' }], worktree: false });

  const { chromium } = await import(pathToFileURL(join(PLAYWRIGHT_CORE, 'index.mjs')).href);
  browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(scratch, 'video'), size: { width: W, height: H } } });
  await ctx.addInitScript(() => localStorage.setItem('drawing.theme', 'dark'));
  const page = await ctx.newPage();
  let n = 0;
  const shot = async (name) => SHOTS && page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
  const row = (re) => page.getByRole('navigation', { name: '사이드바' }).locator('[data-slot="sidebar-menu-button"]').filter({ hasText: re }).first();

  await page.goto(BASE);
  await row(/결제 서비스/).click();
  await row(/^주문 흐름/).click();
  const doc = page.locator('.ProseMirror');
  await doc.waitFor();
  await page.getByRole('button', { name: '문서', exact: true }).click();
  await sleep(600);

  // 1. Write the document.
  await doc.click();
  await page.keyboard.type('# 주문 흐름', { delay: 90 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('주문이 들어오면 API가 결제를 확인하고 DB에 저장해요.', { delay: 70 });
  await page.keyboard.press('Enter');
  await sleep(400);
  await shot('doc');

  // 2. `/` → 새 다이어그램.
  await page.keyboard.type('/다이어', { delay: 120 });
  await sleep(700);
  await shot('slash');
  await page.getByRole('option', { name: /새 다이어그램/ }).click();
  await sleep(1200);
  await shot('diagram');

  // 3. Both panes show the same picture; then the canvas, where the diagram's code opens and the picture follows it.
  await page.getByRole('button', { name: '둘 다', exact: true }).click();
  await sleep(3000);
  await shot('both');
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForSelector('.excalidraw canvas');
  await sleep(800);
  await page.keyboard.press('Shift+1');
  await sleep(800);
  const cbox = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.dblclick(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  const panel = page.getByRole('complementary', { name: '다이어그램 코드' });
  const cm = panel.locator('.cm-content');
  await cm.waitFor({ timeout: 8000 });
  await sleep(800);
  await shot('code-open');
  await cm.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Cache [icon: redis, color: orange]', { delay: 45 });
  await page.keyboard.press('Escape'); // closes autocomplete, if open
  await page.keyboard.press('Enter');
  await page.keyboard.type('Web > Cache: 세션', { delay: 45 });
  await page.keyboard.press('Escape');
  await sleep(3000);
  await shot('code-edit');
  await panel.getByRole('button', { name: '닫기', exact: true }).click().catch(() => {});
  await sleep(800);

  // 4. Canvas: fit the grown picture, then touch it up with a box and a label.
  const box = await page.locator('[data-canvas]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.8); // focus the canvas, select nothing
  await page.keyboard.press('Shift+1');
  await sleep(2500);
  await shot('canvas');
  await page.keyboard.press('r');
  const x0 = box.x + box.width * 0.6;
  const y0 = box.y + box.height * 0.14;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 220, y0 + 80, { steps: 20 });
  await page.mouse.up();
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.keyboard.type('캐시 만료 10분', { delay: 70 });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.8); // deselect
  await sleep(1500);
  await shot('canvas-edit');

  // 5. Session board: the running fake agent and the task board.
  await page.goto(`${BASE}/dispatch`);
  await page.locator('[data-board], main').first().waitFor();
  await sleep(5000);
  await shot('board');

  const video = page.video();
  await ctx.close();
  const raw = await video.path();
  mkdirSync(outDir, { recursive: true });
  const mp4 = join(outDir, 'demo.mp4');
  const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });
  ff('-i', raw, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  for (const f of [mp4]) console.log(`${f} ${(statSync(f).size / 1024 / 1024).toFixed(2)} MB`);
} catch (e) {
  console.error(String(e?.stack ?? e).slice(0, 2000));
  process.exitCode = 1;
} finally {
  await cleanup();
}
