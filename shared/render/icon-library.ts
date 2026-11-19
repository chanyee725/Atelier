// The bundled icon library (#734): name → file lookup over shared/render/icon-index.ts, and a cache of the
// icon files that have been loaded. Files live in web/icons/ and are served by the local server at
// /icons/<set>/<key>.svg; nothing is fetched from outside. The renderer is synchronous, so callers load the
// icons a scene needs first (`loadIcons`), then paint. Without a loader (Node, tests) nothing is loaded and
// icons fall back to the inline core set and generic glyphs.

import { ICON_ALIASES, ICON_FILES } from './icon-index.ts';

export type LibrarySet = keyof typeof ICON_FILES;

/** A loaded icon file. `mono`: one path on the 24 grid, painted by the renderer. `color`: full-colour artwork. */
export type IconArt =
  | { kind: 'fill'; d: string; hex: string }
  | { kind: 'stroke'; d: string }
  | { kind: 'color'; viewBox: string; attrs: string; body: string };

let names: Map<string, string> | null = null;

/** name → `<set>/<key>` for every bundled file and alias. Built on first use. */
export function iconNames(): ReadonlyMap<string, string> {
  if (names) return names;
  names = new Map();
  for (const [set, { prefix, keys }] of Object.entries(ICON_FILES)) {
    for (const key of keys.split(' ')) if (key) names.set(prefix + key, `${set}/${key}`);
  }
  for (const pair of ICON_ALIASES.split(' ')) {
    const i = pair.indexOf('=');
    if (i > 0 && !names.has(pair.slice(0, i))) names.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return names;
}

/** `Postgres DB` / `aws_ec2` → `postgres-db` / `aws-ec2`. */
export const normalizeIconName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/** File (`<set>/<key>`) for an icon name, or undefined when the library has no such name. */
export function iconFile(name: string): string | undefined {
  const n = normalizeIconName(name);
  return Object.hasOwn(Object.prototype, n) ? undefined : iconNames().get(n);
}

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/;
/** Elements a cleaned colour file may contain (scripts/import-icons.mjs writes only these). */
const COLOR_TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use']);

/** Read an icon file. Returns null for anything that is not in the shape the import script writes. */
export function parseIconFile(text: string): IconArt | null {
  const open = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([\d. -]+)" data-kind="(fill|stroke|color)"([^>]*)>/.exec(text);
  const end = text.lastIndexOf('</svg>');
  if (!open || end < 0) return null;
  const body = text.slice(open[0].length, end);
  const kind = open[2];
  if (kind === 'fill' || kind === 'stroke') {
    const d = /^<path d="([^"]+)"/.exec(body)?.[1];
    if (!d || !PATH.test(d)) return null;
    if (kind === 'stroke') return { kind, d };
    const hex = /data-hex="(#[0-9a-f]{6})"/.exec(open[3]!)?.[1];
    return hex ? { kind, d, hex } : null;
  }
  // Colour artwork goes into the page as markup: allow-listed tags only, local references only.
  for (const m of body.matchAll(/<\/?([A-Za-z][\w:-]*)/g)) if (!COLOR_TAGS.has(m[1]!)) return null;
  if (/\son\w+\s*=|javascript:|<!|<\?|href="(?!#)|url\((?!#)/i.test(body)) return null;
  const attrs = open[3]!.trim();
  if (attrs && !/^(?:(?:fill|stroke|fill-rule)="[#\w.%-]*"\s*)*$/.test(attrs)) return null;
  return { kind: 'color', viewBox: open[1]!, attrs, body };
}

type Loader = (file: string) => Promise<string>;
let loader: Loader | null = null;
const art = new Map<string, IconArt | null>();
const pending = new Map<string, Promise<void>>();

/** Where icon files come from: the browser fetches /icons/<file>.svg from the local server. */
export function setIconLoader(fn: Loader | null): void {
  loader = fn;
}

/** Loaded artwork for a file; undefined while it was never loaded, null when it failed. */
export const loadedIcon = (file: string): IconArt | null | undefined => art.get(file);

/**
 * Load the files for these icon names. Resolves to true when something new arrived (repaint), false otherwise.
 * Never rejects: a file that fails stays on its fallback glyph.
 */
export async function loadIcons(list: Iterable<string>): Promise<boolean> {
  const fn = loader;
  if (!fn) return false;
  const files = new Set<string>();
  for (const name of list) {
    const file = iconFile(name);
    if (file && !art.has(file)) files.add(file);
  }
  if (!files.size) return false;
  await Promise.all(
    [...files].map((file) => {
      let p = pending.get(file);
      if (!p) {
        p = fn(file)
          .then((text) => void art.set(file, parseIconFile(text)))
          .catch(() => void art.set(file, null))
          .finally(() => pending.delete(file));
        pending.set(file, p);
      }
      return p;
    }),
  );
  return [...files].some((f) => art.get(f));
}
