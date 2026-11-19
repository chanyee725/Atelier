// Import the bundled icon sets into the repo (#734). Run by hand when a set should be updated; the app and
// server never fetch icons at runtime.
//
//   node scripts/import-icons.mjs [--cache <dir>] [--offline]
//
// Sources:
// - AWS Architecture Icons, Azure Architecture Icons, Google Cloud icons: the publishers' official zip
//   packages (URLs below), downloaded into the cache folder once (`--offline` uses only the cache).
// - Simple Icons (CC0-1.0) and Lucide (ISC) from the `simple-icons` and `lucide-static` npm packages.
//
// Writes:
// - web/icons/<set>/<key>.svg   one cleaned SVG per icon (see cleanSvg: allow-listed elements and attributes only)
// - shared/render/icon-index.ts name → file index (set keys, plus Eraser-style names as aliases)
// - web/icons/THIRD-PARTY.md    each set with its version, licence or terms, and icon count
//
// Downloaded archives are untrusted input: they are read as data only (zip parsed here, SVG text tokenised
// here), nothing in them is executed, and an icon that does not fit the allow-list is skipped.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { absoluteStart } from './build-icons.mjs';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICON_DIR = join(ROOT, 'web/icons');
const INDEX_OUT = join(ROOT, 'shared/render/icon-index.ts');
const ERASER_NAMES = join(ROOT, 'docs/research/eraser/icon-names.txt');

export const SOURCES = {
  aws: {
    title: 'AWS Architecture Icons',
    version: 'Icon package 07312026 (2026-07-31 release)',
    url: 'https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip',
    page: 'https://aws.amazon.com/architecture/icons/',
    terms:
      'AWS allows customers and partners to use these icons to create architecture diagrams (see the page above). ' +
      'Icons are used unmodified in shape and colour; AWS and the service names are trademarks of Amazon.com, Inc. or its affiliates.',
  },
  azure: {
    title: 'Azure Architecture Icons',
    version: 'Azure Public Service Icons V25',
    url: 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V25.zip',
    page: 'https://learn.microsoft.com/azure/architecture/icons/',
    terms:
      'Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. ' +
      'You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft. ' +
      'Microsoft reserves all other rights. (Icon terms on the page above; Microsoft_Terms_of_Use.pdf in the package.)',
  },
  gcp: {
    title: 'Google Cloud icons',
    version: 'core-products-icons.zip, category-icons.zip, google-cloud-legacy-icons.zip',
    urls: [
      'https://services.google.com/fh/files/misc/core-products-icons.zip',
      'https://services.google.com/fh/files/misc/category-icons.zip',
      'https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip',
    ],
    page: 'https://cloud.google.com/icons',
    terms:
      'Published by Google for drawing Google Cloud architecture diagrams (page above). ' +
      'Google Cloud and the product names are trademarks of Google LLC.',
  },
};

/** Set prefix used in icon names (`aws-ec2`). Simple Icons and Lucide names have none. */
export const PREFIX = { aws: 'aws-', azure: 'azure-', gcp: 'gcp-', simple: '', lucide: '' };

// ---------------------------------------------------------------- zip (stored and deflate only)

