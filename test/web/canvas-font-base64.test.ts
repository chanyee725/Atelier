import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { patchFontBase64 } from '../../web/src/canvas/fontBase64.ts';

const distDir = (kind: string) => new URL(`../../node_modules/@excalidraw/excalidraw/dist/${kind}/`, import.meta.url);
/** The chunks of one Excalidraw build that the rewrite changes. */
const patched = (kind: string) =>
  readdirSync(distDir(kind))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, code: readFileSync(new URL(f, distDir(kind)), 'utf8') }))
    .map(({ f, code }) => ({ f, code, out: patchFontBase64(code) }))
    .filter((c) => c.out !== null);

/** Runs Excalidraw's `toBase64` from a rewritten chunk on `bytes`, as a browser would (no Buffer). */
async function runToBase64(chunk: string, bytes: Uint8Array): Promise<string> {
  const start = chunk.search(/(?:var\s+toBase64\s*=|[\w$]+=)\s*async\s*\(?\s*[\w$]+\s*\)?\s*=>\s*\{\s*let\s+[\w$]+;\s*if\s*\(typeof Buffer/);
  assert.ok(start >= 0, 'toBase64 found');
  const end = chunk.indexOf('`data:font/woff2;base64,', start);
  const close = chunk.indexOf('}', chunk.indexOf('`', end + 1));
  const src = chunk.slice(start, close + 1).replace(/^var\s+/, '').replace(/^([\w$]+)\s*=/, 'return ');
  // Shadow Buffer so the browser branch runs.
  const fn = new Function('Buffer', 'btoa', src) as (b: undefined, a: typeof btoa) => (x: ArrayBuffer) => Promise<string>;
  return fn(undefined, btoa)(bytes.buffer as ArrayBuffer);
}

for (const kind of ['prod', 'dev']) {
  test(`the ${kind} bundle of Excalidraw inlines a large font without overflowing the stack`, async () => {
    const hits = patched(kind);
    assert.equal(hits.length, 1, 'exactly one chunk builds the font data URL');
    const [{ code, out }] = hits;
    assert.ok(out);
    assert.doesNotMatch(out, /fromCharCode\(\s*\.\.\./);
    // 1 MB: past any engine's argument limit, and past the 400 KB font cap.
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const url = await runToBase64(out, bytes);
    assert.equal(url, `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`);
    await assert.rejects(runToBase64(code, bytes), RangeError, 'the stock code overflows on the same bytes');
  });
}

test('code without the font data URL is left alone, and a moved spread fails the build', () => {
  assert.equal(patchFontBase64('String.fromCharCode(...new Uint8Array(x))'), null);
  assert.throws(() => patchFontBase64('`data:font/woff2;base64,${btoa(s)}`'), /found 0 times/);
});
