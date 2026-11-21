// File format: block layouts, frames and codeRefs, format versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withApp, q } from './helpers/workspace-app.mjs';

test('block layout: valid layouts round-trip, unknown fields are dropped, bad ones get 400', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'architecture', code: 'A > B', x: 0, y: 0, w: 10, h: 10 };
    const layout = {
      v: 1,
      basis: { type: 'architecture', direction: 'right', count: 2 },
      items: { A: { cx: 1.5, cy: -2, parent: '' }, B: { cx: 3, cy: 4, parent: 'VPC' } },
    };
    const put = (b, revision) => call('PUT', `/api/file?path=${q('a')}`, { revision, blocks: [b] });
    let r = await put({ ...blk, layout: { ...layout, junk: 1, items: { ...layout.items, A: { ...layout.items.A, extra: 1 } } } }, 1);
    assert.equal(r.status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    // no layout stays absent
    r = await put(blk, 2);
    assert.equal('layout' in (await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0], false);
    const bad = [
      null, 'x', [], {}, { v: 0 }, { v: 1.5 }, { v: 1, items: [] },
      { v: 1, items: { A: { cx: 'x', cy: 0, parent: '' } } },
      { v: 1, items: { A: { cx: 0, cy: null, parent: '' } } },
      { v: 1, items: { A: { cx: 0, cy: 0 } } },
      { v: 1, items: { '': { cx: 0, cy: 0, parent: '' } } },
      { v: 1, items: { ['k'.repeat(201)]: { cx: 0, cy: 0, parent: '' } } },
      { v: 1, basis: { type: 'a', direction: 'right', count: -1 } },
      { v: 1, basis: { type: 'a', count: 1 } },
      JSON.parse('{"v":1,"items":{"__proto__":{"cx":0,"cy":0,"parent":""}}}'),
      { v: 1, items: { A: { cx: 0, cy: 0, parent: 'p'.repeat(201) } } },
      { v: 1, basis: { type: 't'.repeat(201), direction: 'right', count: 1 } },
      { v: 1, basis: { type: 'a', direction: 'd'.repeat(201), count: 1 } },
    ];
    let rev = 3;
    for (const l of bad) {
      assert.equal((await put({ ...blk, layout: l }, rev)).status, 400, JSON.stringify(l));
    }
    const many = {};
    for (let i = 0; i < 2001; i++) many[`n${i}`] = { cx: 0, cy: 0, parent: '' };
    assert.equal((await put({ ...blk, layout: { v: 1, items: many } }, rev)).status, 400);
  });
});

test('block frameId: a block keeps the frame it sits in; bad values get 400, or are dropped on read (#83)', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'flowchart', code: 'A > B', x: 0, y: 0, w: 10, h: 10 };
    const put = (b, revision) => call('PUT', `/api/file?path=${q('a')}`, { revision, blocks: [b] });
    assert.equal((await put({ ...blk, frameId: 'frame_1' }, 1)).status, 200);
    assert.equal((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].frameId, 'frame_1');
    assert.equal((await put({ ...blk, frameId: null }, 2)).status, 200, 'null means no frame');
    assert.equal('frameId' in (await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0], false);
    for (const bad of ['', 3, {}, 'x'.repeat(201)]) assert.equal((await put({ ...blk, frameId: bad }, 3)).status, 400, JSON.stringify(bad));
  });
  const { normalizeContent } = await import('../server/workspace/model.js');
  const read = normalizeContent({ blocks: [{ id: 'b', type: 't', code: '', x: 0, y: 0, w: 1, h: 1, frameId: 7 }] }, { lenient: true });
  assert.equal('frameId' in read.blocks[0], false, 'a hand-edited bad frame only loses the frame');
});

test('block layout: 200-character names are the limit and a "__proto__" key is refused by name', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'architecture', code: 'A', x: 0, y: 0, w: 10, h: 10 };
    const n = 'n'.repeat(200);
    const layout = { v: 1, basis: { type: 't'.repeat(200), direction: 'd'.repeat(200), count: 1 }, items: { [n]: { cx: 0, cy: 0, parent: 'p'.repeat(200) } } };
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 1, blocks: [{ ...blk, layout }] })).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    const proto = JSON.parse('{"v":1,"items":{"__proto__":{"cx":0,"cy":0,"parent":""}}}');
    const r = await call('PUT', `/api/file?path=${q('a')}`, { revision: 2, blocks: [{ ...blk, layout: proto }] });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /__proto__/);
  });
});

