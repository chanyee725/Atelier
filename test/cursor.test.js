// E56 live agent cursor, server side: diff model and the cursor module's attribution and events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { blockText, changedCentre, changedDocSpot, docBlocksOf, mentionsFile, shapesOf } from '../server/cursor/model.js';
import { setup } from '../server/cursor/index.js';
import { Hub } from '../server/dispatch/hub.js';

const file = (elements = [], blocks = []) => ({ canvas: { elements }, blocks });
const rect = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, type: 'rectangle', x, y, width: w, height: h, ...extra });
const block = (id, x, y, code = 'a > b') => ({ id, type: 'flow', code, x, y, w: 200, h: 100 });

test('mentionsFile: edit tools and curl URLs count, read tools and lookalike names do not', () => {
  const rel = 'plans/a.dpx.json';
  assert.equal(mentionsFile({ kind: 'tool', name: 'Edit', text: '{"file_path":"/w/plans/a.dpx.json","old_string":"x"}' }, rel), true);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Bash', text: `curl -X PUT 'http://127.0.0.1:1/api/file?path=${encodeURIComponent(rel)}'` }, rel), true);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Read', text: '{"file_path":"/w/plans/a.dpx.json"}' }, rel), false);
  assert.equal(mentionsFile({ kind: 'tool', name: 'Edit', text: '{"file_path":"/w/plans/xa.dpx.json"}' }, 'a.dpx.json'), false);
  assert.equal(mentionsFile({ kind: 'assistant', text: 'plans/a.dpx.json' }, rel), false);
});

test('changedCentre: centre of added, changed and removed shapes; null when nothing moved', () => {
  const a = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500)], [block('b1', 1000, 0)]));
  assert.equal(changedCentre(a, a), null);
  // r1 moved to 100,100 (100x50): centre 150,125.
  const b = shapesOf(file([rect('r1', 100, 100), rect('r2', 500, 500)], [block('b1', 1000, 0)]));
  assert.deepEqual(changedCentre(a, b), { x: 150, y: 125 });
  // A block's code changed: its own box.
  const c = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500)], [block('b1', 1000, 0, 'a > c')]));
  assert.deepEqual(changedCentre(a, c), { x: 1100, y: 50 });
  // r2 removed (deleted flag): its old box.
  const d = shapesOf(file([rect('r1', 0, 0), rect('r2', 500, 500, 100, 50, { isDeleted: true })], [block('b1', 1000, 0)]));
  assert.deepEqual(changedCentre(a, d), { x: 550, y: 525 });
  // Negative width (arrows drawn leftwards) is normalised.
  assert.deepEqual([...shapesOf(file([rect('n', 100, 0, -40, 10)])).values()][0].box, { x: 60, y: 0, w: 40, h: 10 });
});

function rig() {
  const files = new Map();
  const listeners = new Set();
  const sent = [];
  const hub = Object.assign(new EventEmitter(), { sessions: {}, get(id) { return this.sessions[id]; } });
  const ctx = {
    hub: { broadcast: (event, data) => sent.push({ event, data }) },
    modules: {
      workspace: {
        store: { readFile: async (rel) => { if (!files.has(rel)) throw new Error('nope'); return files.get(rel); } },
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      },
      dispatch: { hub },
    },
  };
  const change = async (rel, f, opts) => {
    files.set(rel, f);
    for (const fn of listeners) fn(rel, opts);
    await new Promise((r) => setTimeout(r, 5));
  };
  return { files, hub, ctx, sent, listeners, change, tick: () => new Promise((r) => setTimeout(r, 5)) };
}

test('cursor module: an agent edit is broadcast at the changed shape; a human-only change is not', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('a.dpx.json', file([rect('r1', 0, 0)]));
  // A save from this page: no cursor.
  await r.change('a.dpx.json', file([rect('r1', 10, 0)]), { app: true });
  assert.equal(r.sent.length, 0);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/x/wt/a.dpx.json"}' } });
  await r.tick();
  await r.change('a.dpx.json', file([rect('r1', 10, 0), rect('r2', 300, 300)]));
  assert.deepEqual(r.sent.map((s) => s.event), ['cursor']);
  const { at, ...rest } = r.sent[0].data;
  assert.equal(typeof at, 'number');
  assert.deepEqual(rest, { sid: 's1', name: 'Remy', role: 'impl', file: 'a.dpx.json', x: 350, y: 325, live: true, status: '다이어그램 작성 중…' });
  // A change with no shape moved keeps the cursor alive without a place.
  await r.change('a.dpx.json', { ...file([rect('r1', 10, 0), rect('r2', 300, 300)]), title: 't' });
  assert.equal('x' in r.sent[1].data, false);
  // The session is removed: its cursor goes.
  r.hub.emit('removed', { id: 's1' });
  assert.deepEqual(r.sent[2].data, { sid: 's1', gone: true });
  m.close();
});

