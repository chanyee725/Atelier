// Workspace files over the API: CRUD, saves and revisions, path and header checks, fs errors, names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/workspace/store.js';
import { withApp, q } from './helpers/workspace-app.mjs';

test('CRUD: create, read, list, rename, move, delete files and folders', async () => {
  await withApp(async ({ call }) => {
    let r = await call('POST', '/api/folder', { path: 'proj' });
    assert.equal(r.status, 201);
    r = await call('POST', '/api/file', { path: 'proj/arch', title: 'Arch' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'proj/arch.dpx.json');
    assert.deepEqual(
      { v: r.body.version, t: r.body.title, rev: r.body.revision, doc: r.body.document, canvas: r.body.canvas, blocks: r.body.blocks },
      { v: 6, t: 'Arch', rev: 1, doc: { type: 'doc', content: [] }, canvas: { elements: [], appState: {} }, blocks: [] },
    );
    assert.equal((await call('POST', '/api/file', { path: 'proj/arch' })).status, 409);
    assert.equal((await call('POST', '/api/folder', { path: 'proj' })).status, 409);

    r = await call('GET', `/api/file?path=${q('proj/arch.dpx.json')}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.title, 'Arch');
    assert.equal((await call('GET', `/api/file?path=${q('proj/arch')}`)).status, 200); // extension optional

    r = await call('GET', '/api/tree');
    assert.equal(r.body.tree.length, 1);
    assert.equal(r.body.tree[0].type, 'folder');
    assert.equal(r.body.tree[0].children[0].path, 'proj/arch.dpx.json');
    assert.equal(r.body.tree[0].children[0].title, 'Arch');

    r = await call('POST', '/api/move', { from: 'proj/arch.dpx.json', to: 'proj/renamed' });
    assert.equal(r.body.path, 'proj/renamed.dpx.json');
    r = await call('POST', '/api/move', { from: 'proj/renamed.dpx.json', to: 'other/deep/renamed.dpx.json' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('other/deep/renamed')}`)).body.revision, 1);
    r = await call('POST', '/api/move', { from: 'other', to: 'moved' });
    assert.equal(r.status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('moved/deep/renamed')}`)).status, 200);
    assert.equal((await call('POST', '/api/move', { from: 'moved', to: 'moved/inside' })).status, 400);
    await call('POST', '/api/file', { path: 'x' });
    assert.equal((await call('POST', '/api/move', { from: 'x', to: 'moved/deep/renamed' })).status, 409);

    assert.equal((await call('DELETE', `/api/file?path=${q('moved/deep/renamed.dpx.json')}`)).status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('moved/deep/renamed')}`)).status, 404);
    assert.equal((await call('DELETE', `/api/folder?path=${q('moved')}`)).status, 200);
    assert.equal((await call('DELETE', `/api/folder?path=${q('moved')}`)).status, 404);
    r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.path).sort(), ['proj', 'x.dpx.json']);
  });
});

test('write: whole-file save bumps revision and keeps content; stale write gets 409', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const content = {
      title: 'T',
      document: { type: 'doc', content: [{ type: 'paragraph' }] },
      canvas: { elements: [{ id: 'e1', type: 'rectangle' }], appState: { zoom: 2 } },
      blocks: [{ id: 'b1', type: 'flowchart', code: 'a > b', x: 1, y: 2, w: 300, h: 200 }],
    };
    let r = await call('PUT', `/api/file?path=${q('a')}`, { ...content, revision: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { path: 'a.dpx.json', revision: 2 });
    r = await call('GET', `/api/file?path=${q('a')}`);
    assert.deepEqual({ ...r.body, path: undefined }, { ...content, path: undefined, version: 6, revision: 2 });

    // a second client still holding revision 1 is rejected and told the current revision
    r = await call('PUT', `/api/file?path=${q('a')}`, { ...content, title: 'stale', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 2);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'T');

    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { ...content })).status, 400); // no revision
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { ...content, revision: 2, blocks: [{ id: 'x' }] })).status, 400);
    assert.equal((await call('PUT', `/api/file?path=${q('missing')}`, { ...content, revision: 1 })).status, 404);
  });
});

