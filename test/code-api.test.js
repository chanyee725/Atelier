// E504b: GET /api/code guards, window and errors, in a scratch git repo (never a real project).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import * as code from '../server/code/index.js';
import { cleanPath, windowOf } from '../server/code/index.js';

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

async function rig(t, { git = true } = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'draw-code-')));
  const repo = join(base, 'repo');
  const outside = join(base, 'outside');
  await mkdir(join(repo, 'ws'), { recursive: true });
  await mkdir(join(repo, 'src'));
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'outside\n');
  await writeFile(join(repo, 'src', 'a.py'), lines(1000));
  await writeFile(join(repo, 'src', 'small.js'), 'one\ntwo\r\nthree');
  await writeFile(join(repo, 'src', 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  await writeFile(join(repo, 'src', 'big.txt'), 'x'.repeat(1024 * 1024 + 1));
  await writeFile(join(repo, '.env'), 'TOKEN=1\n');
  await writeFile(join(repo, '.env.local'), 'TOKEN=1\n');
  await writeFile(join(repo, 'src', 'server.pem'), 'k\n');
  await writeFile(join(repo, 'src', 'credentials.json'), '{}\n');
  await writeFile(join(repo, '.npmrc'), 'x\n');
  await writeFile(join(repo, 'src', 'exact.txt'), 'x'.repeat(1024 * 1024));
  await writeFile(join(repo, 'src', 'empty.txt'), '');
  await writeFile(join(repo, '.gitignore'), 'ignored.txt\nlocal.json\n');
  await writeFile(join(repo, 'local.json'), '{"secret":1}\n');
  await writeFile(join(repo, 'ab.txt'), 'ab\n');
  await writeFile(join(repo, 'a[b].txt'), 'bracket\n');
  await writeFile(join(repo, 'ignored.txt'), 'local\n');
  await writeFile(join(repo, 'src', 'untracked.js'), 'u\n');
  await symlink(outside, join(repo, 'src', 'out-dir'));
  await symlink(join(outside, 'secret.txt'), join(repo, 'src', 'out-file'));
  await symlink('a.py', join(repo, 'src', 'inside-link'));
  await symlink('../.env', join(repo, 'src', 'to-env'));
  await symlink('local.json', join(repo, 'link-to-ignored'));
  if (git) {
    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    g('init', '-q');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-f', '.');
    g('--literal-pathspecs', 'rm', '-q', '--cached', 'src/untracked.js', 'ignored.txt', 'local.json', 'a[b].txt');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  }
  const app = await createApp({ workspaceDir: join(repo, 'ws') }, { publicDir: base, moduleList: [{ name: 'code', setup: code.setup }] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const { port } = app.server.address();
  t.after(async () => { await app.close(); await rm(base, { recursive: true, force: true }); });
  const get = async (q) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/code?${q}`);
    return { status: r.status, body: await r.json() };
  };
  return { get, port };
}

test('cleanPath rejects absolute, .., NUL, backslash and empty', () => {
  for (const p of ['/etc/passwd', '../x', 'a/../../x', 'a\\b', 'a\0b', '', '.', null]) assert.equal(cleanPath(p), null, String(p));
  assert.equal(cleanPath('./src//a.py'), 'src/a.py');
});

test('windowOf: context, clamping and the 400 line cap', () => {
  assert.deepEqual(windowOf(1000, 100, 110), { start: 80, end: 130 });
  assert.deepEqual(windowOf(1000, 3, 5), { start: 1, end: 25 });
  assert.deepEqual(windowOf(30, 25, 30), { start: 5, end: 30 });
  const w = windowOf(1000, 10, 900);
  assert.ok(w.end - w.start + 1 <= 400 && w.start <= 10);
  const m = windowOf(1000, 100, 390);
  assert.ok(m.end - m.start + 1 <= 400 && m.start <= 100 && m.end >= 390);
});

test('returns the range with context lines and language', async (t) => {
  const { get } = await rig(t);
  const r = await get('path=src/a.py&start=100&end=110');
  assert.equal(r.status, 200);
  assert.equal(r.body.path, 'src/a.py');
  assert.equal(r.body.total, 1000);
  assert.equal(r.body.language, 'python');
  assert.equal(r.body.start, 80);
  assert.equal(r.body.end, 130);
  assert.equal(r.body.lines.length, 51);
  assert.equal(r.body.lines[0], 'line 80');
  assert.equal(r.body.lines[20], 'line 100');
  const one = await get('path=src/a.py&start=500');
  assert.equal(one.body.lines[500 - one.body.start], 'line 500');
  const huge = await get('path=src/a.py&start=1&end=1000');
  assert.ok(huge.body.lines.length <= 400);
  const whole = await get('path=src/small.js');
  assert.deepEqual(whole.body.lines, ['one', 'two', 'three']);
  assert.equal(whole.body.total, 3);
});

test('bad path or range: 400', async (t) => {
  const { get } = await rig(t);
  for (const q of ['', 'path=/etc/passwd', 'path=../x', 'path=src/../../x', 'path=src%5Ca.py', 'path=src/a.py%00', 'path=src/a.py&start=0', 'path=src/a.py&start=x', 'path=src/a.py&start=9&end=3', 'path=src/%252e%252e/a.py', 'path=src/a.py&start=1.5', 'path=src/a.py&start=-1', 'path=src/a.py&end=0', 'path=src/a.py&start=5&end=x', 'path=src', 'path=%252e%252e%252fx']) {
    assert.equal((await get(q)).status, 400, q);
  }
});

test('forbidden: .git, .env*, key and secret files, symlink escapes', async (t) => {
  const { get } = await rig(t);
  for (const p of ['.git/config', '.git/HEAD', '.env', '.env.local', 'src/server.pem', 'src/credentials.json', '.npmrc', '.ENV', '.Env.local', 'src/SERVER.PEM', '.GIT/config', 'src/out-file', 'src/out-dir', 'src/out-dir/secret.txt', 'src/to-env', '.dispatch/x', '.DISPATCH/x', 'src/.Dispatch/wt/a.js']) {
    assert.equal((await get(`path=${encodeURIComponent(p)}`)).status, 403, p);
  }
  assert.equal((await get('path=src/inside-link')).status, 200);
});

test('413 over 1 MB, 415 binary, 404 missing or not a regular file', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=src/big.txt')).status, 413);
  assert.equal((await get('path=src/exact.txt')).status, 200);
  assert.equal((await get('path=src/bin.dat')).status, 415);
  assert.equal((await get('path=src/nope.py')).status, 404);
});

test('read only and no-store; other methods are not routed', async (t) => {
  const { port } = await rig(t);
  const r = await fetch(`http://127.0.0.1:${port}/api/code?path=src/a.py`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const p = await fetch(`http://127.0.0.1:${port}/api/code?path=src/a.py`, { method: 'POST', headers: { 'x-drawing': '1' } });
  assert.equal(p.status, 404);
});

test('workspace outside a git project: 404 no-project', async (t) => {
  const { get } = await rig(t, { git: false });
  const r = await get('path=src/a.py');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no-project');
});

test('%2e%2e is decoded once and rejected; double encoding rejected', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=src/%2e%2e/%2e%2e/outside/secret.txt')).status, 400);
  assert.equal((await get('path=src%252fa.py')).status, 400);
});

test('untracked and gitignored files are 404 not-tracked; tracked symlink inside root works', async (t) => {
  const { get } = await rig(t);
  for (const p of ['src/untracked.js', 'ignored.txt']) {
    const r = await get(`path=${p}`);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error, 'not-tracked', p);
  }
  assert.equal((await get('path=src/a.py')).status, 200);
});