test('block layout: a layout with a newer sub-format version is kept verbatim', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const layout = { v: 2, items: { A: { x: 1 } }, shape: ['new'] };
    const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1, layout };
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 1, blocks: [blk] })).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].layout, layout);
    assert.equal((await call('PUT', `/api/file?path=${q('a')}`, { revision: 2, blocks: [{ ...blk, layout: { v: 2.5 } }] })).status, 400);
  });
});

test('a stored file with a broken layout still reads; only that layout is dropped', async () => {
  const { parseStored } = await import('../server/workspace/model.js');
  const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1 };
  const text = JSON.stringify({ version: 3, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 2,
    blocks: [{ ...blk, layout: { v: 1, items: { A: { cx: 'oops' } } } }, { ...blk, id: 'b2', layout: { v: 1, items: { B: { cx: 1, cy: 2, parent: '' } } } }] });
  const f = parseStored(text);
  assert.equal('layout' in f.blocks[0], false);
  assert.deepEqual(f.blocks[1].layout, { v: 1, items: { B: { cx: 1, cy: 2, parent: '' } } });
});

test('block codeRefs: valid refs round-trip, unknown fields are dropped, bad ones get 400, bad stored refs are dropped on read', async () => {
  await withApp(async ({ ws, call }) => {
    await call('POST', '/api/file', { path: 'a' });
    const blk = { id: 'b1', type: 'architecture', code: 'A', x: 0, y: 0, w: 10, h: 10 };
    const codeRefs = { v: 1, nodes: { A: { summary: 's', refs: [{ path: 'src/a.py', start: 3, end: 9, symbol: 'f', note: 'n' }] } } };
    const put = (b, revision) => call('PUT', `/api/file?path=${q('a')}`, { revision, blocks: [b] });
    let r = await put({ ...blk, codeRefs: { ...codeRefs, junk: 1, nodes: { A: { ...codeRefs.nodes.A, x: 1 } } } }, 1);
    assert.equal(r.status, 200);
    const got = (await call('GET', `/api/file?path=${q('a')}`)).body;
    assert.deepEqual(got.blocks[0].codeRefs, codeRefs);
    assert.equal(got.version, 6);
    for (const bad of [null, 'x', { v: 0 }, { v: 1, nodes: { A: { refs: [{ path: '../x', start: 1 }] } } }, { v: 1, nodes: { A: { refs: [{ path: 'x', start: 0 }] } } }]) {
      assert.equal((await put({ ...blk, codeRefs: bad }, 2)).status, 400, JSON.stringify(bad));
    }
    // refs whose node name is not in the code are stored as they are (renaming must not lose data)
    const orphan = { v: 1, nodes: { A: { refs: [{ path: 'a.py', start: 1 }] }, Renamed: { refs: [{ path: 'b.py', start: 1 }] } } };
    assert.equal((await put({ ...blk, codeRefs: orphan }, 2)).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].codeRefs, orphan);
    // a newer sub-format is kept verbatim
    const future = { v: 2, whatever: [1] };
    assert.equal((await put({ ...blk, codeRefs: future }, 3)).status, 200);
    assert.deepEqual((await call('GET', `/api/file?path=${q('a')}`)).body.blocks[0].codeRefs, future);
    // hand-edited file with broken refs still reads, refs dropped
    const { parseStored } = await import('../server/workspace/model.js');
    const f = parseStored(JSON.stringify({ version: 5, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 1, blocks: [{ ...blk, codeRefs: { v: 1, nodes: { A: { refs: 'oops' } } } }] }));
    assert.equal('codeRefs' in f.blocks[0], false);
    // refs stored before #469 (empty symbol, path '.') do not take the good refs with them
    const mixed = [{ path: 'a.py', start: 1, symbol: '' }, { path: '.', start: 2 }, { path: 'b.py', start: 3, symbol: 'g' }, { path: '../x', start: 1 }];
    const g = parseStored(JSON.stringify({ version: 5, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 1, blocks: [{ ...blk, codeRefs: { v: 1, nodes: { A: { summary: 's', refs: mixed } } } }] }));
    assert.deepEqual(g.blocks[0].codeRefs, { v: 1, nodes: { A: { summary: 's', refs: [{ path: 'a.py', start: 1 }, { path: 'b.py', start: 3, symbol: 'g' }] } } });
    // a save stays strict
    assert.equal((await put({ ...blk, codeRefs: { v: 1, nodes: { A: { refs: mixed } } } }, 4)).status, 400);
    void ws;
  });
});