test('write: concurrent saves with the same revision let exactly one win', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => call('PUT', `/api/file?path=${q('a')}`, { title: `t${i}`, revision: 1 })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
  });
});

test('write is atomic: no temp files left, content is always complete JSON', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const big = { title: 'big', canvas: { elements: Array.from({ length: 20000 }, (_, i) => ({ id: i })), appState: {} } };
    let rev = 1;
    const reader = (async () => {
      for (let i = 0; i < 30; i++) {
        JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8')); // would throw on a torn write
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    for (let i = 0; i < 10; i++) rev = (await call('PUT', `/api/file?path=${q('a')}`, { ...big, revision: rev })).body.revision;
    await reader;
    assert.deepEqual((await readdir(ws)).filter((n) => n !== '.drawing'), ['a.dpx.json']); // `.drawing` holds version history

    // a failed write (stale) leaves the file untouched and no temp file behind
    const before = await readFile(join(ws, 'a.dpx.json'), 'utf8');
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { title: 'x', revision: 1 })).status, 409);
    assert.equal(await readFile(join(ws, 'a.dpx.json'), 'utf8'), before);
    assert.deepEqual((await readdir(ws)).filter((n) => n !== '.drawing'), ['a.dpx.json']); // `.drawing` holds version history
  });
});

test('path traversal, absolute paths, hidden names and symlink escapes are refused', async () => {
  await withApp(async ({ ws, outside, call }) => {
    await writeFile(join(outside, 'secret.dpx.json'), '{}');
    await symlink(outside, join(ws, 'link'));
    await symlink(join(outside, 'secret.dpx.json'), join(ws, 'file-link.dpx.json'));
    const bad = [
      '../x', 'a/../../x', '..', '/etc/passwd', '/tmp/x', 'a//b', './a', 'a/./b', '.hidden', 'a/.git/x',
      'a\\b', '..%2f..%2fx', 'C:/x', 'a\0b', 'link/secret', 'link/new', 'file-link.dpx.json',
    ];
    for (const p of bad) {
      for (const [m, url, body] of [
        ['GET', `/api/file?path=${q(p)}`],
        ['PUT', `/api/file?path=${q(p)}`, { revision: 1 }],
        ['POST', '/api/file', { path: p }],
        ['POST', '/api/folder', { path: p }],
        ['DELETE', `/api/file?path=${q(p)}`],
        ['POST', '/api/move', { from: p, to: 'ok' }],
        ['POST', '/api/move', { from: 'ok', to: p }],
      ]) {
        const r = await call(m, url, body);
        assert.ok([400, 404].includes(r.status), `${m} ${url} ${JSON.stringify(p)} -> ${r.status}`);
      }
    }
    // nothing was created or touched outside
    assert.deepEqual(await readdir(outside), ['secret.dpx.json']);
    assert.equal(await readFile(join(outside, 'secret.dpx.json'), 'utf8'), '{}');
    // symlinks are not listed
    const tree = (await call('GET', '/api/tree')).body.tree;
    assert.deepEqual(tree, []);
  });
});

test('every non-GET /api request needs x-drawing: 1 (x-dispatch: 1 accepted)', async () => {
  await withApp(async ({ base, ws }) => {
    const json = { 'content-type': 'application/json' };
    for (const [method, path, headers] of [
      ['POST', '/api/folder', json],
      ['POST', '/api/folder', { ...json, 'x-drawing': '0' }],
      ['PUT', '/api/file?path=a.dpx.json', json],
      ['DELETE', '/api/folder?path=x', {}],
      ['POST', '/api/nope', json],
    ]) {
      const res = await fetch(base + path, { method, headers, body: method === 'DELETE' ? undefined : '{"path":"x"}' });
      assert.equal(res.status, 403, `${method} ${path} ${JSON.stringify(headers)}`);
    }
    assert.deepEqual(await readdir(ws), []);
    assert.equal((await fetch(`${base}/api/folder`, { method: 'POST', headers: { ...json, 'x-dispatch': '1' }, body: '{"path":"x"}' })).status, 201);
    assert.equal((await fetch(`${base}/api/info`)).status, 200);
  });
});