test('cursor module: the baseline is read when the tool call arrives, so the first edit has a place', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('p/a.dpx.json', file([rect('r1', 0, 0)]));
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Write', text: '{"file_path":"/abs/repo/p/a.dpx.json"}' } });
  await r.tick();
  await r.change('p/a.dpx.json', file([rect('r1', 200, 0)]));
  assert.equal(r.sent[0].data.x, 250);
  m.close();
});

test('cursor module: an agent creating a diagram gets a cursor at what it drew (#249)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running', color: '#0f766e' };
  // The file does not exist when the tool call arrives: the tool-time read fails.
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Write', text: '{"file_path":"/abs/repo/new.dpx.json"}' } });
  await r.tick();
  await r.change('new.dpx.json', file([rect('r1', 0, 0), rect('r2', 200, 100)]));
  // Bounds 0..300 x 0..150 against an empty canvas.
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].data.x, 150);
  assert.equal(r.sent[0].data.y, 75);
  assert.equal(r.sent[0].data.color, '#0f766e');
  m.close();
});

test('cursor module: a tool-time read that lands after the edit does not hide the first cursor (#249)', async () => {
  const r = rig();
  const read = r.ctx.modules.workspace.store.readFile;
  let release;
  const gate = new Promise((ok) => (release = ok));
  let slow = true;
  // The first read (the tool-time baseline) is slow: it resolves only after the edit has landed.
  r.ctx.modules.workspace.store.readFile = async (rel) => {
    if (slow) {
      slow = false;
      await gate;
    }
    return read(rel);
  };
  const m = await setup(r.ctx);
  r.files.set('a.dpx.json', file([rect('r1', 0, 0)]));
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  r.files.set('a.dpx.json', file([rect('r1', 0, 0), rect('r2', 400, 0)]));
  const done = r.change('a.dpx.json', r.files.get('a.dpx.json'));
  release();
  await done;
  await r.tick();
  // The baseline read saw the edited file: no diff, so the cursor is placed against an empty canvas instead of
  // being dropped (bounds 0..500 x 0..50).
  assert.equal(r.sent.length, 1);
  assert.deepEqual([r.sent[0].data.x, r.sent[0].data.y], [250, 25]);
  // The next edit diffs against the version the change reported, not a tool-time read.
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  await r.tick();
  await r.change('a.dpx.json', file([rect('r1', 0, 0), rect('r2', 400, 0), rect('r3', 0, 300)]));
  assert.deepEqual([r.sent[1].data.x, r.sent[1].data.y], [50, 325]);
  m.close();
});

test('cursor module: quick changes to one file are diffed in order (#249)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.hub.sessions.s1 = { id: 's1', name: 'Remy', role: 'impl', status: 'running' };
  await r.change('a.dpx.json', file([rect('r1', 0, 0)]), { app: true }); // the reported version: r1 only
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/w/a.dpx.json"}' } });
  await r.tick();
  // Two changes back to back. The first one's read is slow, the second one's is fast: handled concurrently, the
  // second would diff first and the first would then diff backwards.
  const v1 = file([rect('r1', 0, 0), rect('r2', 1000, 0)]);
  const v2 = file([rect('r1', 0, 0), rect('r2', 1000, 0), rect('r3', 0, 1000)]);
  const reads = [[v1, 40], [v2, 0]];
  r.ctx.modules.workspace.store.readFile = async () => {
    const [v, ms] = reads.shift();
    await new Promise((ok) => setTimeout(ok, ms));
    return v;
  };
  void r.change('a.dpx.json', v1);
  await r.change('a.dpx.json', v2);
  await new Promise((ok) => setTimeout(ok, 80));
  // r2's centre, then r3's.
  assert.deepEqual(r.sent.map((s) => [s.data.x, s.data.y]), [[1050, 25], [50, 1025]]);
  m.close();
});