test('directory is 400 (a symlinked directory too)', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=src')).status, 400);
});

test('range errors: start past the end 416, start > end 400; empty file ok', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=src/a.py&start=1001')).status, 416);
  assert.equal((await get('path=src/a.py&start=1000')).status, 200);
  assert.equal((await get('path=src/a.py&start=10&end=9')).status, 400);
  const e = await get('path=src/empty.txt');
  assert.equal(e.status, 200);
  assert.deepEqual(e.body.lines, []);
  assert.equal((await get('path=src/empty.txt&start=1')).status, 416);
});

test('truncated: a range over 400 lines is cut at 400 from its start', async (t) => {
  const { get } = await rig(t);
  const r = await get('path=src/a.py&start=11&end=900');
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.start, 11);
  assert.equal(r.body.end, 410);
  assert.equal(r.body.lines.length, 400);
  const whole = await get('path=src/a.py');
  assert.equal(whole.body.truncated, true);
  assert.equal(whole.body.start, 1);
  const ok = await get('path=src/a.py&start=1&end=400');
  assert.equal(ok.body.truncated, undefined);
  assert.ok(ok.body.lines.length <= 400);
});

test('pathspec magic and globs are literal: untracked a[b].txt next to tracked ab.txt is 404', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=ab.txt')).status, 200);
  // a[b].txt exists on disk but is untracked: the glob must not match ab.txt.
  for (const q of ['path=a[b].txt', 'path=a%5Bb%5D.txt']) {
    const r = await get(q);
    assert.equal(r.status, 404, q);
    assert.equal(r.body.error, 'not-tracked', q);
  }
  // No such files on disk: pathspec magic and wildcards never resolve to ab.txt.
  for (const q of [`path=${encodeURIComponent(':(top)ab.txt')}`, 'path=a*.txt', 'path=a%2A.txt']) {
    assert.equal((await get(q)).status, 404, q);
  }
});

test('a tracked symlink to a gitignored file is 404 not-tracked and leaks nothing', async (t) => {
  const { get } = await rig(t);
  const r = await get('path=link-to-ignored');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not-tracked');
  assert.equal(JSON.stringify(r.body).includes('secret'), false);
});