test('API hardening: JSON content-type required, bad JSON rejected, no path leak in errors', async () => {
  await withApp(async ({ base, ws }) => {
    let res = await fetch(`${base}/api/folder`, { method: 'POST', headers: { 'x-drawing': '1' }, body: '{"path":"x"}' });
    assert.equal(res.status, 415);
    res = await fetch(`${base}/api/folder`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: '{nope' });
    assert.equal(res.status, 400);
    assert.deepEqual(await readdir(ws), []);
    res = await fetch(`${base}/api/file?path=nope`);
    assert.ok(!(await res.text()).includes(ws));
  });
});

test('unreadable files show in the tree but cannot be read (422)', async () => {
  await withApp(async ({ ws, call }) => {
    await writeFile(join(ws, 'broken.dpx.json'), 'not json');
    await writeFile(join(ws, 'notes.txt'), 'ignored');
    const r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.name), ['broken.dpx.json']);
    assert.equal((await call('GET', `/api/file?path=${q('broken')}`)).status, 422);
    assert.ok((await stat(join(ws, 'notes.txt'))).isFile());
  });
});

test('DELETE /api/file without extension never removes a same-named folder; kinds do not cross', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/folder', { path: 'sub' });
    await call('POST', '/api/file', { path: 'sub/inner' });
    assert.equal((await call('DELETE', `/api/file?path=${q('sub')}`)).status, 404);
    assert.equal((await call('GET', `/api/file?path=${q('sub/inner')}`)).status, 200);
    assert.equal((await call('DELETE', `/api/file?path=${q('sub/inner')}`)).status, 200); // extension optional for files
    await call('POST', '/api/file', { path: 'f' });
    assert.equal((await call('DELETE', `/api/folder?path=${q('f.dpx.json')}`)).status, 404); // folder route never deletes a file
    assert.equal((await call('DELETE', `/api/folder?path=${q('f')}`)).status, 404);
    assert.ok((await stat(join(ws, 'f.dpx.json'))).isFile());
    assert.ok((await stat(join(ws, 'sub'))).isDirectory());
    assert.equal((await call('DELETE', `/api/folder?path=${q('sub')}`)).status, 200);
  });
});

test('move: file wins over a same-named folder unless type says folder', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/folder', { path: 'sub' });
    await call('POST', '/api/file', { path: 'sub/inner' });
    await call('POST', '/api/file', { path: 'sub' }); // sub.dpx.json next to folder sub/
    let r = await call('POST', '/api/move', { from: 'sub', to: 'renamed' });
    assert.equal(r.body.path, 'renamed.dpx.json');
    assert.equal((await call('GET', `/api/file?path=${q('sub/inner')}`)).status, 200); // folder untouched
    r = await call('POST', '/api/move', { from: 'sub', to: 'folder2', type: 'folder' });
    assert.equal(r.body.path, 'folder2');
    assert.equal((await call('GET', `/api/file?path=${q('folder2/inner')}`)).status, 200);
    assert.equal((await call('POST', '/api/move', { from: 'folder2', to: 'x', type: 'file' })).status, 404);
    assert.equal((await call('POST', '/api/move', { from: 'folder2', to: 'x', type: 'bogus' })).status, 400);
  });
});

// Store without a watcher: a recursive fs.watch would itself trip over the unreadable folder.
test('tree skips entries it cannot stat instead of failing', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const store = createStore(ws);
  try {
    await store.createFile('ok');
    await mkdir(join(ws, 'locked'));
    await writeFile(join(ws, 'locked', 'x.dpx.json'), '{}');
    await chmod(join(ws, 'locked'), 0o444); // names listable (readdir), entries not stat-able
    const tree = await store.tree();
    assert.deepEqual(tree.find((n) => n.path === 'locked').children, []);
    assert.ok(tree.some((n) => n.path === 'ok.dpx.json'));
  } finally {
    await chmod(join(ws, 'locked'), 0o755).catch(() => {});
    await rm(ws, { recursive: true, force: true });
  }
});