/** Entries of a zip archive: name → bytes. Only "stored" and "deflate" are supported. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || !name.toLowerCase().endsWith('.svg') || name.includes('__MACOSX')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip: bad local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`zip: ${name} uses method ${method}`);
  }
  return out;
}

// ---------------------------------------------------------------- SVG cleaning

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use',
]);
/** Dropped with everything inside them. */
const DROP = new Set(['title', 'desc', 'metadata', 'filter', 'sodipodi:namedview', 'style']);
const ATTRS = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'points',
  'transform', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits',
  'maskUnits', 'maskContentUnits', 'id', 'clip-path', 'mask', 'href', 'xlink:href', 'display', 'visibility',
  'isolation',
]);
/** Style properties kept when `style="..."` or a `<style>` class rule is turned into attributes. */
const STYLE_PROPS = new Set([
  'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'stop-color', 'stop-opacity', 'display',
  'isolation', 'clip-path', 'mask',
]);
/** Safe attribute value: numbers, colours, path data, transforms and `url(#id)` only. */
const SAFE_VALUE = /^[#\w\s.,%()+\-:]*$/;

/** Tokenise SVG text into a tree. Throws on anything it does not understand. */
export function parseSvg(text) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i);
      if (e < 0) throw new Error('svg: open comment');
      i = e + 3;
    } else if (s.startsWith('<?', i)) {
      const e = s.indexOf('?>', i);
      if (e < 0) throw new Error('svg: open declaration');
      i = e + 2;
    } else if (s.startsWith('<!', i)) {
      throw new Error('svg: doctype or CDATA');
    } else if (s.startsWith('</', i)) {
      const e = s.indexOf('>', i);
      const tag = s.slice(i + 2, e).trim();
      const top = stack.pop();
      if (!top || top.tag !== tag) throw new Error(`svg: mismatched </${tag}>`);
      i = e + 1;
    } else if (s[i] === '<') {
      const m = /^<([A-Za-z][\w:.-]*)/.exec(s.slice(i, i + 80));
      if (!m) throw new Error('svg: bad tag');
      let j = i + m[0].length;
      const attrs = {};
      const re = /\s*([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        re.lastIndex = j;
        const a = re.exec(s);
        if (!a) throw new Error(`svg: bad attribute in <${m[1]}>`);
        j = re.lastIndex;
        if (a[5]) {
          const node = { tag: m[1], attrs, children: [], text: '' };
          stack[stack.length - 1].children.push(node);
          if (a[5] === '>') stack.push(node);
          break;
        }
        attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
      }
      i = j;
    } else {
      const e = s.indexOf('<', i);
      const end = e < 0 ? s.length : e;
      stack[stack.length - 1].text += s.slice(i, end);
      i = end;
    }
  }
  if (stack.length !== 1) throw new Error('svg: unclosed element');
  const svg = root.children.find((c) => c.tag === 'svg');
  if (!svg) throw new Error('svg: no <svg> root');
  return svg;
}

function decodeEntities(v) {
  return v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/** `.a{fill:#fff}.b,.c{...}` → class → declarations. Throws on any other selector or at-rule. */
function parseClassRules(css) {
  const rules = new Map();
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    const decls = parseDecls(m[2]);
    for (const sel of m[1].split(',')) {
      const c = /^\s*\.([\w-]+)\s*$/.exec(sel);
      if (!c) throw new Error(`svg: unsupported selector "${sel.trim()}"`);
      rules.set(c[1], { ...(rules.get(c[1]) ?? {}), ...decls });
    }
  }
  if (body.replace(/([^{}]+)\{([^{}]*)\}/g, '').trim()) throw new Error('svg: unsupported CSS');
  return rules;
}

function parseDecls(text) {
  const out = {};
  for (const part of text.split(';')) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    const prop = part.slice(0, k).trim().toLowerCase();
    const val = part.slice(k + 1).trim();
    if (STYLE_PROPS.has(prop)) out[prop] = val;
  }
  return out;
}

/** Shorten long decimals (Illustrator exports 7 digits); two decimals are below a pixel at any icon size. */
const roundNums = (v) => v.replace(/(\d*\.\d{3,})/g, (x) => String(Math.round(Number(x) * 100) / 100));
const NUMERIC_ATTRS = new Set(['d', 'points', 'transform', 'gradientTransform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height']);

/**
 * Clean a full-colour SVG: allow-listed elements and attributes, `<style>` class rules and `style=""` turned into
 * attributes, ids prefixed so several icons can share one document, references limited to `url(#id)` / `#id`.
 * Returns the standalone file text, or throws.
 */
