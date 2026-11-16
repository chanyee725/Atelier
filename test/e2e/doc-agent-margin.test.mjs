// Headless check of the document agent margin (E532, #622): a fake Claude session writes a document in steps; the
// margin opens beside the text (the document shifts left), its card names the session and says what it is doing,
// the line follows the next edit, a recent change jumps to its block, the margin stays while the session works (E536, #653) and closes when it ends.
// The user's caret and focus stay where they were the whole time.
// Run on request: DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// DRAW_SHOTS=<dir> also saves light/dark x desktop/narrow screenshots there.
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
import { DOC_SHARE, TEXT_MIN } from '../../web/src/doc/agentMargin.ts';

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

test('doc agent margin (둘 다, the default view): opens beside the text while a fake session writes, follows its edits, closes when the session ends', { skip: SKIP, timeout: 180_000 }, (t) => run(t, 'both'));

test('doc agent margin (문서 view): the same with the document alone', { skip: SKIP, timeout: 180_000 }, (t) => run(t, 'doc'));

async function run(t, view) {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const repo = mkdtempSync(join(tmpdir(), 'draw-docmargin-'));
  const home = mkdtempSync(join(tmpdir(), 'draw-docmargin-home-'));
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
  const step2 = [...step1, h('화면 지도'), p('여기서 마무리해요. 조금 더 길게 적어요.')];
  const scenario = [
    { type: 'system', subtype: 'init', session_id: 'fake-doc-margin' },
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
    { $waitFor: gate(3) }, // the margin stayed past the idle time
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
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));
  await page.goto(`${BASE}/#file=plan.dpx.json`);
  await page.locator('.doc-editor').waitFor();
  // 둘 다 is the default; 문서 shows the document alone. Both are wide enough at 1600px for the side panel.
  if (view === 'doc') {
    await page.locator('[role="radio"], button', { hasText: /^문서$/ }).first().click();
    await page.waitForTimeout(300);
  }
  const intro = page.locator('.doc-editor p', { hasText: '소개 문단' });
  await intro.waitFor();

  // The user's caret: inside the intro paragraph, after "소개".
  const placeCaret = async () => {
    await intro.click();
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
  };
  await placeCaret();
  const caret = () => page.evaluate(() => {
    const s = getSelection();
    return { text: s.anchorNode?.textContent ?? null, offset: s.anchorOffset, focused: !!document.activeElement?.closest('.doc-editor') };
  });
  const mine = await caret();
  assert.deepEqual(mine, { text: '소개 문단이에요.', offset: 2, focused: true });
  // Where the text column sits with no margin (its centre, in viewport px).
  const textX = () => intro.evaluate((el) => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
  const x0 = await textX();
  // 둘 다: the document pane and the canvas beside it.
  const widths = () => page.evaluate(() => ({
    pane: document.querySelector('.split-doc')?.getBoundingClientRect().width ?? 0,
    canvas: document.querySelector('.split-doc')?.nextElementSibling?.nextElementSibling?.getBoundingClientRect().width ?? 0,
  }));
  const w0 = view === 'both' ? await widths() : null;
  assert.equal(await page.locator('[data-margin-panel]').count(), 0, 'no margin before any agent edits');

  await call('POST', '/api/providers/claude/login');
  const { sessions } = await call('POST', '/api/sessions', { items: [{ role: 'impl', prompt: 'write the plan' }], worktree: false });
  const name = sessions[0].name;
  assert.ok(name);
  release(1);

  // 1. The margin opens beside the text and the card names the session; text and panel split the row 6:4 (E537).
  // 문서: the text column shifts left. 둘 다: the document pane widens (×5/3, up to the canvas minimum) into the canvas.
  const panel = page.locator('[data-margin-panel]');
  await panel.waitFor({ timeout: 15_000 });
  assert.equal(await panel.getAttribute('data-form'), 'side');
  const card = panel.locator('[data-margin-card]');
  await card.waitFor();
  assert.match(await card.locator('.margin-name').textContent(), new RegExp(name));
  const doing = card.locator('[data-margin-doing]');
  await page.waitForFunction(() => /계획 섹션/.test(document.querySelector('[data-margin-doing]')?.textContent ?? ''), null, { timeout: 10_000 });
  await page.waitForTimeout(500); // the shift's transition
  const x1 = await textX();
  if (view === 'doc') assert.ok(x1 < x0 - 20, `the text moved left: ${x0} → ${x1}`);
  else {
    const w1 = await widths();
    assert.ok(w1.pane - w0.pane > 200, `the document pane widened by the panel: ${JSON.stringify([w0, w1])}`);
    assert.ok(w0.canvas - w1.canvas > 200 && w1.canvas >= 420, `the canvas gave the room, down to its minimum (less the divider): ${JSON.stringify([w0, w1])}`);
  }
  const row = await page.evaluate(() => {
    const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
    return { host: w('.doc-margin'), main: w('.doc-margin-main'), aside: w('.doc-margin-aside') };
  });
  assert.ok(Math.abs(row.main - row.host * 0.6) <= 2 && Math.abs(row.aside - row.host * 0.4) <= 2, `text and panel split 6:4: ${JSON.stringify(row)}`);
  // The panel never covers the text.
  const [pb, ib] = await Promise.all([panel.boundingBox(), intro.boundingBox()]);
  assert.ok(ib.x + ib.width <= pb.x + 1, `text ${JSON.stringify(ib)} clear of panel ${JSON.stringify(pb)}`);
  assert.deepEqual(await caret(), mine);

  // 2. The next edit: the doing line follows it, and the recent list grows.
  release(2);
  await page.locator('.doc-editor p', { hasText: '마무리' }).waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => /화면 지도/.test(document.querySelector('[data-margin-doing]')?.textContent ?? ''), null, { timeout: 10_000 });
  const changes = card.locator('[data-margin-change]');
  await page.waitForFunction(() => document.querySelectorAll('[data-margin-change]').length >= 2, null, { timeout: 10_000 });
  assert.match(await changes.first().textContent(), /화면 지도/);
  assert.deepEqual(await caret(), mine);

  // 3. A recent change jumps to its block and flashes it, without taking focus from the editor.
  await changes.last().click();
  // Still flashing a moment later (the editor redraws its blocks, so a class alone can be wiped at once).
  await page.waitForTimeout(250);
  const flash = await page.evaluate(() => {
    const block = [...document.querySelectorAll('.doc-editor p')].find((e) => e.textContent.includes('첫 단계'));
    return { animations: block?.getAnimations().length ?? -1, cls: !!block?.classList.contains('doc-margin-flash') };
  });
  assert.ok(flash.animations > 0 || flash.cls, `the jumped-to block flashes: ${JSON.stringify(flash)}`);
  assert.deepEqual(await caret(), mine);

  // 4. Collapse and open again: remembered per browser; focus stays in the editor.
  const toggle = panel.locator('.margin-toggle');
  await toggle.click();
  await panel.locator('.margin-rail').waitFor();
  assert.ok((await page.evaluate(() => localStorage.getItem('drawing.docMargin.collapsed')))?.includes('"side":true'));
  assert.deepEqual(await caret(), mine);
  await panel.locator('.margin-rail').click();
  await toggle.waitFor();

  // 4b. 둘 다 in narrower windows (#637 review): the form follows the room the page leaves, not the window. Beside
  // the text the panel only goes where the text keeps 360px and the canvas 430px; else it is a sheet under the text.
  if (view === 'both') {
    const layout = () => page.evaluate(() => {
      const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
      const pane = document.querySelector('.split-doc');
      return { form: document.querySelector('.doc-margin')?.getAttribute('data-form'), host: w('.doc-margin'), main: w('.doc-margin-main'), canvas: pane?.nextElementSibling?.nextElementSibling?.getBoundingClientRect().width ?? 0 };
    });
    for (const w of [800, 1024, 1100, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      const l = await layout();
      if (l.form === 'side') {
        assert.ok(l.main >= TEXT_MIN, `${w}px: the text keeps TEXT_MIN beside the panel: ${JSON.stringify(l)}`);
        assert.ok(l.canvas >= 420, `${w}px: the canvas keeps its room: ${JSON.stringify(l)}`);
      } else assert.ok(l.main >= l.host - 1, `${w}px: the sheet leaves the text its whole column: ${JSON.stringify(l)}`);
      if (w <= 1100) assert.equal(l.form, 'sheet', `${w}px: no room beside the text, a sheet: ${JSON.stringify(l)}`);
    }
    // Dragging the divider to the far right: it stays with the pointer until the canvas minimum, then stops there.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    assert.equal((await layout()).form, 'side');
    const handle = await page.evaluate(() => { const r = document.querySelector('.split-doc').nextElementSibling.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; });
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    const divider = () => page.evaluate(() => document.querySelector('.split-doc').nextElementSibling.getBoundingClientRect().left);
    for (const dx of [-160, -80, 1600 - handle.x - 20]) {
      await page.mouse.move(handle.x + dx, handle.y, { steps: 4 });
      await page.waitForTimeout(100);
      const d = await divider();
      const l = await layout();
      if (dx < 0) assert.ok(Math.abs(d - (handle.x + dx)) <= 8, `the divider follows the pointer: ${JSON.stringify({ dx, d, x: handle.x + dx })}`);
      else assert.ok(l.canvas >= 420, `the divider stops at the canvas minimum: ${JSON.stringify(l)}`);
    }
    await page.mouse.move(handle.x, handle.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // 4c. Across the side↔sheet boundary (#643): the text needs TEXT_MIN (360px), so the widest sheet puts the divider
    // at edge = split left + TEXT_MIN + DOC_SHARE × chrome and the narrowest side layout (text DOC_SHARE of the row) at
    // split left + TEXT_MIN / DOC_SHARE + chrome = edge + pw. Outside that gap the divider stays under the pointer;
    // inside it no share fits, so it snaps to the nearer end (off by at most half the gap) and the form matches the
    // end it took. TEXT_MIN and DOC_SHARE come from web/src/doc/agentMargin.ts, so the test follows them.
    const bounds = await page.evaluate(({ min, share }) => {
      const host = document.querySelector('.doc-margin');
      const pane = document.querySelector('.split-doc');
      const split = pane.parentElement.getBoundingClientRect();
      const chrome = Math.max(0, pane.getBoundingClientRect().width - host.getBoundingClientRect().width);
      return { edge: split.left + min + share * chrome, panel: min / share - min + (1 - share) * chrome };
    }, { min: TEXT_MIN, share: DOC_SHARE });
    const at = await page.evaluate(() => { const r = document.querySelector('.split-doc').nextElementSibling.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const { edge, panel: pw } = bounds;
    const cases = [
      { x: edge + pw + 10, form: 'side', want: edge + pw + 10 },
      { x: edge + pw - 10, form: 'side', want: edge + pw },
      { x: edge + pw * 0.75, form: 'side', want: edge + pw },
      { x: edge + pw * 0.25, form: 'sheet', want: edge },
      { x: edge + 10, form: 'sheet', want: edge },
      { x: edge - 10, form: 'sheet', want: edge - 10 },
      // and back to the right, through the gap the other way
      { x: edge + pw * 0.25, form: 'sheet', want: edge },
      { x: edge + pw * 0.75, form: 'side', want: edge + pw },
      { x: edge + pw + 10, form: 'side', want: edge + pw + 10 },
    ];
    for (const c of cases) {
      await page.mouse.move(c.x, at.y, { steps: 6 });
      await page.waitForTimeout(400);
      const d = await divider();
      const l = await layout();
      const seen = JSON.stringify({ ...c, d, form: l.form, edge, pw });
      assert.equal(l.form, c.form, `the form at the boundary: ${seen}`);
      assert.ok(Math.abs(d - c.want) <= 8, `the divider sits where expected: ${seen}`);
      assert.ok(Math.abs(d - c.x) <= pw / 2 + 8, `never more than half the panel from the pointer: ${seen}`);
    }
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await placeCaret();
    assert.deepEqual(await caret(), mine);
  }

  // 4d. 문서 view (#648): the collapsed rail takes far less room than the open panel, so a narrow column holds the
  // rail beside the text but not the panel. Opening the rail there measures again at once: the form turns to sheet.
  if (view === 'doc') {
    const state = () => page.evaluate(() => {
      const host = document.querySelector('.doc-margin');
      return { form: host?.getAttribute('data-form'), rail: host?.hasAttribute('data-side-rail') ?? false };
    });
    await panel.locator('.margin-toggle').click();
    await panel.locator('.margin-rail').waitFor();
    assert.deepEqual(await state(), { form: 'side', rail: true });
    // The narrowest window that still keeps the rail beside the text.
    let narrowest = null;
    for (let w = 1600; w >= 400; w -= 20) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      if ((await state()).form !== 'side') break;
      narrowest = w;
    }
    assert.ok(narrowest && narrowest > 400, `the rail gives way to the sheet somewhere above 400px: ${narrowest}`);
    await page.setViewportSize({ width: narrowest, height: 900 });
    await page.waitForTimeout(300);
    assert.deepEqual(await state(), { form: 'side', rail: true }, `${narrowest}px with the rail`);
    const room = await page.evaluate(() => {
      const host = document.querySelector('.doc-margin');
      return host.getBoundingClientRect().width;
    });
    await panel.locator('.margin-rail').click();
    await page.waitForFunction(() => document.querySelector('.doc-margin')?.getAttribute('data-form') === 'sheet', null, { timeout: 5_000 });
    assert.deepEqual(await state(), { form: 'sheet', rail: false }, `${narrowest}px with the panel open (row ${room}px)`);
    const l = await page.evaluate(() => ({ host: document.querySelector('.doc-margin').getBoundingClientRect().width, main: document.querySelector('.doc-margin-main').getBoundingClientRect().width }));
    assert.ok(l.main >= l.host - 1, `the sheet leaves the text its whole column: ${JSON.stringify(l)}`);
    // Wide again: the open panel goes back beside the text.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForFunction(() => document.querySelector('.doc-margin')?.getAttribute('data-form') === 'side', null, { timeout: 5_000 });
    assert.deepEqual(await state(), { form: 'side', rail: false });
    await placeCaret();
    assert.deepEqual(await caret(), mine);
  }

  // Screenshots in the default view: 1600 and 1440 wide (side panel), 700 (bottom sheet, under 768), light and dark.
  if (SHOTS && view === 'both') {
    const shot = (n) => page.screenshot({ path: join(SHOTS, `doc-margin-${n}.png`) });
    for (const w of [1600, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(500); // the column's width transition
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(150);
        await shot(`${w}-${scheme}`);
      }
    }
    await page.setViewportSize({ width: 700, height: 900 });
    await panel.locator('.margin-sheet-bar').waitFor({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot('700-dark-collapsed');
    const bar = panel.locator('.margin-sheet-bar');
    if (await bar.count()) await bar.click();
    await page.waitForTimeout(400);
    await shot('700-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    await shot('700-light');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    // The phone layout redraws the document, so the caret goes with it (the app's narrow mode, not the margin).
    await page.emulateMedia({ colorScheme: 'light' });
    await placeCaret();
    assert.deepEqual(await caret(), mine);
  }
  if (await panel.count()) assert.equal(await panel.getAttribute('data-form'), 'side');

  // 5. No more edits: the session still works, so its card stays past the idle time (IDLE_MS = 20 s, E536). When the
  // session ends the margin closes and the text moves back.
  const shown = await panel.isVisible();
  await page.waitForTimeout(22_000);
  if (shown) assert.ok(await panel.isVisible(), 'the margin stayed while the session works');
  release(3);
  await panel.waitFor({ state: 'detached', timeout: 20_000 }).catch(async () => {
    assert.ok(!(await panel.isVisible()), 'the margin closed when the session ended');
  });
  await page.waitForTimeout(500);
  const x2 = await textX();
  // The drags above end at the canvas minimum, which keeps the share they started with (#658): back where it was.
  assert.ok(Math.abs(x2 - x0) <= 2 && (await page.locator('.doc-margin-aside').count()) === 0, `the text came back: ${x0} → ${x2}`);
  if (view === 'both') {
    const w2 = await widths();
    assert.ok(Math.abs(w2.pane - w0.pane) <= 2 && Math.abs(w2.canvas - w0.canvas) <= 2, `the canvas got its room back: ${JSON.stringify([w0, w2])}`);
  }
  assert.deepEqual(await caret(), mine);
  assert.deepEqual(errors, []);
}
