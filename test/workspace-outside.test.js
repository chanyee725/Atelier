// Outside edits and the watcher: SSE events, revisions after outside saves, revision floors, fs.watch errors and polling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newFile } from '../server/workspace/model.js';
import { createStore } from '../server/workspace/store.js';
import { withApp, q, sseReader, sleep } from './helpers/workspace-app.mjs';

test('external edits emit a workspace SSE event; API saves, creates and new folders announce themselves to other tabs', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const sse = sseReader(base);
    await sleep(100); // let the stream attach
    try {
      // API writes are announced (an outside writer must show live in open tabs, E520 #543); the revision lets the
      // tab that saved it ignore its own echo
      await call('PUT', `/api/file?path=${q('a')}`, { title: 'mine', revision: 1 });
      await call('POST', '/api/file', { path: 'b' });
      await call('POST', '/api/folder', { path: 'dir' });
      await sleep(400);
      assert.deepEqual(sse.events, [{ kind: 'change', path: 'a.dpx.json', revision: 2 }, { kind: 'tree', path: 'b.dpx.json' }, { kind: 'tree', path: 'dir' }]);
      sse.events.length = 0;

      // moves and deletes through the API tell other tabs
      await call('POST', '/api/move', { from: 'b', to: 'dir/b' });
      assert.equal((await sse.waitFor((e) => e.path === 'dir/b.dpx.json')).kind, 'tree');
      await call('DELETE', `/api/file?path=${q('dir/b')}`);
      assert.equal((await sse.waitFor((e) => e.path === 'dir/b.dpx.json' && e.kind === 'delete')).kind, 'delete');
      await call('POST', '/api/folder', { path: 'tmpdir' });
      await call('DELETE', `/api/folder?path=${q('tmpdir')}`);
      // `from` is set so a tab with a file under the folder open closes it
      assert.equal((await sse.waitFor((e) => e.path === 'tmpdir' && e.kind === 'tree' && e.from !== undefined)).from, 'tmpdir');
      await sleep(400); // the watcher then sees nothing new
      sse.events.length = 0;

      // outside edit of an existing file
      const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside', revision: cur.revision + 1 }));
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json');
      assert.equal(ev.kind, 'change');
      assert.equal(ev.revision, 3);

      // outside create and delete
      await writeFile(join(ws, 'new.dpx.json'), JSON.stringify({ ...cur, revision: 1 }));
      assert.equal((await sse.waitFor((e) => e.path === 'new.dpx.json')).kind, 'create');
      await rm(join(ws, 'new.dpx.json'));
      await sse.waitFor((e) => e.path === 'new.dpx.json' && e.kind === 'delete');

      // outside folder
      await mkdir(join(ws, 'outdir'));
      await sse.waitFor((e) => e.path === 'outdir' && e.kind === 'tree');

      // the changed file reads back with the outside content
      assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
    } finally {
      await sse.stop();
    }
  });
});

test('outside edit that keeps the revision: old-revision PUT is 409, GET then PUT works, SSE carries the raised revision', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const sse = sseReader(base);
    await sleep(100);
    try {
      const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' })); // revision untouched
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json');
      assert.equal(ev.kind, 'change');
      assert.equal(ev.revision, 2);

      let r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 1 });
      assert.equal(r.status, 409);
      assert.equal(r.body.revision, 2);
      r = await call('GET', `/api/file?path=${q('a')}`);
      assert.equal(r.body.title, 'outside');
      assert.equal(r.body.revision, 2);
      r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'merged', revision: 2 });
      assert.equal(r.status, 200);
      assert.equal(r.body.revision, 3);
    } finally {
      await sse.stop();
    }
  });
});

test('outside edit seen first by PUT (no watcher event yet) still cannot be overwritten', async () => {
  await withApp(async ({ ws, call, app }) => {
    await call('POST', '/api/file', { path: 'a' });
    const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
    await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' }));
    const r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
  });
});

