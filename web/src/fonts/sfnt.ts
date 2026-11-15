// A small TrueType (glyf/loca) subsetter for WOFF 1.0 input, so a diagram picture can carry only the glyphs it uses.
// No dependencies: WOFF 1.0 tables are zlib streams, which the platform's DecompressionStream('deflate') reads.
// Glyph ids are kept (unused glyphs become empty), so composite glyphs and hmtx need no remapping. Layout tables
// (GSUB/GPOS/GDEF) are dropped: Hangul syllables are precomposed and the Latin face kerns Latin text.

export type Tables = Map<string, Uint8Array>;
type Pipe = (bytes: Uint8Array) => Promise<Uint8Array>;

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const inflate: Pipe = (b) => through(b, new DecompressionStream('deflate'));
const deflate: Pipe = (b) => through(b, new CompressionStream('deflate'));

const tagOf = (d: DataView, at: number) => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The tables of a WOFF 1.0 font, decompressed. */
export async function readWoff(bytes: Uint8Array): Promise<Tables> {
  const d = view(bytes);
  if (tagOf(d, 0) !== 'wOFF') throw new Error('not a WOFF 1.0 font');
  const flavor = d.getUint32(4);
  if (flavor !== 0x00010000) throw new Error('not a TrueType-flavoured font');
  const tables: Tables = new Map();
  const n = d.getUint16(12);
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const at = 44 + i * 20;
      const offset = d.getUint32(at + 4);
      const compLength = d.getUint32(at + 8);
      const origLength = d.getUint32(at + 12);
      const raw = bytes.subarray(offset, offset + compLength);
      tables.set(tagOf(d, at), compLength < origLength ? await inflate(raw) : raw.slice());
    }),
  );
  return tables;
}

/** Code point → glyph id, from the Windows Unicode cmap subtable (format 4 or 12). */
export function readCmap(cmap: Uint8Array): Map<number, number> {
  const d = view(cmap);
  const map = new Map<number, number>();
  const count = d.getUint16(2);
  let best = -1;
  let bestFormat = 0;
  for (let i = 0; i < count; i++) {
    const platform = d.getUint16(4 + i * 8);
    const encoding = d.getUint16(6 + i * 8);
    const off = d.getUint32(8 + i * 8);
    const format = d.getUint16(off);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      if ((format === 12 && bestFormat !== 12) || (format === 4 && !bestFormat)) {
        best = off;
        bestFormat = format;
      }
    }
  }
  if (best < 0) return map;
  if (bestFormat === 12) {
    const groups = d.getUint32(best + 12);
    for (let g = 0; g < groups; g++) {
      const at = best + 16 + g * 12;
      const start = d.getUint32(at);
      const end = d.getUint32(at + 4);
      const gid = d.getUint32(at + 8);
      for (let c = start; c <= end; c++) map.set(c, gid + c - start);
    }
    return map;
  }
  const segX2 = d.getUint16(best + 6);
  const ends = best + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const end = d.getUint16(ends + s);
    const start = d.getUint16(starts + s);
    const delta = d.getUint16(deltas + s);
    const range = d.getUint16(ranges + s);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid: number;
      if (range === 0) gid = (c + delta) & 0xffff;
      else {
        const g = d.getUint16(ranges + s + range + (c - start) * 2);
        gid = g === 0 ? 0 : (g + delta) & 0xffff;
      }
      if (gid) map.set(c, gid);
    }
  }
  return map;
}

/** Glyph offsets from loca (short or long, per head.indexToLocFormat). */
function readLoca(t: Tables): number[] {
  const long = view(t.get('head')!).getInt16(50) === 1;
  const numGlyphs = view(t.get('maxp')!).getUint16(4);
  const d = view(t.get('loca')!);
  return Array.from({ length: numGlyphs + 1 }, (_, i) => (long ? d.getUint32(i * 4) : d.getUint16(i * 2) * 2));
}