test('cursor module: two agents editing two blocks of one file each get their own cursor (#375)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const tool = (id, text) => r.hub.emit('message', { id, entry: { kind: 'tool', name: 'Bash', text } });
  tool('c', `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}'`);
  tool('a', `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}'`); // Ash's call is the newest
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c', 'a']);
  assert.equal(cur[0].y, 50);
  assert.equal(cur[1].y, 550);
  await m.close();
});

test('cursor module: a tool call naming the block wins over call order (#375)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\":\\"bot\\""}` } });
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\":\\"top\\""}` } });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c']);
  await m.close();
});

test('cursor module: whole-file curl PUT bodies name every block, so call order decides (#390)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const put = (id, blocks) => r.hub.emit('message', { id, entry: { kind: 'tool', name: 'Bash', text: JSON.stringify({
    command: `curl -X PUT 'http://127.0.0.1:1/api/file?path=${rel}' -H 'x-drawing: 1' -d '${JSON.stringify({ blocks })}'`,
  }) } });
  put('c', [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]);
  put('a', [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]); // Ash's call is the newest
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c', 'a']);
  assert.deepEqual(cur.map((d) => d.y), [50, 550]);
  await m.close();
});

test('cursor module: a block with an empty id does not hang attribution (#395)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  // Cora's call is raw Codex-style text naming the changed block; Ash's names nothing.
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` } });
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'apply_patch', text: `*** Update File: ${rel}\n"id": "top"` } });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('', 0, 500)]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['c']);
  await m.close();
});

test('cursor module: a call that left no edit does not take the next one (#390)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const say = (id, entry) => r.hub.emit('message', { id, entry });
  // Cora reads the file through the API and is done with it.
  say('c', { kind: 'tool', name: 'Bash', text: JSON.stringify({ command: `curl -s 'http://127.0.0.1:1/api/file?path=${rel}' | jq .blocks` }) });
  now += 200;
  say('c', { kind: 'tool_result', text: '[]', error: false });
  await r.tick();
  now += 10_000;
  // Ash edits the file 10s later: the cursor is Ash's, not Cora's older uncredited call.
  say('a', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500)]));
  // Cora tries an Edit that fails; Ash edits again right after.
  say('c', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  say('c', { kind: 'tool_result', text: 'old_string not found', error: true });
  say('a', { kind: 'tool_result', text: 'ok', error: false });
  say('a', { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}` });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0, 'x > y'), block('bot', 0, 500, 'p > q')]));
  const cur = r.sent.filter((e) => e.event === 'cursor').map((e) => e.data);
  assert.deepEqual(cur.map((d) => d.sid), ['a', 'a']);
  // A change nobody's open call can explain (all finished long ago) shows no cursor.
  say('a', { kind: 'tool_result', text: 'ok', error: false });
  now += 10_000;
  await r.change(rel, file([], [block('top', 0, 0), block('bot', 0, 500)]), { app: true });
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 2);
  await m.close();
});

test('cursor module: Claude results are paired by call id, so an older still-running call cannot take the result of a newer call (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0)]));
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  const say = (entry) => r.hub.emit('message', { id: 'c', entry });
  // A slow call (older, still running; a subagent's work looks the same from here) and an Edit run side by side; the Edit's result comes first.
  say({ kind: 'tool', name: 'Bash', text: 'sleep 60', callId: 'toolu_1' });
  say({ kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}`, callId: 'toolu_2' });
  now += 100;
  say({ kind: 'tool_result', text: 'ok', error: false, callId: 'toolu_2' });
  await r.tick();
  now += 10_000;
  // Edit finished 10s ago (its own change is long past): a human edit now is not Cora's. By call order the Edit
  // would have stayed "running" (the Edit's result would have closed the sleep) and been credited.
  await r.change(rel, file([], [block('top', 0, 0, 'x > y')]), { app: true });
  assert.equal(r.sent.filter((e) => e.event === 'cursor').length, 0);
  await m.close();
});

test('cursor module: a watcher catch-up attributes to calls older than the settle window (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0)]));
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}"}`, callId: 't1' } });
  now += 100;
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool_result', text: 'ok', error: false, callId: 't1' } });
  await r.tick();
  now += 10_000; // the watcher was down for this long
  r.files.set(rel, file([], [block('top', 0, 0, 'x > y')]));
  for (const fn of [...r.listeners]) fn(rel, { catchUp: true });
  await r.tick();
  assert.deepEqual(r.sent.filter((e) => e.event === 'cursor').map((e) => e.data.sid), ['c']);
  await m.close();
});