test('outside save of broken JSON then valid JSON with the same revision: old-revision PUT is 409', async () => {
  await withApp(async ({ ws, base, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { title: 'mine', revision: 1 })).body.revision, 2);
    const cur = JSON.parse(await readFile(join(ws, 'a.dpx.json'), 'utf8'));
    const sse = sseReader(base);
    await sleep(100);
    try {
      await writeFile(join(ws, 'a.dpx.json'), '{ broken');
      await sse.waitFor((e) => e.path === 'a.dpx.json' && e.revision === null);
      await writeFile(join(ws, 'a.dpx.json'), JSON.stringify({ ...cur, title: 'outside' })); // still revision 2
      const ev = await sse.waitFor((e) => e.path === 'a.dpx.json' && e.revision !== null);
      assert.equal(ev.revision, 3);

      const r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale client', revision: 2 });
      assert.equal(r.status, 409);
      assert.equal(r.body.revision, 3);
      assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');
    } finally {
      await sse.stop();
    }
  });
});

test('deleted then recreated file starts above the old revision; old-revision PUT is 409', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    await call('PUT', `/api/file?path=${q('a')}`, { title: 'v2', revision: 1 });
    await call('PUT', `/api/file?path=${q('a')}`, { title: 'v3', revision: 2 });
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);

    // recreated through the API
    let r = await call('POST', '/api/file', { path: 'a' });
    assert.equal(r.body.revision, 4);
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 3 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 4);

    // recreated from outside with a low revision
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);
    await writeFile(join(ws, 'a.dpx.json'), JSON.stringify(newFile({ title: 'outside' }))); // revision 1
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 4 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 5);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.title, 'outside');

    // another file moved onto the path
    assert.equal((await call('DELETE', `/api/file?path=${q('a')}`)).status, 200);
    await call('POST', '/api/file', { path: 'b' });
    assert.equal((await call('POST', '/api/move', { from: 'b', to: 'a' })).status, 200);
    r = await call('PUT', `/api/file?path=${q('a')}`, { title: 'stale', revision: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.revision, 6);
  });
});

