import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readCmap, readWoff, subsetTables, writeWoff } from '../../web/src/fonts/sfnt.ts';
import { glyphsToEmbed } from '../../web/src/fonts/embedText.ts';
import { renderDiagram } from '../../shared/render/index.ts';

const pkg = dirname(createRequire(import.meta.url).resolve('pretendard/package.json'));
const chunk = (style: string, i: number) => new Uint8Array(readFileSync(join(pkg, `dist/web/static/woff-dynamic-subset/Pretendard-${style}.subset.${i}.woff`)));
// The package stylesheet the browser module reads to find the file holding a character.
const css = readFileSync(join(pkg, 'dist/web/static/Pretendard-Regular.css'), 'utf8');
function chunkOf(c: number): number {
  for (const m of css.matchAll(/subset\.(\d+)\.woff2[^}]*?unicode-range:([^;]+);/g)) {
    for (const r of m[2].split(',')) {
      const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
      if (c >= parseInt(a, 16) && c <= parseInt(b ?? a, 16)) return Number(m[1]);
    }
  }
  return -1;
}

function names(name: Uint8Array): Map<number, string> {
  const d = new DataView(name.buffer, name.byteOffset, name.byteLength);
  const out = new Map<number, string>();
  const strings = d.getUint16(4);
  for (let i = 0; i < d.getUint16(2); i++) {
    const at = 6 + i * 12;
    const len = d.getUint16(at + 8);
    const off = strings + d.getUint16(at + 10);
    let s = '';
    for (let k = 0; k < len; k += 2) s += String.fromCharCode(d.getUint16(off + k));
    out.set(d.getUint16(at + 6), s);
  }
  return out;
}

test('glyphsToEmbed: characters outside Drawing Sans, by weight, entities decoded (E504f)', () => {
  const svg =
    '<svg><style>@font-face{font-family:x}</style><text font-size="13"><tspan x="0">결제 API &#38; 서비스</tspan></text>' +
    '<text font-weight="600"><tspan>주문 → 완료 ok</tspan></text><text>plain – “Latin” é</text></svg>';
  const got = glyphsToEmbed(svg);
  assert.deepEqual([...(got.get(400) ?? [])].map((c) => String.fromCodePoint(c)).sort(), [...'결제서비스'].sort());
  // The arrow is in Drawing Sans; spaces, Latin and Latin-1 never need a Pretendard face.
  assert.deepEqual([...(got.get(600) ?? [])].map((c) => String.fromCodePoint(c)).sort(), [...'주문완료'].sort());
  assert.equal(glyphsToEmbed('<svg><text>only Latin → ok</text></svg>').size, 0);
});

test('a Pretendard file cut to the used glyphs keeps only them, renamed Drawing Sans with its OFL records (E504f)', async () => {
  const text = '한글';
  const k = chunkOf(text.codePointAt(0)!);
  assert.ok(k >= 0);
  const source = chunk('Regular', k);
  const tables = await readWoff(source);
  const cmap = readCmap(tables.get('cmap')!);
  assert.ok(cmap.size > 50, 'the source file maps many characters');
  const want = [...text].map((c) => c.codePointAt(0)!).filter((c) => cmap.has(c));
  assert.ok(want.length >= 1);
  const { tables: cut, covered } = subsetTables(tables, [...want, 0x41 /* not in this file */], 'Drawing Sans', 'Regular');
  assert.deepEqual(covered, want.sort((a, b) => a - b));
  const woff = await writeWoff(cut);
  assert.ok(woff.length < source.length / 4, `${woff.length} bytes from ${source.length}`);

  const back = await readWoff(woff);
  assert.deepEqual([...readCmap(back.get('cmap')!).keys()].sort(), covered);
  for (const tag of ['GSUB', 'GPOS', 'GDEF', 'DSIG']) assert.ok(!back.has(tag), tag);
  // Glyph ids are kept: same count, unused glyphs empty, used ones byte-identical.
  const numGlyphs = (t: Map<string, Uint8Array>) => new DataView(t.get('maxp')!.buffer, t.get('maxp')!.byteOffset).getUint16(4);
  assert.equal(numGlyphs(back), numGlyphs(tables));
  assert.ok(back.get('glyf')!.length < tables.get('glyf')!.length / 4);
  // A modified OFL font may not carry the Reserved Font Name; the copyright and licence records travel with it.
  const n = names(back.get('name')!);
  assert.equal(n.get(1), 'Drawing Sans');
  for (const id of [1, 3, 4, 6]) assert.doesNotMatch(n.get(id) ?? '', /Pretendard/, `name ${id}`);
  assert.match(n.get(0) ?? '', /Copyright/);
  assert.match(n.get(13) ?? '', /SIL Open Font License/);
  assert.ok(n.get(14));
  // The sfnt checksum adjustment makes the whole font sum to 0xB1B0AFBA.
  const head = new DataView(back.get('head')!.buffer, back.get('head')!.byteOffset);
  assert.notEqual(head.getUint32(8), 0);
  assert.equal(head.getInt16(50), 1, 'long loca');
});

test('the same file split holds for the bold weight the renderer embeds (E504f)', async () => {
  const c = '서'.codePointAt(0)!;
  const k = chunkOf(c);
  const bold = readCmap((await readWoff(chunk('SemiBold', k))).get('cmap')!);
  assert.ok(bold.has(c));
});

test('a rendered diagram names the characters to embed; Node pictures carry no Pretendard bytes (E504f)', async () => {
  const { svg } = await renderDiagram('주문 > 결제: 확인', { type: 'flowchart' });
  const need = glyphsToEmbed(svg);
  assert.ok([...(need.get(400) ?? need.get(600) ?? [])].includes('주'.codePointAt(0)!));
  assert.doesNotMatch(svg, /font\/woff;/);
});