test('cursor module: ids that are common path words still tell two calls apart (#401)', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'flow.dpx.json';
  r.files.set(rel, file([], [block('top', 0, 0), block('api', 0, 500)]));
  r.hub.sessions.a = { id: 'a', name: 'Ash', role: 'impl', status: 'running' };
  r.hub.sessions.c = { id: 'c', name: 'Cora', role: 'impl', status: 'running' };
  // Cora edits block "api" by name. Ash's newer call only has "api" and "flow" as path words (/api/file, flow.dpx.json):
  // a plain substring match would credit Ash (newest of two "named" calls); whole-token matching leaves only Cora.
  r.hub.emit('message', { id: 'c', entry: { kind: 'tool', name: 'Edit', text: `{"file_path":"/w/${rel}","new_string":"\\"id\\": \\"api\\""}` } });
  now += 50;
  r.hub.emit('message', { id: 'a', entry: { kind: 'tool', name: 'Bash', text: `curl -s 'http://127.0.0.1:1/api/file?path=${rel}'` } });
  await r.tick();
  await r.change(rel, file([], [block('top', 0, 0), block('api', 0, 500, 'x > y')]));
  assert.deepEqual(r.sent.filter((e) => e.event === 'cursor').map((e) => e.data.sid), ['c']);
  await m.close();
});

test('cursor module: a write nobody on this hub made gets a generic cursor at the changed shape (#543)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('a.dpx.json', file([rect('r1', 0, 0)]));
  await r.change('a.dpx.json', file([rect('r1', 0, 0)]), { app: true });
  await r.change('a.dpx.json', file([rect('r1', 0, 0), rect('r2', 300, 300)]));
  assert.equal(r.sent.length, 1);
  const { at, ...rest } = r.sent[0].data;
  assert.equal(typeof at, 'number');
  assert.deepEqual(rest, { sid: 'outside:a.dpx.json', name: '에이전트', role: '', file: 'a.dpx.json', x: 350, y: 325 });
  // Nothing with a place changed: no cursor.
  await r.change('a.dpx.json', { ...file([rect('r1', 0, 0), rect('r2', 300, 300)]), title: 't' });
  assert.equal(r.sent.length, 1);
  m.close();
});

// E529 (#619): document changes give the doc view a place (top-level block index + text offset).
const para = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] });
const head = (t, id) => ({ type: 'heading', attrs: { level: 2, ...(id ? { id } : {}) }, content: [{ type: 'text', text: t }] });
const docFile = (...content) => ({ canvas: { elements: [] }, blocks: [], document: { type: 'doc', content } });
const spot = (a, b) => changedDocSpot(docBlocksOf(a), docBlocksOf(b));

test('changedDocSpot: appended, edited, replaced and removed blocks', () => {
  const a = docFile(head('Plan'), para('one'));
  assert.equal(spot(a, a), null);
  // A new paragraph at the end: its end.
  assert.deepEqual(spot(a, docFile(head('Plan'), para('one'), para('two!'))), { index: 2, offset: 4 });
  // Typing inside a paragraph: just past the inserted text.
  assert.deepEqual(spot(a, docFile(head('Plan'), para('o-n-e'))), { index: 1, offset: 4 });
  assert.deepEqual(spot(docFile(para('hello world')), docFile(para('hello brave world'))), { index: 0, offset: 12 });
  // Several new blocks: the last one written.
  assert.deepEqual(spot(a, docFile(head('Plan'), para('x'), para('yz'), para('one'))), { index: 2, offset: 2 });
  // A block replaced by one of another type: its end.
  assert.deepEqual(spot(a, docFile(head('Plan'), head('one'))), { index: 1, offset: 3 });
  // Removed: the start of the block now in its place; at the end, the block before.
  assert.deepEqual(spot(docFile(para('a'), para('b'), para('c')), docFile(para('a'), para('c'))), { index: 1, offset: 0 });
  assert.deepEqual(spot(a, docFile(head('Plan'))), { index: 0, offset: 0 });
  assert.equal(spot(a, docFile()), null);
  // From no document (a new file): the last block.
  assert.deepEqual(spot({}, a), { index: 1, offset: 3 });
  // A heading id the editor added is not a change.
  assert.equal(spot(docFile(head('Plan')), docFile(head('Plan', 'plan'))), null);
  // An embedded diagram (no text): offset 0.
  assert.deepEqual(spot(a, docFile(head('Plan'), para('one'), { type: 'diagram', attrs: { blockId: 'b1' } })), { index: 2, offset: 0 });
});