test('the revision floors of deleted files are bounded, newest kept', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const store = createStore(ws, {});
  try {
    for (const name of ['old', 'recent']) {
      await store.createFile(name, {});
      const f = await store.readFile(name);
      await store.writeFile(name, { ...f, revision: f.revision });
    }
    await store.removeFile('old');
    for (let i = 0; i < 1100; i++) {
      await store.createFile(`x${i}`, {});
      await store.removeFile(`x${i}`);
    }
    await store.removeFile('recent');
    assert.equal((await store.createFile('old', {})).revision, 1, 'the oldest floor was dropped');
    assert.equal((await store.createFile('recent', {})).revision, 3, 'a recent deletion keeps its floor');
  } finally {
    store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('an async fs.watch error is logged once, by code only, and does not crash', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const fake = Object.assign(new EventEmitter(), { close() {} });
  const store = createStore(ws, { watchFn: () => fake });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.startWatching();
    const err = Object.assign(new Error(`ENOSPC: watch limit reached at ${ws}`), { code: 'ENOSPC' });
    fake.emit('error', err);
    fake.emit('error', err);
    assert.equal(warn.mock.callCount(), 1);
    const line = String(warn.mock.calls[0].arguments[0]);
    assert.match(line, /ENOSPC/);
    assert.ok(!line.includes(ws), 'no absolute path in the log');
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('after an async fs.watch error the watcher is closed and started again, and outside edits are seen again', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const watchers = [];
  const watchFn = (_root, _opts, cb) => {
    const w = Object.assign(new EventEmitter(), { cb, closed: false, close() { this.closed = true; } });
    watchers.push(w);
    return w;
  };
  const changes = [];
  const store = createStore(ws, { watchFn, watchRestartMs: 10, watchDebounceMs: 0, onExternalChange: (c) => changes.push(c) });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.createFile('x');
    await store.startWatching();
    assert.equal(watchers.length, 1);
    watchers[0].emit('error', Object.assign(new Error('x'), { code: 'ENOSPC' }));
    assert.equal(watchers[0].closed, true);
    for (let i = 0; i < 100 && watchers.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(watchers.length, 2, 'a new watcher was started');
    assert.equal(warn.mock.callCount(), 1);
    // An edit made outside the app after the restart is seen through the new watcher.
    const cur = JSON.parse(await readFile(join(ws, 'x.dpx.json'), 'utf8'));
    await writeFile(join(ws, 'x.dpx.json'), JSON.stringify({ ...cur, title: 'edited outside', revision: cur.revision + 1 }));
    watchers[1].cb('change', 'x.dpx.json');
    for (let i = 0; i < 100 && !changes.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(changes.some((c) => c.path === 'x.dpx.json'), 'outside edit after the restart was reported');
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
  const n = watchers.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(watchers.length, n, 'no restart after close');
});

test('a watcher that keeps failing right after it starts backs off and warns once', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const starts = [];
  const watchFn = (_root, _opts, cb) => {
    const w = Object.assign(new EventEmitter(), { cb, closed: false, close() { this.closed = true; } });
    starts.push(Date.now());
    // Every watcher dies at once, like a recursive watch over the inotify limit.
    setImmediate(() => w.emit('error', Object.assign(new Error('x'), { code: 'ENOSPC' })));
    return w;
  };
  const store = createStore(ws, { watchFn, watchRestartMs: 20 });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.startWatching();
    await new Promise((r) => setTimeout(r, 400));
    // With a fixed 20 ms delay this would be ~20 starts; doubling (20, 40, 80, 160, ...) gives about 5.
    assert.ok(starts.length <= 6, `restarted ${starts.length} times in 400 ms`);
    assert.ok(starts.length >= 3, 'it keeps trying');
    assert.equal(warn.mock.callCount(), 1, 'one warning per run');
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('an outside edit found by the restarted watcher\'s catch-up is flagged catchUp, one seen live is not (#401)', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const watchers = [];
  const watchFn = (_root, _opts, cb) => {
    const w = Object.assign(new EventEmitter(), { cb, closed: false, close() { this.closed = true; } });
    watchers.push(w);
    return w;
  };
  const changes = [];
  const store = createStore(ws, { watchFn, watchRestartMs: 10, watchDebounceMs: 0, onExternalChange: (c) => changes.push(c) });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.createFile('x');
    await store.startWatching();
    const edit = async (n) => {
      const cur = JSON.parse(await readFile(join(ws, 'x.dpx.json'), 'utf8'));
      await writeFile(join(ws, 'x.dpx.json'), JSON.stringify({ ...cur, title: `edit ${n}`, revision: cur.revision + 1 }));
    };
    await edit(1);
    watchers[0].cb('change', 'x.dpx.json');
    for (let i = 0; i < 100 && !changes.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(changes.at(-1).catchUp, undefined);
    // The watcher dies; an edit lands while nothing watches; the restart's catch-up finds it.
    watchers[0].emit('error', Object.assign(new Error('x'), { code: 'ENOSPC' }));
    await edit(2);
    const n = changes.length;
    for (let i = 0; i < 100 && changes.length === n; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(changes.at(-1).path, 'x.dpx.json');
    assert.equal(changes.at(-1).catchUp, true);
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

// npm test runs with DRAW_WORKSPACE_WATCH=poll, so this is the one test that drives the production fs.watch path (#512).
test('the real fs.watch notices a file edited outside the app', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  let startErr = null;
  // Wrap fs.watch so a machine out of inotify instances/watches (EMFILE, ENOSPC) skips the test instead of failing it.
  const watchFn = (root, opts, cb) => {
    try {
      const w = watch(root, opts, cb);
      w.on('error', (err) => { startErr ??= err; });
      return w;
    } catch (err) {
      startErr = err;
      throw err;
    }
  };
  const changes = [];
  const store = createStore(ws, { watchFn, watchDebounceMs: 0, onExternalChange: (c) => changes.push(c) });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.createFile('x');
    await store.startWatching();
    if (startErr) {
      t.skip(`fs.watch unavailable here (${startErr.code ?? 'error'})`);
      return;
    }
    const cur = JSON.parse(await readFile(join(ws, 'x.dpx.json'), 'utf8'));
    await writeFile(join(ws, 'x.dpx.json'), JSON.stringify({ ...cur, title: 'edited outside', revision: cur.revision + 1 }));
    // Generous wait: a loaded machine can deliver inotify events late.
    for (let i = 0; i < 200 && !changes.some((c) => c.path === 'x.dpx.json') && !startErr; i++) await new Promise((r) => setTimeout(r, 25));
    if (startErr && !changes.length) {
      t.skip(`fs.watch failed here (${startErr.code ?? 'error'})`);
      return;
    }
    const c = changes.find((x) => x.path === 'x.dpx.json');
    assert.ok(c, 'outside edit was reported through fs.watch');
    assert.equal(c.kind, 'change');
    assert.equal(c.catchUp, undefined);
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('the default watcher is the real fs.watch; only DRAW_WORKSPACE_WATCH=poll swaps in polling', async () => {
  const fsWatch = (await import('node:fs')).watch;
  const { pickWatchFn } = await import('../server/workspace/store.js');
  const { pollWatch } = await import('../server/workspace/poll-watch.js');
  assert.equal(pickWatchFn({}), fsWatch);
  assert.equal(pickWatchFn({ DRAW_WORKSPACE_WATCH: '' }), fsWatch);
  assert.equal(pickWatchFn({ DRAW_WORKSPACE_WATCH: 'poll' }), pollWatch);
});

test('pollWatch reports outside edits, new files and deletions, and stops on close', async () => {
  const { pollWatch } = await import('../server/workspace/poll-watch.js');
  const { writeFile, unlink, mkdir } = await import('node:fs/promises');
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const seen = [];
  const w = pollWatch(ws, { recursive: true }, (_e, f) => seen.push(f), 20);
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn(), JSON.stringify(seen)); };
  try {
    await mkdir(join(ws, 'sub'));
    await writeFile(join(ws, 'sub', 'a.dpx'), 'one');
    await until(() => seen.includes('sub/a.dpx'));
    seen.length = 0;
    await writeFile(join(ws, 'sub', 'a.dpx'), 'two two');
    await until(() => seen.includes('sub/a.dpx'));
    seen.length = 0;
    await unlink(join(ws, 'sub', 'a.dpx'));
    await until(() => seen.includes('sub/a.dpx'));
    w.close();
    seen.length = 0;
    await writeFile(join(ws, 'late.dpx'), 'x');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(seen, []);
  } finally {
    w.close();
    await rm(ws, { recursive: true, force: true });
  }
});

test('project mode (reserved worktrees): root watched alone, each document folder recursively, never worktrees or .drawing', async (t) => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-ws-'));
  const watches = [];
  const watchFn = (dir, opts, cb) => {
    const w = Object.assign(new EventEmitter(), { dir, opts, cb, closed: false, close() { this.closed = true; } });
    watches.push(w);
    return w;
  };
  const changes = [];
  await mkdir(join(ws, 'worktrees', 'impl-1', 'docs'), { recursive: true });
  await writeFile(join(ws, 'worktrees', 'impl-1', 'docs', 'copy.dpx.json'), '{}');
  await mkdir(join(ws, 'Server', '저장'), { recursive: true });
  const store = createStore(ws, { watchFn, reserved: ['worktrees'], watchDebounceMs: 0, onExternalChange: (c) => changes.push(c) });
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await store.createFile('Server/저장/계획');
    await store.startWatching();
    const rel = (w) => w.dir.slice(ws.length).replace(/^[/\\]/, '');
    const live = () => watches.filter((w) => !w.closed).map((w) => `${rel(w) || '<root>'}:${w.opts.recursive}`).sort();
    assert.deepEqual(live(), ['<root>:false', 'Server:true']);
    // Tree and API never show or accept the reserved folder.
    assert.deepEqual((await store.tree()).map((n) => n.name), ['Server']);
    await assert.rejects(store.createFile('worktrees/x'), /reserved/);
    // An outside edit in a document folder arrives with its full workspace path.
    const file = join(ws, 'Server', '저장', '계획.dpx.json');
    const cur = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...cur, title: 'edited outside', revision: cur.revision + 1 }));
    watches.find((w) => rel(w) === 'Server').cb('change', join('저장', '계획.dpx.json'));
    for (let i = 0; i < 100 && !changes.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(changes.some((c) => c.path === 'Server/저장/계획.dpx.json'));
    // A new top-level folder gets its own watch; a root event for worktrees adds none.
    await mkdir(join(ws, 'Web'));
    const root = watches.find((w) => rel(w) === '');
    root.cb('rename', 'Web');
    root.cb('rename', 'worktrees');
    root.cb('rename', '.drawing');
    assert.deepEqual(live(), ['<root>:false', 'Server:true', 'Web:true']);
    // A folder that goes away has its watch closed.
    await rm(join(ws, 'Web'), { recursive: true });
    root.cb('rename', 'Web');
    assert.deepEqual(live(), ['<root>:false', 'Server:true']);
  } finally {
    warn.mock.restore();
    await store.close();
    await rm(ws, { recursive: true, force: true });
  }
  assert.ok(watches.every((w) => w.closed), 'close() closes every watch');
});
