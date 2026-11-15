// Which characters of a diagram picture need a Pretendard face embedded: those in its text that the bundled
// Drawing Sans (Latin subset, scripts/subset-clean-font.py) does not have, by font weight.

// Mirrors UNICODES in scripts/subset-clean-font.py.
const LATIN: [number, number][] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x2013, 0x2014], [0x2018, 0x2019], [0x201c, 0x201d], [0x2022, 0x2022], [0x2026, 0x2026],
  [0x20a9, 0x20a9], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2190, 0x2193], [0x2212, 0x2212],
];
const inLatin = (c: number) => LATIN.some(([a, b]) => c >= a && c <= b);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (NAMED[e] ?? m),
  );

/** Code points outside Drawing Sans per weight (400, or 600 for bold text) in the picture's <text> elements. */
export function glyphsToEmbed(svg: string): Map<400 | 600, Set<number>> {
  const out = new Map<400 | 600, Set<number>>();
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const w = Number(/\sfont-weight="(\d+)"/.exec(m[1])?.[1] ?? 400) >= 550 ? 600 : 400;
    for (const ch of decode(m[2])) {
      const c = ch.codePointAt(0)!;
      if (c < 0x20 || inLatin(c) || /\s/.test(ch)) continue;
      let set = out.get(w);
      if (!set) out.set(w, (set = new Set()));
      set.add(c);
    }
  }
  return out;
}
