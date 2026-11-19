import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createFileSession, RETRY_MAX, SAVE_DELAY } from '../../web/src/fileSession.ts';
import { RELOAD_STOPPED } from '../../web/src/saveRetry.ts';
import { ApiError, type DpxFile } from '../../web/src/api.ts';

const file = (over: Partial<DpxFile> = {}): DpxFile => ({ version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1, ...over });
const block = (id: string, x = 0) => ({ id, type: 'architecture', code: 'a', x, y: 0, w: 10, h: 10 });

type Call = { path: string; file: DpxFile; keepalive: boolean };
/** A fake PUT: each call waits until the test settles it. */
function fakeServer() {
  const calls: Call[] = [];
  const pending: { ok: (v: { revision: number }) => void; fail: (e: unknown) => void }[] = [];
  const saveFile = (path: string, f: DpxFile, keepalive: boolean) =>
    new Promise<{ revision: number }>((ok, fail) => {
      calls.push({ path, file: f, keepalive });
      pending.push({ ok, fail });
    });
  return {
    calls,
    saveFile,
    ok: (revision: number) => pending.shift()!.ok({ revision }),
    fail: (e: unknown) => pending.shift()!.fail(e),
  };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeServer();
  let saved = 0;
  const s = createFileSession({ saveFile: server.saveFile, onSaved: () => saved++ });
  s.load('a.dpx', file());
  return { s, server, saved: () => saved };
}

test('edits are debounced into one save carrying the latest content', async (t) => {
  const { s, server, saved } = setup(t);
  s.edit({ title: 'one' });
  t.mock.timers.tick(SAVE_DELAY - 1);
  s.edit({ title: 'two' });
  t.mock.timers.tick(SAVE_DELAY - 1);
  await settle();
  assert.equal(server.calls.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].file.title, 'two');
  assert.equal(server.calls[0].file.revision, 1);
  assert.equal(s.getState().status, '저장 중이에요…');
  server.ok(2);
  await settle();
  assert.equal(s.getState().file?.revision, 2);
  assert.equal(s.getState().status, '저장했어요');
  assert.equal(s.isDirty(), false);
  assert.equal(saved(), 1);
});

test('an edit made during a save stays dirty and is saved next with the new revision', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'one' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  s.edit({ title: 'two' });
  server.ok(2);
  await settle();
  assert.equal(s.isDirty(), true);
  assert.notEqual(s.getState().status, '저장했어요');
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].file.title, 'two');
  assert.equal(server.calls[1].file.revision, 2);
  server.ok(3);
  await settle();
  assert.equal(s.isDirty(), false);
});

test('a retryable failure backs off 1s, 2s, 4s … up to 30s and resets after a success', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    server.fail(new ApiError(503, 'busy'));
    await settle();
    assert.equal(s.getState().statusAlert, true);
    let waited = 0;
    while (server.calls.length === i + 1) {
      t.mock.timers.tick(500);
      waited += 500;
      await settle();
      assert.ok(waited <= RETRY_MAX, 'retry never came');
    }
    waits.push(waited);
  }
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  server.ok(2);
  await settle();
  assert.equal(s.getState().status, '저장했어요');
  // Back to the short delay after a success.
  s.edit({ title: 'y' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new TypeError('network down'));
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(server.calls.length, 10);
});

test('a 4xx refusal is not retried', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(422, 'bad'));
  await settle();
  t.mock.timers.tick(RETRY_MAX * 2);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.getState().status, '저장하지 못했어요. 내용이나 파일 이름을 확인해 주세요');
  assert.equal(s.isDirty(), true);
});

test('a newer-format file says why it is not saved', async (t) => {
  const { s, server } = setup(t);
  s.load('a.dpx', file({ version: 7 }));
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(422, 'newer'));
  await settle();
  assert.equal(s.getState().status, '더 새 버전에서 만든 파일이라 저장하지 않았어요');
});

test('a 409 stops saving until overwrite re-sends against the server revision', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'mine' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(409, 'conflict', 7));
  await settle();
  assert.deepEqual(s.getState().conflict, { revision: 7 });
  s.edit({ title: 'mine 2' });
  t.mock.timers.tick(SAVE_DELAY * 10);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.getState().status, '다른 곳에서 바뀌었어요');
  assert.equal(await s.flushForReload(), false);
  const done = s.overwrite();
  await settle();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].file.revision, 7);
  assert.equal(server.calls[1].file.title, 'mine 2');
  server.ok(8);
  await done;
  assert.equal(s.getState().conflict, null);
  assert.equal(s.isDirty(), false);
});