test('folders cannot be named like diagram files', async () => {
  await withApp(async ({ ws, call }) => {
    assert.equal((await call('POST', '/api/folder', { path: 'x.dpx.json' })).status, 400);
    assert.equal((await call('POST', '/api/folder', { path: 'p/x.dpx.json/q' })).status, 400);
    assert.deepEqual(await readdir(ws), []);
    assert.equal((await call('POST', '/api/folder', { path: 'p/x.dpx' })).status, 201);
  });
});

test('fs errors become 4xx, and neither response nor server log contains absolute paths', async () => {
  await withApp(async ({ ws, call }) => {
    const logged = [];
    const orig = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
      await call('POST', '/api/file', { path: 'sub.dpx.json' }); // a file named like this makes "sub.dpx.json/child" an ENOTDIR case
      const r = await call('POST', '/api/file', { path: 'sub.dpx.json/child' });
      assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
      for (const [m, url, body] of [
        ['POST', '/api/folder', { path: 'sub.dpx.json/deeper' }],
        ['POST', '/api/move', { from: 'sub', to: 'sub.dpx.json/x' }],
        ['GET', `/api/file?path=${q('sub.dpx.json/child')}`],
        ['PUT', `/api/file?path=${q('sub.dpx.json/child')}`, { revision: 1 }],
        ['DELETE', `/api/folder?path=${q('sub.dpx.json/child')}`],
      ]) {
        const x = await call(m, url, body);
        assert.ok(x.status >= 400 && x.status < 500, `${m} ${url} -> ${x.status}`);
        assert.ok(!JSON.stringify(x.body).includes(ws));
      }
      assert.ok(!JSON.stringify(r.body).includes(ws));
    } finally {
      console.error = orig;
    }
    assert.ok(!logged.join('\n').includes(ws), logged.join('\n'));
  });
});

test('createFile and move onto a path whose parent is a file answer 409', async () => {
  await withApp(async ({ ws, call }) => {
    await writeFile(join(ws, 'blocker.txt'), 'x'); // a plain file where a folder would have to be
    await call('POST', '/api/file', { path: 'other' });
    const make = await call('POST', '/api/file', { path: 'blocker.txt/child' });
    assert.equal(make.status, 409);
    const deep = await call('POST', '/api/file', { path: 'blocker.txt/a/child' });
    assert.equal(deep.status, 409);
    const mv = await call('POST', '/api/move', { from: 'other', to: 'blocker.txt/x', type: 'file' });
    assert.equal(mv.status, 409);
    await call('POST', '/api/folder', { path: 'dir' });
    const mvDir = await call('POST', '/api/move', { from: 'dir', to: 'blocker.txt/dir', type: 'folder' });
    assert.equal(mvDir.status, 409);
  });
});

test('app logs only the error kind for unexpected 500s', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const boom = { name: 'boom', setup: async () => ({ routes: [{ method: 'GET', path: '/api/boom', handler: () => { throw Object.assign(new Error(`lstat '${ws}/x'`), { code: 'EBOOM' }); } }] }) };
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: [boom] });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await fetch(`http://127.0.0.1:${app.server.address().port}/api/boom`);
    assert.equal(res.status, 500);
  } finally {
    console.error = orig;
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
  assert.ok(logged.length > 0);
  assert.ok(!logged.join('\n').includes(ws));
});

