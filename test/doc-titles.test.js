// #663 (#660 review): the sidebar's titlesOf keys are the same paths the working agents list gives as `file`, for a
// project document, its sub-document and a loose document. A mismatch would quietly fall back to the file name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cursor from '../server/cursor/index.js';
import * as agents from '../server/cursor/agents.js';
import * as workspace from '../server/workspace/index.js';
import { createApp } from '../server/app.js';
import { newFile } from '../server/workspace/model.js';
import { displayName, titlesOf } from '../web/src/docTitles.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls `get` until `done(value)` holds (or the time runs out) and returns the last value, so a slow machine waits
// longer instead of failing on a fixed sleep.
async function waitFor(get, done, { timeout = 5000, every = 20 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await get();
    if (done(v) || Date.now() > end) return v;
    await sleep(every);
  }
}

test('displayName: the title, else the file name without .dpx.json', () => {
  assert.equal(displayName({ name: 'a.dpx.json', title: '계획' }), '계획');
  assert.equal(displayName({ name: 'a.dpx.json' }), 'a');
  assert.equal(displayName({ name: 'a', title: '' }), 'a');
});

test('titlesOf: empty without a view; walks groups and children', () => {
  assert.equal(titlesOf(null).size, 0);
  const n = (path, title, children = []) => ({ type: 'doc', path, name: path.split('/').pop().replace(/\.dpx\.json$/, ''), title, created: null, modified: null, children });
  const view = { projects: [{ docs: [{ ...n('P/g', undefined, [n('P/g/x.dpx.json', 'X')]), type: 'group' }] }], loose: [n('l.dpx.json', 'L')] };
  assert.deepEqual([...titlesOf(view)], [['P/g', 'g'], ['P/g/x.dpx.json', 'X'], ['l.dpx.json', 'L']]);
});

test('titlesOf keys match the working agents file paths (project doc, sub-document, loose doc)', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'draw-titles-'));
  const list = [
    { name: 'workspace', setup: workspace.setup },
    { name: 'dispatch', setup: () => ({ hub: Object.assign(new EventEmitter(), { sessions: [], get: () => undefined }) }) },
    { name: 'cursor', setup: cursor.setup },
    { name: 'agents', setup: agents.setup },
  ];
  const app = await createApp({ workspaceDir: ws }, { publicDir: ws, moduleList: list });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const h = { 'x-drawing': '1', 'content-type': 'application/json' };
  const post = async (u, b) => {
    const res = await fetch(base + u, { method: 'POST', headers: h, body: JSON.stringify(b) });
    assert.ok(res.ok, `${u} ${res.status}`);
    return res.json();
  };
  try {
    const files = { 'Proj/계획.dpx.json': '계획 문서', 'Proj/계획/세부.dpx.json': '세부 문서', 'loose.dpx.json': '따로 문서' };
    await post('/api/folder', { path: 'Proj' });
    await post('/api/folder', { path: 'Proj/계획' });
    let i = 0;
    for (const [path, title] of Object.entries(files)) {
      const f = newFile();
      const { revision } = await post('/api/file', { ...f, path, title });
      f.title = title;
      f.canvas.elements = [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }];
      // Each file written by its own named outside writer, so each shows in the agents list with its file.
      const res = await fetch(`${base}/api/file?path=${encodeURIComponent(path)}`, { method: 'PUT', headers: { ...h, 'x-drawing-session': `Writer${i++}` }, body: JSON.stringify({ ...f, revision }) });
      assert.equal(res.status, 200);
    }
    const want = Object.keys(files).length;
    const agentFiles = async () => (await (await fetch(`${base}/api/workspace/agents`)).json()).agents.map((a) => a.file).sort();
    const listed = await waitFor(agentFiles, (l) => l.length >= want);
    assert.deepEqual(listed, Object.keys(files).sort());
    const titles = titlesOf(await (await fetch(`${base}/api/workspace/projects`)).json());
    for (const file of listed) assert.equal(titles.get(file), files[file], file);
  } finally {
    await app.close();
    await rm(ws, { recursive: true, force: true });
  }
});