test('a save that finishes after another file was opened changes nothing', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  s.load('b.dpx', file({ title: 'b', revision: 5 }));
  server.ok(2);
  await settle();
  assert.equal(s.getState().path, 'b.dpx');
  assert.equal(s.getState().file?.revision, 5);
  assert.equal(s.getState().status, '');
});

test('pagehide sends pending edits with keepalive, but not while a save runs', async (t) => {
  const { s, server } = setup(t);
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 0);
  s.edit({ title: 'x' });
  assert.equal(s.hasUnsaved(), true);
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].keepalive, true);
  s.edit({ title: 'y' });
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.hasUnsaved(), true);
});

test('moving a block notifies subscribers but keeps the other slices identical', async (t) => {
  const { s } = setup(t);
  s.edit({ blocks: [block('b1')], title: 'n' });
  const before = s.getState();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  s.edit({ blocks: [block('b1', 50)] });
  const after = s.getState();
  assert.equal(calls, 1);
  assert.notEqual(after.file?.blocks, before.file?.blocks);
  assert.equal(after.file?.title, before.file?.title);
  assert.equal(after.file?.document, before.file?.document);
  assert.equal(after.file?.canvas, before.file?.canvas);
  // Setting the same status again does not wake anyone.
  s.setStatus('');
  assert.equal(calls, 1);
  off();
});

test('the "reload stopped" notice survives retries and edits until a save succeeds', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  const stopped = s.flushForReload();
  await settle();
  server.fail(new ApiError(503, 'busy'));
  assert.equal(await stopped, false);
  assert.equal(s.getState().status, RELOAD_STOPPED);
  assert.equal(s.getState().statusAlert, true);
  // The scheduled retry fails again: the notice stays.
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(s.getState().status, RELOAD_STOPPED);
  server.fail(new ApiError(503, 'busy'));
  await settle();
  assert.equal(s.getState().status, RELOAD_STOPPED);
  s.edit({ title: 'y' });
  assert.equal(s.getState().status, RELOAD_STOPPED);
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.ok(2);
  await settle();
  assert.equal(s.getState().status, '저장했어요');
});

test('an outside delete or move closes the open file and cancels its pending save', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'x' });
  const act = s.external({ kind: 'delete', path: 'a.dpx' }, () => assert.fail('no read'), () => assert.fail('no reload'));
  assert.equal(act, 'close');
  assert.equal(s.getState().path, null);
  assert.equal(s.getState().file, null);
  t.mock.timers.tick(SAVE_DELAY * 2);
  await settle();
  assert.equal(server.calls.length, 0);
  s.load('d/b.dpx', file());
  assert.equal(s.external({ kind: 'tree', path: 'e', from: 'd' }, () => assert.fail('no read'), () => {}), 'close');
  assert.equal(s.getState().path, null);
});

test('an outside change reloads a clean file once, but only refreshes a dirty one', async (t) => {
  const { s, server } = setup(t);
  const reads: string[] = [];
  const reloaded: number[] = [];
  const read = async (p: string) => {
    reads.push(p);
    return file({ revision: 5, title: 'theirs' });
  };
  const onReload = (_p: string, f: DpxFile) => reloaded.push(f.revision);
  assert.equal(s.external({ kind: 'change', path: 'a.dpx', revision: 5 }, read, onReload), 'reload');
  // A second event while the first reload runs does not read twice.
  s.external({ kind: 'change', path: 'a', revision: 5 }, read, onReload);
  await settle();
  assert.deepEqual(reads, ['a.dpx']);
  assert.deepEqual(reloaded, [5]);
  s.edit({ title: 'mine' });
  assert.equal(s.external({ kind: 'change', path: 'a.dpx', revision: 6 }, read, onReload), 'refresh');
  assert.equal(s.external({ kind: 'change', path: 'other.dpx' }, read, onReload), 'refresh');
  await settle();
  assert.deepEqual(reads, ['a.dpx']);
  void server;
});

