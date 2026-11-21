// Usage: node shoot.mjs <repo-root> <label: before|after> [outdir]
// Scratch git repo + workspace in a temp dir, fake CLIs on PATH, free port, headless 둘 다 보기 at 1280x800 and 1920x1080.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repoRoot, label = 'before', outDir = '.'] = process.argv.slice(2);
const CHROME = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell`;
const PW = process.env.PLAYWRIGHT_CORE || '/tmp/org943-shot/node_modules/playwright-core';
const { chromium } = await import(pathToFileURL(join(PW, 'index.mjs')).href);
const { fakeCliBin } = await import(pathToFileURL(join(repoRoot, 'test/fixtures/fake-cli/index.mjs')).href);
const { which } = await import(pathToFileURL(join(repoRoot, 'server/dispatch/cli.js')).href);
const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
if (port === 4000 || port === 4001) throw new Error('preview port');
const repo = mkdtempSync(join(tmpdir(), 'e716-repo-'));
const home = mkdtempSync(join(tmpdir(), 'e716-home-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
git('init', '-q'); writeFileSync(join(repo, 'README'), 'scratch\n'); git('add', '.'); git('commit', '-qm', 'init');
const ws = join(repo, 'ws'); mkdirSync(ws);
const fake = fakeCliBin({ scenario: [{ type: 'system', subtype: 'init', session_id: 'x' }, { type: 'result', subtype: 'success', total_cost_usd: 0 }] });
const PATH = `${fake.dir}:${dirname(which('git'))}`;
const server = spawn(process.execPath, ['server/index.js', ws], { cwd: repoRoot, env: { HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const cleanup = async () => { server.kill(); await new Promise((r) => setTimeout(r, 500)); fake.cleanup(); rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); rmSync(home, { recursive: true, force: true }); };
try {
  for (let i = 0; i < 100 && !log.includes(`workspace ${ws}`); i++) await new Promise((r) => setTimeout(r, 100));
  if (!log.includes(`http://127.0.0.1:${port}/`) || !log.includes(`workspace ${ws}`)) throw new Error('unexpected server log: ' + log);
  console.log(`server ok: port ${port}`);
  const BASE = `http://127.0.0.1:${port}`;
  const call = async (m, u, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) }); return r.json(); };
  const CODE = [
    'PLC [icon: cpu] > Gateway [icon: server]',
    'Gateway > Server [icon: aws-ec2]',
    'Server > Web [icon: monitor]',
    'Web > Robot controller [icon: tool]',
    'Server > Database [icon: database]',
    'Robot controller > Safety relay [icon: shield]',
  ].join('\n');
  const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const f = await call('POST', '/api/file', { path: 'demo', title: 'demo' });
  const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '아키텍처' }] }, para('PLC에서 로봇까지 명령이 흐르는 구조예요.'), { type: 'diagram', attrs: { blockId: 'b1' } }, para('위 그림 아래에 이어 쓰는 글이에요.')] };
  await call('PUT', '/api/file?path=demo', { ...f, version: 2, document: doc, blocks: [{ id: 'b1', type: 'architecture', code: CODE, x: 0, y: 0, w: 0, h: 0 }] });
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${BASE}/#file=demo.dpx.json`);
    await page.waitForSelector('.excalidraw', { timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(outDir, `${label}-${w}x${h}.png`) });
    console.log(`${label} ${w}x${h} canvas`, JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.excalidraw')?.getBoundingClientRect(); return r && { w: Math.round(r.width), h: Math.round(r.height) }; })), 'errors', JSON.stringify(errors));
    await page.close();
  }
  await browser.close();
} finally { await cleanup(); }