export function cleanSvg(text, idPrefix) {
  const svg = parseSvg(text);
  const viewBox = svg.attrs.viewBox ?? (svg.attrs.width && svg.attrs.height ? `0 0 ${parseFloat(svg.attrs.width)} ${parseFloat(svg.attrs.height)}` : null);
  if (!viewBox || !/^[\d.\s-]+$/.test(viewBox) || viewBox.trim().split(/\s+/).length !== 4) throw new Error('svg: no usable viewBox');
  const classes = new Map();
  const collectStyles = (node) => {
    for (const c of node.children) {
      if (c.tag === 'style') for (const [k, v] of parseClassRules(c.text)) classes.set(k, { ...(classes.get(k) ?? {}), ...v });
      else collectStyles(c);
    }
  };
  collectStyles(svg);
  const ids = new Map();
  const collectIds = (node) => {
    for (const c of node.children) {
      if (c.attrs.id) ids.set(c.attrs.id, `${idPrefix}${ids.size}`);
      collectIds(c);
    }
  };
  collectIds(svg);
  const ref = (v) =>
    v.replace(/url\(\s*['"]?#([^)'"]+)['"]?\s*\)/g, (_, id) => {
      const to = ids.get(id);
      if (!to) throw new Error(`svg: dangling reference #${id}`);
      return `url(#${to})`;
    });
  const referenced = new Set();
  const emit = (node) => {
    if (DROP.has(node.tag)) return '';
    if (!ELEMENTS.has(node.tag)) throw new Error(`svg: element <${node.tag}>`);
    const merged = {};
    for (const cls of (node.attrs.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(merged, classes.get(cls) ?? {});
    Object.assign(merged, Object.fromEntries(Object.entries(node.attrs).filter(([k]) => k !== 'class' && k !== 'style')));
    Object.assign(merged, parseDecls(node.attrs.style ?? ''));
    let out = '';
    for (let [k, v] of Object.entries(merged)) {
      if (!ATTRS.has(k) || k === 'filter') continue;
      if (k === 'id') {
        if (!['linearGradient', 'radialGradient', 'clipPath', 'mask', 'path', 'g', 'rect', 'circle', 'ellipse', 'polygon'].includes(node.tag)) continue;
        v = ids.get(v);
      } else if (k === 'href' || k === 'xlink:href') {
        const m = /^#(.+)$/.exec(v.trim());
        if (!m || !ids.get(m[1])) throw new Error('svg: external href');
        k = 'href';
        v = `#${ids.get(m[1])}`;
        referenced.add(v.slice(1));
      } else {
        if (/url\(/i.test(v)) {
          v = ref(v);
          for (const m of v.matchAll(/url\(#([^)]+)\)/g)) referenced.add(m[1]);
        }
        if (!SAFE_VALUE.test(v)) throw new Error(`svg: unsafe value in ${k}`);
        if (NUMERIC_ATTRS.has(k)) v = roundNums(v);
      }
      out += ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
    }
    if (node.tag === 'svg') return node.children.map(emit).join('');
    const inner = node.children.map(emit).join('');
    return inner ? `<${node.tag}${out}>${inner}</${node.tag}>` : `<${node.tag}${out}/>`;
  };
  let inner = emit(svg);
  // Ids nothing points at are dead weight.
  inner = inner.replace(/ id="([^"]+)"/g, (all, id) => (referenced.has(id) ? all : ''));
  const rootPaint = ['fill', 'stroke', 'fill-rule'].filter((k) => svg.attrs[k] && SAFE_VALUE.test(svg.attrs[k]) && !/url\(/.test(svg.attrs[k]));
  const rootAttrs = rootPaint.map((k) => ` ${k}="${svg.attrs[k]}"`).join('');
  if (!inner.trim()) throw new Error('svg: empty');
  const vb = viewBox.trim().split(/\s+/).map((x) => String(Math.round(Number(x) * 100) / 100)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-kind="color"${rootAttrs}>${inner}</svg>\n`;
}

/** A one-colour logo or outline icon on the 24 grid. */
export function monoSvg(d, kind, hex) {
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/.test(d)) throw new Error('mono: bad path data');
  if (kind === 'fill') {
    if (!/^#[0-9a-f]{6}$/.test(hex)) throw new Error('mono: bad colour');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-kind="fill" data-hex="${hex}"><path d="${d}" fill="${hex}"/></svg>\n`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-kind="stroke" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>\n`;
}

// ---------------------------------------------------------------- names

/** `Amazon-EC2-Auto-Scaling` → `ec2-auto-scaling`. Lower-case words joined by `-`, vendor word dropped. */
export function slugify(name, vendor) {
  let s = name
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  for (const v of vendor) if (s.startsWith(`${v}-`)) s = s.slice(v.length + 1);
  return s;
}

/** Short service names Eraser uses → the words in the publisher's file name. */
const SHORT = {
  elb: 'elastic load balancing',
  eks: 'elastic kubernetes',
  ecs: 'elastic container',
  ecr: 'elastic container registry',
  efs: 'efs',
  aad: 'entra',
  ad: 'entra id',
};

/** Loose comparison form: separators and filler words removed (`database-for-postgresql` = `databasepostgresql`). */
export function looseKey(name) {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((w) => (SHORT[w] ?? w).split(' '))
    .filter((w) => w && !['for', 'of', 'and', 'the', 'service', 'services', 'amazon', 'aws', 'azure', 'google', 'cloud', 'gcp', 'microsoft'].includes(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join('');
}

// ---------------------------------------------------------------- sets

function collectAws(zip) {
  const out = new Map();
  const add = (key, text, prio) => {
    const cur = out.get(key);
    if (!cur || cur.prio > prio) out.set(key, { text, prio });
  };
  for (const [path, buf] of zip) {
    const file = path.split('/').pop();
    const text = buf.toString('utf8');
    if (/_Dark(_\d+)?\.svg$/i.test(file) || /_Dark_/i.test(file)) continue;
    let m;
    if ((m = /^Architecture-Service-Icons_[^/]+\/[^/]+\/48\/Arch_(.+)_48\.svg$/.exec(path))) add(slugify(m[1].replace(/_Light$/, ''), ['amazon', 'aws']), text, 0);
    else if ((m = /^Resource-Icons_[^/]+\/[^/]+\/Res_(.+?)_48(_Light)?\.svg$/.exec(path))) add(slugify(m[1].replace(/_Light$/, ''), ['amazon', 'aws']), text, 2);
    else if ((m = /^Category-Icons_[^/]+\/Arch-Category_48\/Arch-Category_(.+)_48\.svg$/.exec(path))) add(slugify(m[1], ['amazon', 'aws']), text, 1);
    else if ((m = /^Architecture-Group-Icons_[^/]+\/(.+)_32\.svg$/.exec(path))) add(slugify(m[1], ['amazon', 'aws']), text, 3);
  }
  return out;
}

function collectAzure(zip) {
  const out = new Map();
  for (const [path, buf] of zip) {
    const m = /\/Icons\/[^/]+\/\d+-icon-service-(.+)\.svg$/.exec(path);
    if (!m) continue;
    const key = slugify(m[1], ['azure', 'microsoft']);
    if (!out.has(key)) out.set(key, { text: buf.toString('utf8'), prio: 0 });
  }
  return out;
}

function collectGcp(zips) {
  const out = new Map();
  for (const zip of zips) {
    for (const [path, buf] of zip) {
      let m;
      let key;
      let prio;
      if ((m = /(?:Unique Icons|Category Icons)\/([^/]+)\/SVG\/[^/]+\.svg$/.exec(path))) {
        key = slugify(m[1], ['google-cloud', 'google', 'cloud-gcp']);
        prio = 0;
      } else if ((m = /^([^/]+)\/\1\.svg$/.exec(path))) {
        key = slugify(m[1], ['google']);
        prio = 1;
      } else continue;
      const cur = out.get(key);
      if (!cur || cur.prio > prio) out.set(key, { text: buf.toString('utf8'), prio });
    }
  }
  return out;
}

const VENDOR_CLOUD = /^(aws|amazon|googlecloud|google|gcp|microsoftazure|azure)/;

function collectSimple() {
  const siDir = `${dirname(require.resolve('simple-icons'))}/`;
  const version = JSON.parse(readFileSync(`${siDir}package.json`, 'utf8')).version;
  const raw = JSON.parse(readFileSync(`${siDir}data/simple-icons.json`, 'utf8'));
  const byTitle = new Map((Array.isArray(raw) ? raw : raw.icons).map((i) => [i.title, i]));
  const out = new Map();
  const skipped = [];
  for (const icon of Object.values(require('simple-icons'))) {
    if (!icon?.slug) continue;
    const meta = byTitle.get(icon.title);
    if (meta?.license && meta.license.type !== 'CC0-1.0') {
      skipped.push(icon.slug);
      continue;
    }
    if (VENDOR_CLOUD.test(icon.slug)) continue;
    try {
      out.set(icon.slug, { file: monoSvg(icon.path, 'fill', `#${icon.hex.toLowerCase()}`), title: icon.title, aka: meta?.aliases?.aka ?? [] });
    } catch (e) {
      skipped.push(`${icon.slug} (${e.message})`);
    }
  }
  return { version, icons: out, skipped };
}

function lucideElementPath([tag, a]) {
  const num = Number;
  switch (tag) {
    case 'path':
      return absoluteStart(a.d);
    case 'line':
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const p = a.points.trim().split(/[\s,]+/).map(num);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? `${d}Z` : d;
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [num(a.cx), num(a.cy)];
      const rx = num(tag === 'circle' ? a.r : a.rx);
      const ry = num(tag === 'circle' ? a.r : a.ry);
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    }
    case 'rect': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      const rx = Math.min(num(a.rx ?? a.ry ?? 0), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx ?? 0), h / 2);
      if (!rx && !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return (
        `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}` +
        `h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`
      );
    }
    default:
      throw new Error(`lucide: unsupported element <${tag}>`);
  }
}

function collectLucide() {
  const pkg = dirname(require.resolve('lucide-static/package.json'));
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  const nodes = JSON.parse(readFileSync(join(pkg, 'icon-nodes.json'), 'utf8'));
  const out = new Map();
  for (const [name, els] of Object.entries(nodes)) out.set(name, { file: monoSvg(els.map(lucideElementPath).join(' '), 'stroke') });
  // Old names still shipped as files (`alert-circle` → `circle-alert`): same drawing as a current icon.
  const body = (f) => readFileSync(join(pkg, 'icons', f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/class="[^"]*"/, '').replace(/\s+/g, ' ').trim();
  const byBody = new Map();
  for (const name of out.keys()) byBody.set(body(`${name}.svg`), name);
  const aliases = new Map();
  for (const f of readdirSync(join(pkg, 'icons'))) {
    const name = f.replace(/\.svg$/, '');
    if (out.has(name)) continue;
    const to = byBody.get(body(f));
    if (to) aliases.set(name, to);
  }
  return { version, icons: out, aliases };
}

// ---------------------------------------------------------------- main

async function fetchCached(url, cache) {
  const file = join(cache, createHash('sha256').update(url).digest('hex').slice(0, 16) + '.zip');
  if (!existsSync(file)) {
    if (process.argv.includes('--offline')) throw new Error(`not cached: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(file);
  return { buf, sha256: createHash('sha256').update(buf).digest('hex') };
}

function cleanAll(set, raw, report) {
  const out = new Map();
  for (const [key, { text }] of [...raw].sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      report.push(`${set}/${key}: bad key`);
      continue;
    }
    try {
      out.set(key, { file: cleanSvg(text, `i-${set}-${key}-`) });
    } catch (e) {
      report.push(`${set}/${key}: ${e.message}`);
    }
  }
  return out;
}

async function main() {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const cache = arg('--cache') ?? join(tmpdir(), 'atelier-icon-sources');
  mkdirSync(cache, { recursive: true });
  const skipped = [];
  const hashes = {};

  const aws = await fetchCached(SOURCES.aws.url, cache);
  hashes.aws = [aws.sha256];
  const azure = await fetchCached(SOURCES.azure.url, cache);
  hashes.azure = [azure.sha256];
  const gcpZips = [];
  hashes.gcp = [];
  for (const u of SOURCES.gcp.urls) {
    const z = await fetchCached(u, cache);
    hashes.gcp.push(z.sha256);
    gcpZips.push(readZip(z.buf));
  }

  const sets = {
    aws: cleanAll('aws', collectAws(readZip(aws.buf)), skipped),
    azure: cleanAll('azure', collectAzure(readZip(azure.buf)), skipped),
    gcp: cleanAll('gcp', collectGcp(gcpZips), skipped),
  };
  const simple = collectSimple();
  const lucide = collectLucide();
  sets.simple = simple.icons;
  sets.lucide = lucide.icons;

  rmSync(ICON_DIR, { recursive: true, force: true });
  for (const [set, icons] of Object.entries(sets)) {
    mkdirSync(join(ICON_DIR, set), { recursive: true });
    for (const [key, { file }] of icons) writeFileSync(join(ICON_DIR, set, `${key}.svg`), file);
  }

  // Aliases: other spellings that point at a file. Lucide's old names, Simple Icons' "aka" names, then every
  // documented Eraser name that has no file of its own but matches one loosely (same set prefix).
  const aliases = new Map();
  const direct = new Set();
  for (const [set, icons] of Object.entries(sets)) for (const key of icons.keys()) direct.add(PREFIX[set] + key);
  const addAlias = (name, to) => {
    if (!direct.has(name) && !aliases.has(name) && /^[a-z0-9][a-z0-9-]*$/.test(name)) aliases.set(name, to);
  };
  for (const [from, to] of lucide.aliases) addAlias(from, `lucide/${to}`);
  for (const [slug, { aka }] of simple.icons) for (const a of aka) addAlias(slugify(a, []), `simple/${slug}`);
  const loose = new Map();
  for (const [set, icons] of Object.entries(sets)) {
    for (const key of icons.keys()) {
      const k = `${PREFIX[set]}|${looseKey(key)}`;
      if (!loose.has(k)) loose.set(k, `${set}/${key}`);
    }
  }
  // Brand names written with separators (`alibaba-cloud`, `node-js`): compare with separators removed.
  const compact = new Map();
  for (const key of simple.icons.keys()) compact.set(key.replace(/dot/g, ''), `simple/${key}`);
  for (const key of simple.icons.keys()) compact.set(key, `simple/${key}`);
  const eraser = existsSync(ERASER_NAMES) ? readFileSync(ERASER_NAMES, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
  for (const name of eraser) {
    if (direct.has(name) || aliases.has(name)) continue;
    const set = ['aws', 'azure', 'gcp'].find((s) => name.startsWith(PREFIX[s]));
    const bare = set ? name.slice(PREFIX[set].length) : name;
    const hit = loose.get(`${set ? PREFIX[set] : ''}|${looseKey(bare)}`) ?? (set ? undefined : compact.get(name.replace(/-/g, '')));
    if (hit) addAlias(name, hit);
  }

  writeFileSync(INDEX_OUT, indexSource(sets, aliases, { simple: simple.version, lucide: lucide.version }));
  writeFileSync(join(ICON_DIR, 'THIRD-PARTY.md'), noticeSource(sets, { simple: simple.version, lucide: lucide.version }, hashes, simple.skipped));

  const covered = eraser.filter((n) => direct.has(n) || aliases.has(n));
  const counts = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]));
  console.log(JSON.stringify({ counts, aliases: aliases.size, skipped: skipped.length, eraserNames: eraser.length, eraserCovered: covered.length }, null, 1));
  if (skipped.length) console.log(`skipped:\n  ${skipped.join('\n  ')}`);
}

function indexSource(sets, aliases, versions) {
  const q = JSON.stringify;
  const lines = [
    '// GENERATED by scripts/import-icons.mjs. Do not edit by hand.',
    `// Files: web/icons/<set>/<key>.svg, served at /icons/<set>/<key>.svg. Notices: web/icons/THIRD-PARTY.md.`,
    `// Lucide ${versions.lucide}, Simple Icons ${versions.simple}, ${SOURCES.aws.version}, ${SOURCES.azure.version}, Google Cloud icons.`,
    '',
    '/** Bundled sets: name prefix and the keys of their files, sorted. Icon name = prefix + key. */',
    'export const ICON_FILES = {',
  ];
  for (const [set, icons] of Object.entries(sets)) {
    lines.push(`  ${set}: { prefix: ${q(PREFIX[set])}, keys: ${q([...icons.keys()].join(' '))} },`);
  }
  lines.push('} as const;', '');
  lines.push('/** Other names (old Lucide names, brand spellings, Eraser names) → `<set>/<key>`. */');
  lines.push(`export const ICON_ALIASES: string = ${q([...aliases].sort(([a], [b]) => a.localeCompare(b)).map(([a, b]) => `${a}=${b}`).join(' '))};`);
  lines.push('');
  return lines.join('\n');
}

function noticeSource(sets, versions, hashes, siSkipped) {
  const L = [
    '# Bundled icon sets',
    '',
    'Generated by `scripts/import-icons.mjs`. Every file under `web/icons/` comes from one of the sets below.',
    'Files are re-serialised (allow-listed SVG elements only, ids prefixed, long decimals shortened); shapes and colours are unchanged.',
    'Logos and product icons are trademarks of their owners; their use here does not imply endorsement.',
    '',
    '| Set | Folder | Version | Licence / terms | Icons |',
    '| --- | --- | --- | --- | --- |',
    `| ${SOURCES.aws.title} | \`aws/\` | ${SOURCES.aws.version} | AWS terms for architecture diagrams | ${sets.aws.size} |`,
    `| ${SOURCES.azure.title} | \`azure/\` | ${SOURCES.azure.version} | Microsoft icon terms | ${sets.azure.size} |`,
    `| ${SOURCES.gcp.title} | \`gcp/\` | ${SOURCES.gcp.version} | Google Cloud icon terms | ${sets.gcp.size} |`,
    `| Simple Icons | \`simple/\` | ${versions.simple} (npm \`simple-icons\`) | CC0-1.0 | ${sets.simple.size} |`,
    `| Lucide | \`lucide/\` | ${versions.lucide} (npm \`lucide-static\`) | ISC (some icons MIT, from Feather) | ${sets.lucide.size} |`,
    '',
  ];
  for (const k of ['aws', 'azure', 'gcp']) {
    const s = SOURCES[k];
    L.push(`## ${s.title}`, '', `- Page: ${s.page}`, `- Package: ${(s.urls ?? [s.url]).join(', ')}`, `- SHA-256: ${hashes[k].join(', ')}`, `- Terms: ${s.terms}`, '');
  }
  L.push(
    '## Simple Icons',
    '',
    '- https://simpleicons.org, CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/).',
    `- Icons with their own non-CC0 licence are not bundled (${siSkipped.length} left out). Cloud vendor logos (AWS, Azure, Google Cloud) are not taken from Simple Icons.`,
    '',
    '## Lucide',
    '',
    '- https://lucide.dev, ISC License; icons derived from Feather are MIT (Copyright (c) 2013-present Cole Bemis).',
    '- Full licence texts: `NOTICE.md` in the repository root.',
    '',
  );
  return L.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