test('flushForReload reports true after a good save and false after a refused one (no retry, no endless wait)', async (t) => {
  const { s, server } = setup(t);
  assert.equal(await s.flushForReload(), true); // nothing to save
  s.edit({ title: 'x' });
  const ok = s.flushForReload();
  await settle();
  server.ok(2);
  assert.equal(await ok, true);
  assert.equal(s.getState().status, '저장했어요');

  s.edit({ title: 'y' });
  const refused = s.flushForReload();
  await settle();
  server.fail(new ApiError(422, 'bad body'));
  assert.equal(await refused, false);
  assert.equal(s.getState().status, RELOAD_STOPPED);
  assert.equal(s.hasUnsaved(), true);
  t.mock.timers.tick(RETRY_MAX * 2);
  await settle();
  assert.equal(server.calls.length, 2, 'a refused body is not retried');
});

test('close() during a save drops the file; the late result changes nothing, hasUnsaved holds until it lands', async (t) => {
  const { s, server, saved } = setup(t);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(s.hasUnsaved(), true);
  s.close();
  assert.equal(s.getState().path, null);
  assert.equal(s.isDirty(), false);
  // The PUT is still running, so leaving now would still lose it.
  assert.equal(s.hasUnsaved(), true);
  server.ok(2);
  await settle();
  assert.equal(s.getState().path, null);
  assert.equal(s.getState().file, null);
  assert.equal(s.getState().status, '');
  assert.equal(saved(), 0);
  assert.equal(s.hasUnsaved(), false);
  // Nothing is left to save or retry.
  t.mock.timers.tick(RETRY_MAX * 2);
  await settle();
  assert.equal(server.calls.length, 1);
});

test('hasUnsaved is true while a save is in flight, and false only after it lands', async (t) => {
  const { s, server } = setup(t);
  assert.equal(s.hasUnsaved(), false);
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(s.hasUnsaved(), true);
  server.ok(2);
  await settle();
  assert.equal(s.hasUnsaved(), false);
});

test('overwrite() while a save is running waits for it and starts no second PUT when there is no conflict', async (t) => {
  const a = setup(t);
  a.s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  let doneA = false;
  void a.s.overwrite().then(() => (doneA = true));
  await settle();
  assert.equal(doneA, false, 'waits for the running save');
  a.server.ok(2);
  await settle();
  assert.equal(doneA, true);
  assert.equal(a.server.calls.length, 1);
  assert.equal(a.s.isDirty(), false);
});

test('overwrite() called while a running save hits a 409 re-sends against the server revision', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'mine' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  const done = s.overwrite();
  await settle();
  assert.equal(server.calls.length, 1, 'still waiting for the running save');
  server.fail(new ApiError(409, 'conflict', 9));
  await settle();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].file.revision, 9);
  assert.equal(server.calls[1].file.title, 'mine');
  server.ok(10);
  await done;
  assert.equal(s.getState().conflict, null);
  assert.equal(s.hasUnsaved(), false);
});

test('editing in the 409 state keeps the conflict notice, saves nothing, and overwrite sends the latest edit', async (t) => {
  const { s, server } = setup(t);
  s.edit({ title: 'one' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(409, 'conflict', 4));
  await settle();
  for (const title of ['two', 'three']) {
    s.edit({ title });
    assert.equal(s.getState().status, '다른 곳에서 바뀌었어요');
    assert.equal(s.getState().statusAlert, true);
    assert.deepEqual(s.getState().conflict, { revision: 4 });
  }
  t.mock.timers.tick(SAVE_DELAY * 10);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.hasUnsaved(), true);
  // pagehide does not fire a doomed PUT either.
  s.saveOnHide();
  await settle();
  assert.equal(server.calls.length, 1);
  const done = s.overwrite();
  await settle();
  assert.equal(server.calls[1].file.title, 'three');
  assert.equal(server.calls[1].file.revision, 4);
  server.ok(5);
  await done;
  assert.equal(s.getState().status, '저장했어요');
  assert.equal(s.hasUnsaved(), false);
});

test('hold: an edit during a slow move is saved to the new path, not the old one', async (t) => {
  const { s, server } = setup(t);
  const release = s.hold();
  s.edit({ title: 'during the move' });
  t.mock.timers.tick(SAVE_DELAY + 10);
  await settle();
  assert.equal(server.calls.length, 0, 'nothing is sent while held');
  s.rename('b.dpx', 5);
  release();
  release(); // releasing twice changes nothing
  t.mock.timers.tick(1);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].path, 'b.dpx');
  assert.equal(server.calls[0].file.revision, 5);
  assert.equal(server.calls[0].file.title, 'during the move');
});

