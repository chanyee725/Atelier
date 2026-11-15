// Pretendard for the characters the bundled Drawing Sans (Latin) lacks, embedded in a diagram picture. A picture drawn
// as an <img> (canvas block, previews, SVG/PNG export) cannot see the page's Pretendard, so it carries its own faces,
// cut down to the glyphs it uses. Source: the static WOFF 1.0 dynamic-subset files of the `pretendard` npm package
// (OFL-1.1, already a dependency), served as local build assets and fetched only when a picture needs them. The
// subset is renamed "Drawing Sans" (Pretendard is a Reserved Font Name); its copyright and licence records are kept.
import { readWoff, subsetTables, writeWoff, type Tables } from './sfnt.ts';
import { CLEAN_FONT_NAME } from '../../../shared/render/text.ts';
import { glyphsToEmbed } from './embedText.ts';
import css from 'pretendard/dist/web/static/Pretendard-Regular.css?raw';

const FILES = import.meta.glob<string>('../../../node_modules/pretendard/dist/web/static/woff-dynamic-subset/Pretendard-{Regular,SemiBold}.subset.*.woff', {
  query: '?url',
  import: 'default',
  eager: true,
});
const STYLE = { 400: 'Regular', 600: 'SemiBold' } as const;
type Weight = keyof typeof STYLE;

const urlOf = (weight: Weight, chunk: number) =>
  Object.entries(FILES).find(([path]) => path.endsWith(`/Pretendard-${STYLE[weight]}.subset.${chunk}.woff`))?.[1];

// [first, last, chunk] per unicode-range entry of the package's stylesheet (the same split for every weight).
let ranges: [number, number, number][] | null = null;
function chunkOf(c: number): number | undefined {
  if (!ranges) {
    ranges = [];
    for (const m of css.matchAll(/subset\.(\d+)\.woff2[^}]*?unicode-range:([^;]+);/g)) {
      for (const r of m[2].split(',')) {
        const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
        ranges.push([parseInt(a, 16), parseInt(b ?? a, 16), Number(m[1])]);
      }
    }
  }
  return ranges.find(([a, b]) => c >= a && c <= b)?.[2];
}

const fonts = new Map<string, Promise<Tables>>();
function tablesOf(url: string): Promise<Tables> {
  let p = fonts.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => readWoff(new Uint8Array(b)));
    // A failed fetch is tried again next time instead of being remembered.
    p.catch(() => fonts.delete(url));
    fonts.set(url, p);
  }
  return p;
}

const base64 = (b: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
};
const hex = (c: number) => c.toString(16);

/** `@font-face` rules for the Pretendard glyphs these characters need, one per source file and weight. */
async function facesFor(weight: Weight, chars: Set<number>): Promise<string[]> {
  const byChunk = new Map<number, number[]>();
  for (const c of chars) {
    const k = chunkOf(c);
    if (k !== undefined) byChunk.set(k, [...(byChunk.get(k) ?? []), c]);
  }
  const faces = await Promise.all(
    [...byChunk].map(async ([k, cs]) => {
      const url = urlOf(weight, k);
      if (!url) return '';
      const { tables, covered } = subsetTables(await tablesOf(url), cs, CLEAN_FONT_NAME, STYLE[weight]);
      if (!covered.length) return '';
      const woff = await writeWoff(tables);
      // unicode-range keeps the face to the glyphs it has, so the Latin face of the same family still draws the rest.
      return `@font-face{font-family:'${CLEAN_FONT_NAME}';font-weight:${weight};src:url(data:font/woff;base64,${base64(woff)}) format('woff');unicode-range:${covered.map((c) => `U+${hex(c)}`).join(',')}}`;
    }),
  );
  return faces.filter(Boolean);
}

/**
 * The picture with Pretendard faces for its Hangul (and other characters outside Drawing Sans) embedded after its
 * own faces. Returns the picture unchanged when it needs none or a font cannot be loaded (the system font draws them).
 */
export async function withHangulFaces(svg: string): Promise<string> {
  const need = glyphsToEmbed(svg);
  if (!need.size) return svg;
  try {
    const faces = (await Promise.all([...need].map(([w, cs]) => facesFor(w, cs)))).flat().join('');
    if (!faces) return svg;
    // Later rules are tried first for a character both cover, so these go after the Latin faces.
    if (svg.includes('</style>')) return svg.replace('</style>', `${faces}</style>`);
    return svg.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${faces}</style>`);
  } catch {
    return svg;
  }
}