test('blockText: text nodes only, nested blocks included', () => {
  const list = { type: 'bulletList', content: [{ type: 'listItem', content: [para('ab')] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }, { type: 'hardBreak' }, { type: 'text', text: 'd' }] }] }] };
  assert.equal(blockText(list), 'abcd');
});

test('cursor module: a document edit carries the doc place; a canvas-only edit does not (#619)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('d.dpx.json', docFile(head('Plan')));
  r.hub.sessions.s1 = { id: 's1', name: 'Otto', role: 'impl', status: 'running' };
  r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Edit', text: '{"file_path":"/x/d.dpx.json"}' } });
  await r.tick();
  await r.change('d.dpx.json', docFile(head('Plan'), para('step one')));
  const { at, ...rest } = r.sent[0].data;
  assert.deepEqual(rest, { sid: 's1', name: 'Otto', role: 'impl', file: 'd.dpx.json', doc: { index: 1, offset: 8 }, live: true, status: '글 작성 중…' });
  await r.change('d.dpx.json', { ...docFile(head('Plan'), para('step one')), canvas: { elements: [rect('r1', 0, 0)] } });
  assert.equal('doc' in r.sent[1].data, false);
  assert.equal(r.sent[1].data.x, 50);
  m.close();
});

test('cursor module: an outside writer of the document gets a doc place too (#619)', async () => {
  const r = rig();
  const m = await setup(r.ctx);
  r.files.set('d.dpx.json', docFile(para('a')));
  await r.change('d.dpx.json', docFile(para('a')));
  await r.change('d.dpx.json', docFile(para('ab')), { writer: 'Cal' });
  const last = r.sent.filter((e) => e.event === 'cursor').at(-1).data;
  assert.equal(last.name, 'Cal');
  assert.deepEqual(last.doc, { index: 0, offset: 2 });
  m.close();
});

// E536 (#653): a session on this hub keeps its own name on every edit, however it writes.
function clock(t) {
  const real = Date.now;
  let off = 0;
  Date.now = () => real() + off;
  t.after(() => { Date.now = real; });
  return (ms) => { off += ms; };
}
const paras = (n) => ({ document: { type: 'doc', content: Array.from({ length: n }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `p${i}` }] })) }, canvas: { elements: [] }, blocks: [] });

test('cursor module: extensionless and partly encoded /api/file paths, five writes over 30 s, keep the name (#653)', async (t) => {
  const later = clock(t);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'Sim-Studio/07-서버-데이터-저장.dpx.json';
  r.files.set(rel, paras(1));
  r.hub.sessions.s1 = { id: 's1', name: 'Jude', role: 'impl', status: 'running' };
  const paths = [
    'Sim-Studio/07-서버-데이터-저장', // as typed, no extension
    encodeURIComponent('Sim-Studio/07-서버-데이터-저장'),
    encodeURIComponent('Sim-Studio/07-서버-데이터-저장').replace(/%2F/g, '/'), // python quote() keeps "/"
    rel,
    'Sim-Studio/07-서버-데이터-저장',
  ];
  for (const [i, p] of paths.entries()) {
    later(6000);
    const id = `c${i}`;
    r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name: 'Bash', callId: id, text: JSON.stringify({ command: `curl -sf -X PUT "http://127.0.0.1:4001/api/file?path=${p}" -H 'x-drawing: 1' --data-binary @/tmp/n.json` }) } });
    await r.tick();
    await r.change(rel, paras(i + 2));
    r.hub.emit('message', { id: 's1', entry: { kind: 'tool_result', callId: id, text: 'ok' } });
  }
  const names = r.sent.filter((s) => s.event === 'cursor' && !s.data.status_only).map((s) => s.data.name);
  assert.deepEqual(names, ['Jude', 'Jude', 'Jude', 'Jude', 'Jude']);
  m.close();
});