test('a save that gets 404 (folder deleted in another tab, event missed) drops the file and tells the tab', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = fakeServer();
  let gone = 0;
  const s = createFileSession({ saveFile: server.saveFile, onGone: () => gone++ });
  s.load('a/b.dpx', file());
  s.edit({ title: 'x' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  server.fail(new ApiError(404, 'file not found'));
  await settle();
  assert.equal(s.getState().path, null);
  assert.equal(gone, 1);
  t.mock.timers.tick(RETRY_MAX * 2);
  await settle();
  assert.equal(server.calls.length, 1);
});

test('a change event that arrives while a reload reads is not dropped: the file is read once more (#555)', async (t) => {
  const { s } = setup(t);
  const reads: number[] = [];
  const gates: ((f: DpxFile) => void)[] = [];
  const read = (_p: string) => new Promise<DpxFile>((ok) => gates.push(ok));
  const reloaded: number[] = [];
  const onReload = (p: string, f: DpxFile) => {
    reloaded.push(f.revision);
    s.applyLive(p, f);
  };
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, (p) => (reads.push(2), read(p)), onReload);
  await settle();
  // Two more PUTs land while the first read is still running.
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, (p) => (reads.push(3), read(p)), onReload);
  s.external({ kind: 'change', path: 'a.dpx', revision: 4 }, (p) => (reads.push(4), read(p)), onReload);
  gates.shift()!(file({ revision: 2 }));
  await settle();
  // One follow-up read, not one per dropped event.
  assert.equal(gates.length, 1);
  gates.shift()!(file({ revision: 4 }));
  await settle();
  assert.deepEqual(reloaded, [2, 4]);
  assert.equal(s.getState().file?.revision, 4);
  assert.equal(gates.length, 0);
});

test('a dropped change event whose revision the reload already read does not read again (#555)', async (t) => {
  const { s } = setup(t);
  let reads = 0;
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => (reads++, new Promise<DpxFile>((ok) => gates.push(ok)));
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, read, () => {});
  await settle();
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, read, () => {});
  gates.shift()!(file({ revision: 3 }));
  await settle();
  assert.equal(reads, 1);
});

test('a change event for another file opened while the old file reloads is not dropped (#568)', async (t) => {
  const { s } = setup(t);
  const gates: { p: string; ok: (f: DpxFile) => void }[] = [];
  const read = (p: string) => new Promise<DpxFile>((ok) => gates.push({ p, ok }));
  const reloaded: [string, number][] = [];
  const onReload = (p: string, f: DpxFile) => {
    reloaded.push([p, f.revision]);
    s.applyLive(p, f);
  };
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, onReload);
  await settle();
  assert.equal(gates.length, 1);
  // The user opens b.dpx while a.dpx is still being read; then b.dpx changes on disk.
  s.load('b.dpx', file({ revision: 5 }));
  s.external({ kind: 'change', path: 'b.dpx', revision: 6 }, read, onReload);
  gates.shift()!.ok(file({ revision: 2 }));
  await settle();
  // a.dpx's read is not applied (b.dpx is open); b.dpx is read once more.
  assert.equal(gates.length, 1);
  assert.equal(gates[0].p, 'b.dpx');
  gates.shift()!.ok(file({ revision: 6, title: 'b6' }));
  await settle();
  assert.deepEqual(reloaded, [['b.dpx', 6]]);
  assert.equal(s.getState().path, 'b.dpx');
  assert.equal(s.getState().file?.title, 'b6');
});

test('a change event for another file that is not newer than its loaded revision does not read again (#568)', async (t) => {
  const { s } = setup(t);
  let reads = 0;
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => (reads++, new Promise<DpxFile>((ok) => gates.push(ok)));
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, () => {});
  await settle();
  s.load('b.dpx', file({ revision: 6 }));
  s.external({ kind: 'change', path: 'b.dpx', revision: 6 }, read, () => {});
  gates.shift()!(file({ revision: 2 }));
  await settle();
  assert.equal(reads, 1);
});