test('no folder can be named like a file: create, move and parent segments are all refused', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/folder', { path: 'a' });
    await call('POST', '/api/file', { path: 'f' });
    assert.equal((await call('POST', '/api/folder', { path: 'q.dpx.json/z' })).status, 400);
    assert.equal((await call('POST', '/api/folder', { path: 'a/q.dpx.json' })).status, 400);
    assert.equal((await call('POST', '/api/file', { path: 'q.dpx.json/z' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'a', to: 'y.dpx.json', type: 'folder' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'a', to: 'x/y.dpx.json/a', type: 'folder' })).status, 400);
    assert.equal((await call('POST', '/api/move', { from: 'f', to: 'y.dpx.json/f' })).status, 400);
    const r = await call('GET', '/api/tree');
    assert.deepEqual(r.body.tree.map((n) => n.path).sort(), ['a', 'f.dpx.json']);
  });
});

test('a typed .dpx suffix is dropped: demo.dpx is the file demo.dpx.json', async () => {
  await withApp(async ({ ws, call }) => {
    const r = await call('POST', '/api/file', { path: 'a/demo.dpx', title: 'Demo' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'a/demo.dpx.json');
    assert.deepEqual(await readdir(join(ws, 'a')), ['demo.dpx.json']);
    assert.equal((await call('GET', `/api/file?path=${q('a/demo.dpx')}`)).status, 200);
    assert.equal((await call('POST', '/api/file', { path: 'a/demo' })).status, 409);
  });
});

test('names like a:memo are fine; only drive paths are refused', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('POST', '/api/file', { path: 'a:memo' })).status, 201);
    assert.equal((await call('GET', `/api/file?path=${q('a:memo')}`)).status, 200);
    if (process.platform !== 'win32') assert.equal((await call('POST', '/api/file', { path: 'C:/x' })).status, 400);
  });
});

test('folders that differ only in letter case reuse the existing folder; two such folders answer 409 (#1026)', async () => {
  await withApp(async ({ call, ws: dir }) => {
    assert.equal((await call('POST', '/api/folder', { path: 'web' })).status, 201);
    // A folder of the same name in another case is the existing one: taken, like an exact name.
    assert.equal((await call('POST', '/api/folder', { path: 'Web' })).status, 409);
    let r = await call('POST', '/api/folder', { path: 'WEB/sub' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'web/sub');
    r = await call('POST', '/api/file', { path: 'Web/Sub/doc' });
    assert.equal(r.status, 201);
    assert.equal(r.body.path, 'web/sub/doc.dpx.json');
    // Moves land in the existing folder; a folder moved next to a case-variant sibling is refused like a taken name.
    await call('POST', '/api/file', { path: 'top' });
    r = await call('POST', '/api/move', { from: 'top', to: 'WEB/top' });
    assert.equal(r.status, 200);
    assert.equal(r.body.path, 'web/top.dpx.json');
    await call('POST', '/api/folder', { path: 'other/Sub' });
    assert.equal((await call('POST', '/api/move', { from: 'other/Sub', to: 'web/SUB', type: 'folder' })).status, 409);
    // With sub-documents: the document's folder may not land on a case variant of an existing folder.
    await call('POST', '/api/file', { path: 'other/sub' });
    assert.equal((await call('POST', '/api/move', { from: 'other/sub', to: 'web/Sub', type: 'file', withSubdocs: true })).status, 409);
    // A case-only rename of the folder itself still works.
    r = await call('POST', '/api/move', { from: 'other/Sub', to: 'other/SUB', type: 'folder' });
    assert.equal(r.status, 200);
    assert.equal(r.body.path, 'other/SUB');
    assert.deepEqual((await readdir(dir)).filter((n) => !n.startsWith('.')).sort(), ['other', 'web']);
    // Two existing folders that differ only in case (made outside the app) and no exact match: ambiguous, 409.
    await mkdir(join(dir, 'Api'));
    await mkdir(join(dir, 'API'));
    r = await call('POST', '/api/file', { path: 'api/doc' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /대소문자/);
    // An exact match still wins over its case variants.
    assert.equal((await call('POST', '/api/file', { path: 'Api/doc' })).body.path, 'Api/doc.dpx.json');
  });
});
