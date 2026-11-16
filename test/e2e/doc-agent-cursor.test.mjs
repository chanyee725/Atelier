// Headless check of the document agent cursor (E529, #619): a fake Claude session writes a document in steps; a caret
// with the session's name appears at the end of what it wrote, glides to the next edit, thinks, then fades out. The
// user's own caret and focus stay where they were the whole time.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// The server gets a scratch HOME and a PATH whose agent CLIs are the fakes in test/fixtures/fake-cli/, so no
// real claude, codex or agy can start. It refuses to go on unless the server log names its port and workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fakeCliBin } from '../fixtures/fake-cli/index.mjs';
import { which } from '../../server/dispatch/cli.js';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SHOTS = process.env.DRAW_SHOTS;
const SKIP = !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run';
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const h = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] });

test('doc agent cursor: a fake session writes a document; the named caret appears at the edit, moves and fades', { skip: SKIP, timeout: 180_000 }, (t) => run(t, false));

test('doc agent cursor: with reduced motion it jumps instead of gliding', { skip: SKIP, timeout: 180_000 }, (t) => run(t, true));

async function run(t, reduced) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-doccursor-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-doccursor-home-'));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q');
  writeFileSync(join(repo, 'README'), 'scratch\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const ws = join(repo, 'ws');
  mkdirSync(ws);
  const abs = join(ws, 'plan.dpx.json');
  const gate = (n) => join(home, `gate-${n}`);
  const release = (n) => writeFileSync(gate(n), '');

  const tool = (n) => ({ type: 'assistant', message: { id: `m${n}`, content: [{ type: 'tool_use', id: `t${n}`, name: 'Edit', input: { file_path: abs, old_string: 'x', new_string: 'y' } }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const result = (n) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'ok' }] } });
  const fileWith = (content, revision) => JSON.stringify({ version: 4, title: 'plan', document: { type: 'doc', content }, canvas: { elements: [], appState: {} }, blocks: [], revision });
  const start = [h('계획'), p('소개 문단이에요.')];
  const step1 = [...start, p('첫 단계를 적어요.')];
  const step2 = [...step1, h('두 번째'), p('여기서 마무리해요. 조금 더 길게 적어요.')];
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-doc-cursor' },
    { $waitFor: gate(1) }, // the page has the file open and the user's caret placed
    tool(1),
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith(step1, 50) } },
    result(1),
    { $waitFor: gate(2) },
    tool(2),
    { $sleep: 300 },
    { $write: { file: abs, text: fileWith(step2, 60) } },
    result(2),
    { $waitFor: gate(3) }, // thought, faded and gone
    { type: 'assistant', message: { id: 'm9', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.001 },
  ];
  const fake = fakeCliBin({ scenario });
  const port = await freePort();
  const PATH = `${fake.dir}:${dirname(which('git'))}`;
  const server = spawn(process.execPath, ['server/index.js', ws], {
    env: { PATH, HOME: home, DRAW_PORT: String(port), DRAW_WORKSPACE_WATCH: 'poll', ...fake.env, PATH, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    fake.cleanup();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const res = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    const body = await res.json();
    assert.ok(res.ok, `${m} ${u}: ${JSON.stringify(body)}`);
    return body;
  };
  await call('POST', '/api/file', { path: 'plan.dpx.json', title: 'plan', document: { type: 'doc', content: start } });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=plan.dpx.json`);
  const editor = page.locator('.doc-editor');
  await editor.waitFor();
  await page.locator('.doc-editor p', { hasText: '소개 문단' }).waitFor();

  // The user's caret: inside the intro paragraph, after "소개".
  await page.locator('.doc-editor p', { hasText: '소개 문단' }).click();
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.doc-editor p')].find((e) => e.textContent.includes('소개'));
    const r = document.createRange();
    r.setStart(t.firstChild, 2);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.waitForTimeout(200);
  const caret = () => page.evaluate(() => {
    const s = getSelection();
    return { text: s.anchorNode?.textContent ?? null, offset: s.anchorOffset, focused: !!document.activeElement?.closest('.doc-editor') };
  });
  const mine = await caret();
  assert.deepEqual(mine, { text: '소개 문단이에요.', offset: 2, focused: true });

  await call('POST', '/api/providers/claude/login');
  const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'write the plan' }], worktree: false });
  const name = sessions[0].name;
  assert.ok(name);

  // Record where the caret is drawn on every frame.
  await page.evaluate(() => {
    const ys = (window.__docYs = []);
    const tick = () => {
      const el = document.querySelector('[data-doc-agent-cursor]');
      if (el?.style.translate && el.style.visibility !== 'hidden') ys.push(parseFloat(el.style.translate.split(' ')[1]));
      if (ys.length < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  release(1);

  const cursor = page.locator('[data-doc-agent-cursor]');
  await cursor.waitFor({ timeout: 15_000 });
  await page.locator('.doc-editor p', { hasText: '첫 단계' }).waitFor();
  assert.match(await cursor.locator('.agent-cursor-tag').textContent(), new RegExp(name));
  assert.equal(await cursor.getAttribute('data-role'), 'impl');
  assert.equal(await cursor.evaluate((el) => el.style.getPropertyValue('--agent')), sessions[0].color);
  // It sits at the end of the paragraph the agent wrote.
  const near = (sel, text) =>
    page.waitForFunction(
      ({ sel, text }) => {
        const el = document.querySelector('[data-doc-agent-cursor]');
        const block = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
        if (!el || !block || el.style.visibility === 'hidden') return false;
        const c = el.querySelector('.doc-agent-caret').getBoundingClientRect();
        const b = block.getBoundingClientRect();
        const r = document.createRange();
        r.selectNodeContents(block);
        const end = [...r.getClientRects()].at(-1);
        return c.top >= b.top - 2 && c.bottom <= b.bottom + 2 && Math.abs(c.left - end.right) < 4;
      },
      { sel, text },
      { timeout: 10_000, polling: 'raf' },
    ).catch(async (e) => {
      const seen = await page.evaluate(() => {
        const el = document.querySelector('[data-doc-agent-cursor]');
        return { cursor: el && { at: el.style.translate, vis: el.style.visibility, phase: el.dataset.phase, box: JSON.stringify(el.getBoundingClientRect()) }, doc: document.querySelector('.doc-editor')?.innerText };
      });
      assert.fail(`the caret did not reach "${text}": ${e.message.split('\n')[0]}; ${JSON.stringify(seen)}`);
    });
  await near('.doc-editor p', '첫 단계');
  // The user's caret and focus are untouched.
  assert.deepEqual(await caret(), mine);
  // It takes no clicks.
  assert.equal(await cursor.evaluate((el) => getComputedStyle(el.closest('[data-doc-agent-cursors]')).pointerEvents), 'none');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `doc-cursor-first${reduced ? '-reduced' : ''}.png`) });
  const first = await page.evaluate(() => window.__docYs.at(-1));

  await page.locator('[data-doc-agent-cursor][data-phase="thinking"]').waitFor({ state: 'attached', timeout: 10_000 });
  release(2);
  await page.locator('.doc-editor p', { hasText: '마무리' }).waitFor({ timeout: 10_000 });
  await near('.doc-editor p', '마무리');
  await page.waitForTimeout(400);
  const ys = await page.evaluate(() => window.__docYs);
  const second = ys.at(-1);
  assert.ok(second > first + 30, `moved down to the new paragraph: ${first} → ${second}`);
  const between = ys.filter((y) => y > first + 3 && y < second - 3);
  if (reduced) assert.equal(between.length, 0, `jumped: ${JSON.stringify(ys.filter((y, i) => y !== ys[i - 1]))}`);
  else assert.ok(between.length > 0, `glided through the middle: ${JSON.stringify(ys.filter((y, i) => y !== ys[i - 1]))}`);
  assert.deepEqual(await caret(), mine);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `doc-cursor-second${reduced ? '-reduced' : ''}.png`) });

  // No more edits: thinking, then it fades out and goes, while the session is still running.
  await page.locator('[data-doc-agent-cursor][data-phase="thinking"]').waitFor({ state: 'attached', timeout: 10_000 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `doc-cursor-thinking${reduced ? '-reduced' : ''}.png`) });
  await page.evaluate(() => {
    const log = (window.__phaseLog = []);
    const tick = () => {
      const el = document.querySelector('[data-doc-agent-cursor]');
      const v = el ? `${el.dataset.phase}/${el.style.visibility || 'v'}` : 'none';
      if (log.at(-1) !== v) log.push(v);
      if (log.length < 200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const faded = await page.locator('[data-doc-agent-cursor][data-phase="fading"]').waitFor({ state: 'attached', timeout: 15_000 }).then(() => true, (e) => e);
  if (faded !== true) assert.fail(`no fading phase; phase/visibility seen: ${JSON.stringify(await page.evaluate(() => window.__phaseLog))}`);
  await cursor.waitFor({ state: 'detached', timeout: 5000 });
  release(3);
  assert.deepEqual(await caret(), mine);
  assert.deepEqual(errors, []);
}