test('switching a.dpx -> b.dpx -> a.dpx while a.dpx reloads applies the newer read once (#568)', async (t) => {
  const { s } = setup(t);
  let reads = 0;
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => (reads++, new Promise<DpxFile>((ok) => gates.push(ok)));
  const reloaded: [string, number][] = [];
  const onReload = (p: string, f: DpxFile) => {
    reloaded.push([p, f.revision]);
    s.applyLive(p, f);
  };
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, onReload);
  await settle();
  // The user goes to b.dpx and back to a.dpx (still revision 1) before the read ends; the change event comes again.
  s.load('b.dpx', file({ revision: 5 }));
  s.load('a.dpx', file({ revision: 1 }));
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, onReload);
  gates.shift()!(file({ revision: 2, title: 'a2' }));
  await settle();
  assert.equal(reads, 1);
  assert.deepEqual(reloaded, [['a.dpx', 2]]);
  assert.equal(s.getState().file?.title, 'a2');
});

test('a read that fails still runs the queued reload, and a later event reads again (#569)', async (t) => {
  const { s } = setup(t);
  const gates: { ok: (f: DpxFile) => void; fail: (e: unknown) => void }[] = [];
  const read = () => new Promise<DpxFile>((ok, fail) => gates.push({ ok, fail }));
  const reloaded: number[] = [];
  const onReload = (p: string, f: DpxFile) => {
    reloaded.push(f.revision);
    s.applyLive(p, f);
  };
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, onReload);
  await settle();
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, read, onReload);
  gates.shift()!.fail(new Error('network'));
  await settle();
  // The failed read held nothing, so the queued event is read.
  assert.equal(gates.length, 1);
  gates.shift()!.ok(file({ revision: 3 }));
  await settle();
  assert.deepEqual(reloaded, [3]);
  // Not stuck in "reloading": the next event starts a read of its own.
  s.external({ kind: 'change', path: 'a.dpx', revision: 4 }, read, onReload);
  await settle();
  assert.equal(gates.length, 1);
});

test('a queued reload is dropped when the user edits before the read ends, and the edit is saved (#569)', async (t) => {
  const { s, server } = setup(t);
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => new Promise<DpxFile>((ok) => gates.push(ok));
  const reloaded: number[] = [];
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, (_p, f) => reloaded.push(f.revision));
  await settle();
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, read, (_p, f) => reloaded.push(f.revision));
  s.edit({ title: 'mine' });
  gates.shift()!(file({ revision: 3 }));
  await settle();
  // Neither the read nor the queued event replaces the unsaved edit.
  assert.deepEqual(reloaded, []);
  assert.equal(gates.length, 0);
  assert.equal(s.getState().file?.title, 'mine');
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(server.calls.length, 1);
});

test('a queued reload is dropped while a save is in flight (#569)', async (t) => {
  const { s, server } = setup(t);
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => new Promise<DpxFile>((ok) => gates.push(ok));
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, () => {});
  await settle();
  // The reload waits for queued saves before it reads, so it starts reading first; then an event queues and the user
  // edits and saves before the read ends.
  s.external({ kind: 'change', path: 'a.dpx', revision: 3 }, read, () => {});
  s.edit({ title: 'mine' });
  t.mock.timers.tick(SAVE_DELAY);
  await settle();
  assert.equal(server.calls.length, 1);
  assert.equal(s.hasUnsaved(), true);
  gates.shift()!(file({ revision: 3 }));
  await settle();
  assert.equal(gates.length, 0);
  server.ok(4);
  await settle();
  assert.equal(gates.length, 0);
  assert.equal(s.getState().file?.title, 'mine');
});

test('a change event without a revision always asks again after the running read (#569)', async (t) => {
  const { s } = setup(t);
  let reads = 0;
  const gates: ((f: DpxFile) => void)[] = [];
  const read = () => (reads++, new Promise<DpxFile>((ok) => gates.push(ok)));
  s.external({ kind: 'change', path: 'a.dpx', revision: 2 }, read, (p, f) => s.applyLive(p, f));
  await settle();
  s.external({ kind: 'change', path: 'a.dpx' }, read, (p, f) => s.applyLive(p, f));
  gates.shift()!(file({ revision: 9 }));
  await settle();
  // Revision 9 is newer than anything named, but the event did not name one: read once more.
  assert.equal(reads, 2);
  gates.shift()!(file({ revision: 9 }));
  await settle();
  assert.equal(reads, 2);
  assert.equal(s.getState().file?.revision, 9);
});