/** Component glyph ids of a composite glyph (empty for a simple one). */
function components(glyph: Uint8Array): number[] {
  if (glyph.length < 10) return [];
  const d = view(glyph);
  if (d.getInt16(0) >= 0) return [];
  const out: number[] = [];
  let at = 10;
  for (;;) {
    const flags = d.getUint16(at);
    out.push(d.getUint16(at + 2));
    at += 4 + (flags & 0x1 ? 4 : 2) + (flags & 0x8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
    if (!(flags & 0x20)) return out;
  }
}

function cmap4(pairs: [number, number][]): Uint8Array {
  // One segment per code point plus the 0xFFFF terminator: a picture uses at most a few hundred characters.
  const segs = [...pairs.map(([c, g]) => [c, c, (g - c) & 0xffff]), [0xffff, 0xffff, 1]];
  const segX2 = segs.length * 2;
  const len = 16 + segs.length * 8;
  const sub = new DataView(new ArrayBuffer(len));
  const log = Math.floor(Math.log2(segs.length));
  sub.setUint16(0, 4);
  sub.setUint16(2, len);
  sub.setUint16(6, segX2);
  sub.setUint16(8, 2 ** (log + 1));
  sub.setUint16(10, log);
  sub.setUint16(12, segX2 - 2 ** (log + 1));
  segs.forEach(([start, end, delta], i) => {
    sub.setUint16(14 + i * 2, end);
    sub.setUint16(16 + segX2 + i * 2, start);
    sub.setUint16(16 + segX2 * 2 + i * 2, delta);
  });
  const head = new DataView(new ArrayBuffer(12));
  head.setUint16(2, 1);
  head.setUint16(4, 3);
  head.setUint16(6, 1);
  head.setUint32(8, 12);
  return concat([new Uint8Array(head.buffer), new Uint8Array(sub.buffer)]);
}

/**
 * A name table for the subset: the copyright and licence records (IDs 0, 13, 14) are kept, as the OFL requires; the
 * font name records carry `family`, because a modified font may not use the source's Reserved Font Name.
 */
function nameTable(source: Uint8Array | undefined, family: string, style: string): Uint8Array {
  const kept: [number, Uint8Array][] = [];
  if (source) {
    const d = view(source);
    const count = d.getUint16(2);
    const strings = d.getUint16(4);
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 12;
      const id = d.getUint16(at + 6);
      if (d.getUint16(at) === 3 && d.getUint16(at + 2) === 1 && d.getUint16(at + 4) === 0x409 && (id === 0 || id === 13 || id === 14)) {
        const off = strings + d.getUint16(at + 10);
        kept.push([id, source.slice(off, off + d.getUint16(at + 8))]);
      }
    }
  }
  const utf16 = (s: string) => {
    const b = new DataView(new ArrayBuffer(s.length * 2));
    for (let i = 0; i < s.length; i++) b.setUint16(i * 2, s.charCodeAt(i));
    return new Uint8Array(b.buffer);
  };
  const full = `${family} ${style}`;
  const records: [number, Uint8Array][] = [
    ...kept,
    [1, utf16(family)],
    [2, utf16(style)],
    [3, utf16(`${full} (subset)`)],
    [4, utf16(full)],
    [6, utf16(full.replace(/\s/g, ''))],
  ].sort((a, b) => (a[0] as number) - (b[0] as number)) as [number, Uint8Array][];
  const head = new DataView(new ArrayBuffer(6 + records.length * 12));
  head.setUint16(2, records.length);
  head.setUint16(4, 6 + records.length * 12);
  let off = 0;
  records.forEach(([id, s], i) => {
    const at = 6 + i * 12;
    head.setUint16(at, 3);
    head.setUint16(at + 2, 1);
    head.setUint16(at + 4, 0x409);
    head.setUint16(at + 6, id);
    head.setUint16(at + 8, s.length);
    head.setUint16(at + 10, off);
    off += s.length;
  });
  return concat([new Uint8Array(head.buffer), ...records.map((r) => r[1])]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

function checksum(b: Uint8Array): number {
  const padded = b.length % 4 ? concat([b, new Uint8Array(4 - (b.length % 4))]) : b;
  const d = view(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + d.getUint32(i)) >>> 0;
  return sum;
}

/**
 * The font cut down to `codePoints` (those it maps; the rest are left out) and renamed to `family`. Returns the new
 * tables and the code points it covers.
 */
export function subsetTables(t: Tables, codePoints: Iterable<number>, family: string, style: string): { tables: Tables; covered: number[] } {
  const cmap = readCmap(t.get('cmap')!);
  const pairs: [number, number][] = [];
  for (const c of new Set(codePoints)) {
    const g = cmap.get(c);
    if (g && c <= 0xffff) pairs.push([c, g]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const loca = readLoca(t);
  const glyf = t.get('glyf')!;
  const glyph = (g: number) => glyf.subarray(loca[g], loca[g + 1]);
  const keep = new Set<number>([0]);
  const todo = pairs.map((p) => p[1]);
  while (todo.length) {
    const g = todo.pop()!;
    if (keep.has(g) || g >= loca.length - 1) continue;
    keep.add(g);
    todo.push(...components(glyph(g)));
  }
  for (const g of [...keep]) for (const c of components(glyph(g))) keep.add(c);
  const parts: Uint8Array[] = [];
  const newLoca = new DataView(new ArrayBuffer(loca.length * 4));
  let at = 0;
  for (let g = 0; g < loca.length - 1; g++) {
    newLoca.setUint32(g * 4, at);
    if (!keep.has(g)) continue;
    const data = glyph(g);
    const padded = new Uint8Array(pad4(data.length));
    padded.set(data);
    parts.push(padded);
    at += padded.length;
  }
  newLoca.setUint32((loca.length - 1) * 4, at);
  const head = t.get('head')!.slice();
  view(head).setInt16(50, 1);
  view(head).setUint32(8, 0);
  const post = t.get('post')!.slice(0, 32);
  view(post).setUint32(0, 0x00030000);
  const tables: Tables = new Map([
    ['OS/2', t.get('OS/2')!],
    ['cmap', cmap4(pairs)],
    ['glyf', concat(parts)],
    ['head', head],
    ['hhea', t.get('hhea')!],
    ['hmtx', t.get('hmtx')!],
    ['loca', new Uint8Array(newLoca.buffer)],
    ['maxp', t.get('maxp')!],
    ['name', nameTable(t.get('name'), family, style)],
    ['post', post],
  ]);
  return { tables, covered: pairs.map((p) => p[0]) };
}

/** The tables as a WOFF 1.0 font, each table zlib-compressed when that makes it smaller. */
export async function writeWoff(tables: Tables): Promise<Uint8Array> {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  // The sfnt checksum adjustment covers the uncompressed font as it would be laid out.
  const sfntSize = 12 + n * 16 + tags.reduce((s, tag) => s + pad4(tables.get(tag)!.length), 0);
  const sums = tags.map((tag) => checksum(tables.get(tag)!));
  const dirSum = (() => {
    const dir = new DataView(new ArrayBuffer(12 + n * 16));
    dir.setUint32(0, 0x00010000);
    dir.setUint16(4, n);
    let off = 12 + n * 16;
    tags.forEach((tag, i) => {
      for (let k = 0; k < 4; k++) dir.setUint8(12 + i * 16 + k, tag.charCodeAt(k));
      dir.setUint32(12 + i * 16 + 4, sums[i]);
      dir.setUint32(12 + i * 16 + 8, off);
      dir.setUint32(12 + i * 16 + 12, tables.get(tag)!.length);
      off += pad4(tables.get(tag)!.length);
    });
    return checksum(new Uint8Array(dir.buffer));
  })();
  const total = sums.reduce((s, x) => (s + x) >>> 0, dirSum);
  const headAt = tags.indexOf('head');
  if (headAt >= 0) {
    const head = tables.get('head')!.slice();
    view(head).setUint32(8, (0xb1b0afba - total) >>> 0);
    tables = new Map(tables).set('head', head);
  }
  const bodies = await Promise.all(
    tags.map(async (tag) => {
      const raw = tables.get(tag)!;
      const z = await deflate(raw);
      return z.length < raw.length ? z : raw;
    }),
  );
  const header = new DataView(new ArrayBuffer(44 + n * 20));
  let off = 44 + n * 20;
  const chunks: Uint8Array[] = [];
  tags.forEach((tag, i) => {
    const at = 44 + i * 20;
    for (let k = 0; k < 4; k++) header.setUint8(at + k, tag.charCodeAt(k));
    header.setUint32(at + 4, off);
    header.setUint32(at + 8, bodies[i].length);
    header.setUint32(at + 12, tables.get(tag)!.length);
    header.setUint32(at + 16, sums[i]);
    const padded = new Uint8Array(pad4(bodies[i].length));
    padded.set(bodies[i]);
    chunks.push(padded);
    off += padded.length;
  });
  header.setUint32(0, 0x774f4646);
  header.setUint32(4, 0x00010000);
  header.setUint32(8, off);
  header.setUint16(12, n);
  header.setUint32(16, sfntSize);
  header.setUint16(20, 1);
  return concat([new Uint8Array(header.buffer), ...chunks]);
}
