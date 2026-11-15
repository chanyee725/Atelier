import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { KO_HINTS, patchKoHints } from '../../web/src/canvas/koHints.ts';

const dist = (kind: string) => new URL(`../../node_modules/@excalidraw/excalidraw/dist/${kind}/locales/`, import.meta.url);
const koChunk = (kind: string) => {
  const hits = readdirSync(dist(kind))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(f, dist(kind)), 'utf8'))
    .filter((code) => patchKoHints(code) !== null);
  return hits;
};
/** Latin letters left once key names and placeholders are removed: a hint must not carry other English words. */
const english = (s: string) =>
  s.replace(/\{\{\w+\}\}|CtrlOrCmd|Ctrl|Alt|Shift|Enter|Esc|Delete|about:config|dom\.events\.asyncClipboard\.clipboardItem|true/g, '').match(/[A-Za-z]{2,}/g);

test('every hint is Korean apart from key names', () => {
  for (const [k, v] of Object.entries(KO_HINTS)) assert.equal(english(v), null, `${k}: ${v}`);
});

test('every hint Excalidraw can show is covered (the English locale has no extra hint)', () => {
  const dev = readFileSync(new URL('../../node_modules/@excalidraw/excalidraw/dist/dev/index.js', import.meta.url), 'utf8');
  const used = new Set([...dev.matchAll(/t\("hints\.(\w+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 15);
  for (const k of used) assert.ok(k in KO_HINTS, `hint ${k} has no Korean text`);
});

for (const kind of ['prod', 'dev']) {
  test(`the ${kind} ko-KR locale gets the Korean hints and nothing else changes`, () => {
    const chunks = koChunk(kind);
    assert.equal(chunks.length, 1, 'exactly one chunk is the ko-KR locale');
    const out = patchKoHints(chunks[0])!;
    assert.ok(out.includes(JSON.stringify(KO_HINTS)));
    assert.ok(out.includes('arrowTool') && out.includes('dismissSearch'));
    assert.ok(!out.includes('\\uAF2D\\uC9D3\\uC810\\uC744 \\uC218\\uC815'), 'old formal hint is gone');
    assert.equal(patchKoHints(out), null, 'an already patched chunk is not patched again');
    new Function(out.replace(/^\s*import\s*["'][^"']*["'];?/gm, '').replace(/\bexport\s*\{[^}]*\};?/g, '').replace(/\bexport\s+default\s+\w+;?/g, ''));
  });
}

test('other locales are left alone', () => {
  const ja = readdirSync(dist('prod')).find((f) => f.startsWith('ja-JP'))!;
  assert.equal(patchKoHints(readFileSync(new URL(ja, dist('prod')), 'utf8')), null);
});