test('cursor module: a saved script run later (bash save.sh) or a call that does not name the file keeps the name (#653)', async (t) => {
  const later = clock(t);
  const r = rig();
  const m = await setup(r.ctx);
  const rel = 'analysis/robot.dpx.json';
  r.files.set(rel, paras(1));
  r.hub.sessions.s1 = { id: 's1', name: 'Jude', role: 'impl', status: 'running' };
  const call = async (id, name, text, n) => {
    r.hub.emit('message', { id: 's1', entry: { kind: 'tool', name, callId: id, text } });
    await r.tick();
    if (n) await r.change(rel, paras(n));
    r.hub.emit('message', { id: 's1', entry: { kind: 'tool_result', callId: id, text: 'ok' } });
  };
  await call('w', 'Write', JSON.stringify({ file_path: '/tmp/jude/save.sh', content: 'set -e\nURL="http://127.0.0.1:4001/api/file?path=analysis/robot"\ncurl -sf "$URL" > /tmp/r.json\n' }));
  later(20_000);
  await call('b1', 'Bash', JSON.stringify({ command: 'bash /tmp/jude/save.sh' }), 2);
  later(20_000);
  await call('b2', 'Bash', JSON.stringify({ command: 'cd /tmp/jude && bash save.sh' }), 3);
  later(70_000); // past ATTRIBUTE_MS since the script was written
  await call('b3', 'Bash', JSON.stringify({ command: 'bash save.sh' }), 4);
  // A helper whose name says nothing about the file, after the session already edited it.
  later(10_000);
  await call('b4', 'Bash', JSON.stringify({ command: 'node put.mjs' }), 5);
  const names = r.sent.filter((s) => s.event === 'cursor' && s.data.x === undefined && s.data.doc).map((s) => s.data.name);
  assert.deepEqual(names, ['Jude', 'Jude', 'Jude', 'Jude']);
  m.close();
});

test('cursor module: status label follows the running call; page saves are never the agent\'s; replay on attach (#653)', async () => {
  const r = rig();
  const attach = [];
  r.ctx.hub.onAttach = (fn) => attach.push(fn);
  const m = await setup(r.ctx);
  const rel = 'd.dpx.json';
  r.files.set(rel, paras(1));
  r.hub.sessions.s1 = { id: 's1', name: 'Jude', role: 'impl', status: 'running' };
  const seen = [];
  m.onStatus((e) => seen.push(e.status));
  const say = (entry) => r.hub.emit('message', { id: 's1', entry });
  say({ kind: 'tool', name: 'Bash', callId: 'a', text: JSON.stringify({ command: `curl -X PUT 'http://127.0.0.1:1/api/file?path=d' -d @/tmp/x.json` }) });
  await r.tick();
  await r.change(rel, paras(2));
  say({ kind: 'tool_result', callId: 'a', text: 'ok' });
  assert.equal(m.statusOf('s1'), '글 작성 중…');
  say({ kind: 'tool', name: 'Read', callId: 'b', text: '{"file_path":"/x/server/a.js"}' });
  assert.equal(m.statusOf('s1'), '코드 읽는 중…');
  const st = r.sent.filter((s) => s.event === 'cursor-status').map((s) => s.data);
  assert.deepEqual(st.at(-1), { sid: 's1', status: '코드 읽는 중…' });
  // A save from the page while the agent's call runs stays the user's.
  say({ kind: 'tool_result', callId: 'b', text: 'ok' });
  say({ kind: 'tool', name: 'Bash', callId: 'c', text: JSON.stringify({ command: 'node helper.mjs' }) });
  const before = r.sent.filter((s) => s.event === 'cursor').length;
  await r.change(rel, paras(3), { app: true });
  assert.equal(r.sent.filter((s) => s.event === 'cursor').length, before);
  // A page that connects now gets the cursor at its last place, with the status.
  const got = [];
  for (const fn of attach) fn((ev, data) => got.push({ ev, data }));
  assert.equal(got.length, 1);
  assert.equal(got[0].data.name, 'Jude');
  assert.equal(got[0].data.live, true);
  assert.deepEqual(got[0].data.doc, { index: 1, offset: 2 });
  assert.equal(got[0].data.status, '작업 중…');
  // Waiting for a permission: 대기 중. Ended: gone, status null.
  r.hub.sessions.s1.status = 'waiting';
  r.hub.emit('session', r.hub.sessions.s1);
  assert.equal(m.statusOf('s1'), '대기 중');
  r.hub.emit('removed', { id: 's1' });
  assert.equal(seen.at(-1), null);
  assert.deepEqual(r.sent.at(-1).data, { sid: 's1', gone: true });
  m.close();
});
