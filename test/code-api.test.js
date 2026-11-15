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
  await symlink(outside, join(repo, 'src', 'out-dir'));
  await symlink(join(outside, 'secret.txt'), join(repo, 'src', 'out-file'));
  await symlink('a.py', join(repo, 'src', 'inside-link'));
  await symlink('../.env', join(repo, 'src', 'to-env'));
  if (git) {
    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    g('init', '-q');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-f', '.');
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
  for (const q of ['', 'path=/etc/passwd', 'path=../x', 'path=src/../../x', 'path=src%5Ca.py', 'path=src/a.py%00', 'path=src/a.py&start=0', 'path=src/a.py&start=x', 'path=src/a.py&start=9&end=3', 'path=src/a.py&start=5000']) {
    assert.equal((await get(q)).status, 400, q);
  }
});

test('forbidden: .git, .env*, key and secret files, symlink escapes', async (t) => {
  const { get } = await rig(t);
  for (const p of ['.git/config', '.git/HEAD', '.env', '.env.local', 'src/server.pem', 'src/credentials.json', '.npmrc', 'src/out-file', 'src/out-dir/secret.txt', 'src/to-env']) {
    assert.equal((await get(`path=${encodeURIComponent(p)}`)).status, 403, p);
  }
  assert.equal((await get('path=src/inside-link')).status, 200);
});

test('413 over 1 MB, 415 binary, 404 missing or not a regular file', async (t) => {
  const { get } = await rig(t);
  assert.equal((await get('path=src/big.txt')).status, 413);
  assert.equal((await get('path=src/bin.dat')).status, 415);
  assert.equal((await get('path=src/nope.py')).status, 404);
  assert.equal((await get('path=src')).status, 404);
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
