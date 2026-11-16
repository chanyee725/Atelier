import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir, readFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { modules } from '../server/modules.js';

// Scratch folders only (never a real project): a workspace and a fake "home" with folders to browse.
async function withApp(fn, opts = {}) {
  const ws = await mkdtemp(join(tmpdir(), 'draw-lf-ws-'));
  const home = await realpath(await mkdtemp(join(tmpdir(), 'draw-lf-home-')));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  const app = await createApp({ workspaceDir: ws, ...opts }, { publicDir: ws, moduleList: modules });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, headers = { 'x-drawing': '1' }) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ ws, home, call });
  } finally {
    process.env.HOME = oldHome;
    await app.close();
    await rm(ws, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
}

const q = (p) => `/api/local-folders?path=${encodeURIComponent(p)}`;

test('local folders: lists sub-folder names only, starts at home, skips hidden, files and symlinks', async () => {
  await withApp(async ({ home, call }) => {
    await mkdir(join(home, 'code', 'app'), { recursive: true });
    await mkdir(join(home, 'Docs'));
    await mkdir(join(home, '.secret'));
    await writeFile(join(home, '.env'), 'X=1');
    await writeFile(join(home, 'notes.txt'), 'hi');
    await symlink(join(home, 'code'), join(home, 'link-to-code'));

    const r = await call('GET', '/api/local-folders');
    assert.equal(r.status, 200);
    assert.equal(r.body.path, home);
    assert.equal(r.body.home, home);
    assert.deepEqual(r.body.folders, ['code', 'Docs']);
    assert.equal(r.body.truncated, false);
    assert.equal(typeof r.body.parent, 'string');

    const sub = await call('GET', q(join(home, 'code')));
    assert.deepEqual([sub.body.path, sub.body.parent, sub.body.folders], [join(home, 'code'), home, ['app']]);
    // A symlink in the request is resolved to its real folder.
    assert.equal((await call('GET', q(join(home, 'link-to-code')))).body.path, join(home, 'code'));
    assert.equal((await call('GET', q('/'))).body.parent, null);
  });
});

test('local folders: bad paths are client errors without absolute paths in the message', async () => {
  await withApp(async ({ home, call }) => {
    await writeFile(join(home, 'file.txt'), 'x');
    const cases = [
      [q('relative/path'), 400],
      [q(join(home, 'missing')), 404],
      [q(join(home, 'file.txt')), 400],
      [q(`${home}/\0x`), 400],
    ];
    for (const [url, status] of cases) {
      const r = await call('GET', url);
      assert.equal(r.status, status, url);
      assert.equal(r.body.error.includes(home), false);
    }
    if (process.getuid?.() !== 0) {
      const locked = join(home, 'locked');
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        assert.equal((await call('GET', q(locked))).status, 403);
      } finally {
        await chmod(locked, 0o755);
      }
    }
  });
});

test('local project: links a folder, writes only inside the workspace, shows up in projects', async () => {
  await withApp(async ({ ws, home, call }) => {
    const target = join(home, 'my-app');
    await mkdir(target);
    await writeFile(join(target, 'README.md'), 'x');

    // Writes need the header.
    assert.equal((await call('POST', '/api/workspace/local-project', { path: target }, {})).status, 403);

    const r = await call('POST', '/api/workspace/local-project', { path: target });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body, { path: 'my-app', name: 'my-app', linkedPath: target });
    // The linked folder is untouched; the workspace holds the project and its meta.
    assert.deepEqual(await readdir(target), ['README.md']);
    assert.deepEqual(JSON.parse(await readFile(join(ws, 'my-app', '.project.json'), 'utf8')), { name: 'my-app', linkedPath: target });

    const p = (await call('GET', '/api/workspace/projects')).body.projects;
    assert.deepEqual(p.map((x) => [x.path, x.name, x.linkedPath]), [['my-app', 'my-app', target]]);

    // Same folder again: 409 with the existing project.
    const again = await call('POST', '/api/workspace/local-project', { path: target });
    assert.deepEqual([again.status, again.body.project], [409, 'my-app']);

    // Another folder with the same name gets a free project name.
    const other = join(home, 'b', 'my-app');
    await mkdir(other, { recursive: true });
    assert.equal((await call('POST', '/api/workspace/local-project', { path: other })).body.path, 'my-app 2');

    // Refused: the workspace itself, the root, missing folders, relative paths.
    for (const [path, status] of [[ws, 400], ['/', 400], [join(home, 'nope'), 404], ['x/y', 400], [undefined, 400]]) {
      assert.equal((await call('POST', '/api/workspace/local-project', { path })).status, status, String(path));
    }
  });
});

test('local project: closed in project mode', async () => {
  await withApp(async ({ home, call }) => {
    assert.equal((await call('POST', '/api/workspace/local-project', { path: home })).status, 403);
  }, { projectMode: true });
});