test('a v2 file reads as is and its next save is stored as the current version with a layout', async () => {
  const { parseStored, normalizeContent, FORMAT_VERSION } = await import('../server/workspace/model.js');
  const blk = { id: 'b1', type: 'flowchart', code: 'a', x: 0, y: 0, w: 1, h: 1 };
  const v2 = JSON.stringify({ version: 2, title: 't', document: { type: 'doc', content: [] }, canvas: {}, revision: 4, blocks: [blk] });
  const f = parseStored(v2);
  assert.equal(f.version, 2);
  assert.equal('layout' in f.blocks[0], false);
  const layout = { v: 1, basis: { type: 'flowchart', direction: 'right', count: 1 }, items: { a: { cx: 1, cy: 2, parent: '' } } };
  const saved = normalizeContent({ ...f, blocks: [{ ...f.blocks[0], layout }] });
  assert.equal(saved.version, FORMAT_VERSION);
  assert.equal(saved.version, 6);
  assert.deepEqual(saved.blocks[0].layout, layout);
});

test('a file reads back with the version it was written with; a write stores the current one', async () => {
  const { parseStored, normalizeContent, FORMAT_VERSION } = await import('../server/workspace/model.js');
  const old = JSON.stringify({ version: 1, title: 'old', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 3 });
  assert.equal(parseStored(old).version, 1);
  assert.equal(parseStored(JSON.stringify({ title: 'x', revision: 1 })).version, 1);
  assert.equal(normalizeContent({ version: 1 }).version, FORMAT_VERSION);
  assert.equal(FORMAT_VERSION, 6);
});

test('a file written with a newer format version is not overwritten as ours', async () => {
  await withApp(async ({ ws, call }) => {
    const text = JSON.stringify({ version: 7, title: 'future', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: 1, extra: 'keep' });
    await writeFile(join(ws, 'f.dpx.json'), text);
    const r = await call('GET', `/api/file?path=${q('f')}`);
    assert.equal(r.body.version, 7);
    const w = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: r.body.revision });
    assert.equal(w.status, 422);
    assert.match(w.body.error ?? JSON.stringify(w.body), /더 새 버전에서 만든 파일이라 저장하지 않았어요/);
    assert.equal(await readFile(join(ws, 'f.dpx.json'), 'utf8'), text);
  });
});

test('reading a newer-format file after an outside edit leaves it untouched, and saving is still refused', async () => {
  await withApp(async ({ ws, call }) => {
    const file = join(ws, 'f.dpx.json');
    // The server knows this file (created here) before the newer app replaces it on disk.
    const made = await call('POST', '/api/file', { path: 'f' });
    assert.equal(made.status, 201);
    const base = { version: 7, title: 'future', document: { type: 'doc', content: [] }, canvas: {}, blocks: [], revision: made.body.revision };
    await writeFile(file, JSON.stringify(base));
    // Outside edit that keeps the revision: a v2 file would get its revision raised on disk here.
    const edited = JSON.stringify({ ...base, title: 'edited outside', extra: 'keep' });
    await writeFile(file, edited);
    const again = await call('GET', `/api/file?path=${q('f')}`);
    assert.equal(again.body.title, 'edited outside');
    assert.equal(await readFile(file, 'utf8'), edited);
    const w = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: again.body.revision });
    assert.equal(w.status, 422);
    const stale = await call('PUT', `/api/file?path=${q('f')}`, { title: 'x', revision: 99 });
    assert.equal(stale.status, 422);
    assert.equal(await readFile(file, 'utf8'), edited);
  });
});
