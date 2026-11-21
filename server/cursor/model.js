import { createHash } from 'node:crypto';

// Pure helpers for the live agent cursor (E56): which element or block of a `.dpx.json` changed between two
// versions, and where its centre is in scene coordinates. No I/O, so it runs under `node --test`.

/** Tools that only read: a mention of the file there is not an edit. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch']);

/**
 * Whether a session's tool entry (name + masked, clipped input text) points at workspace file `rel`.
 * Matches the relative path as written or URL-encoded (curl …/api/file?path=…), on a path boundary.
 */
export function mentionsFile(entry, rel) {
  if (!entry || entry.kind !== 'tool' || typeof entry.text !== 'string' || READ_TOOLS.has(entry.name)) return false;
  return textMentions(entry.text, rel);
}

const EXT = '.dpx.json';
/**
 * Whether `text` names workspace file `rel` on a path boundary: as written, URL-encoded, partly encoded (Python's
 * quote() keeps "/"), each also without the `.dpx.json` the API adds itself (`/api/file?path=analysis/robot`, #653).
 */
export function textMentions(text, rel) {
  if (typeof text !== 'string' || !rel) return false;
  const enc = encodeURIComponent(rel);
  const forms = [rel, enc, enc.replace(/%2F/gi, '/')];
  const bare = rel.endsWith(EXT) ? forms.map((f) => f.slice(0, -EXT.length)) : [];
  for (const needle of new Set([...forms, ...bare])) {
    // Without the extension the name must end there too ("robot" is not "robot2" or "robot.md").
    const open = bare.includes(needle) && !forms.includes(needle);
    let i = text.indexOf(needle);
    while (i !== -1) {
      const before = i === 0 ? '' : text[i - 1];
      const after = text.slice(i + needle.length, i + needle.length + EXT.length);
      if ((before === '' || /[\s/"'=:]/.test(before)) && (!open || after === EXT || !/^[\w\-.%/]/.test(after))) return true;
      i = text.indexOf(needle, i + 1);
    }
  }
  return false;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Scene box of a canvas element or block: { x, y, w, h } (absolute size), or null without usable numbers. */
function boxOf(x, y, w, h) {
  x = num(x); y = num(y); w = num(w) ?? 0; h = num(h) ?? 0;
  if (x === null || y === null) return null;
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

/**
 * Everything on the canvas with a place: `el:<id>` for canvas elements, `block:<id>` for diagram blocks.
 * Each entry keeps a signature (its JSON) to tell a change, and its box. Deleted elements count as absent.
 */
export function shapesOf(file) {
  const out = new Map();
  for (const e of Array.isArray(file?.canvas?.elements) ? file.canvas.elements : []) {
    if (!e || typeof e.id !== 'string' || e.isDeleted) continue;
    const box = boxOf(e.x, e.y, e.width, e.height);
    if (box) out.set(`el:${e.id}`, { sig: JSON.stringify(e), box });
  }
  for (const b of Array.isArray(file?.blocks) ? file.blocks : []) {
    if (!b || typeof b.id !== 'string') continue;
    const box = boxOf(b.x, b.y, b.w, b.h);
    if (box) out.set(`block:${b.id}`, { sig: JSON.stringify(b), box });
  }
  return out;
}

/**
 * Centre of the bounds of what changed from `before` to `after` (maps from shapesOf): added and changed shapes at
 * their new place, removed ones at their old place. Null when nothing with a place changed.
 */
export function changedCentre(before, after) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (b) => {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  };
  for (const [k, s] of after) if (before.get(k)?.sig !== s.sig) add(s.box);
  for (const [k, s] of before) if (!after.has(k)) add(s.box);
  if (x0 === Infinity) return null;
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}

/** Keys (`el:<id>` / `block:<id>`) of what changed from `before` to `after`: added, changed and removed shapes. */
export function changedKeys(before, after) {
  const out = [];
  for (const [k, s] of after) if (before.get(k)?.sig !== s.sig) out.push(k);
  for (const k of before.keys()) if (!after.has(k)) out.push(k);
  return out;
}

// Document cursor (E529, issue #619): where in the document (`file.document`, ProseMirror JSON) an agent wrote, as a
// top-level block index and a text offset inside that block, so the doc view can map it to a caret position.

/** Signature of a top-level block; a heading's link id is ignored (the editor gives ids to headings that have none). */
function blockSig(b) {
  if (b && typeof b === 'object' && b.type === 'heading' && b.attrs && 'id' in b.attrs) {
    const { id: _id, ...attrs } = b.attrs;
    return JSON.stringify({ ...b, attrs });
  }
  return JSON.stringify(b);
}

const hash = (s) => createHash('sha1').update(s).digest('base64');

/** Text of a block: its text nodes only, in order (the doc view counts the same way, see web/src/doc/docCursor.ts). */
export function blockText(b) {
  if (!b || typeof b !== 'object') return '';
  if (b.type === 'text') return typeof b.text === 'string' ? b.text : '';
  return Array.isArray(b.content) ? b.content.map(blockText).join('') : '';
}

/**
 * The document's top-level blocks: { sig, type, text, ref } each (empty for a file without a document). `ref` is the
 * canvas block id an embedded diagram shows (E712, #1039), absent for other blocks.
 */
export function docBlocksOf(file) {
  const c = file?.document?.content;
  if (!Array.isArray(c)) return [];
  // The signature is kept per file between changes (server/cursor/index.js): a hash, not a second copy of the JSON.
  return c.map((b) => {
    const out = { sig: hash(blockSig(b)), type: typeof b?.type === 'string' ? b.type : '', text: blockText(b) };
    if (b?.type === 'diagram' && typeof b.attrs?.blockId === 'string') out.ref = b.attrs.blockId;
    return out;
  });
}

/** Signature of each canvas block (`file.blocks`) by id: its code and properties, so a change inside a block is seen. */
export function blockSigsOf(file) {
  const out = new Map();
  for (const b of Array.isArray(file?.blocks) ? file.blocks : []) {
    if (b && typeof b.id === 'string') out.set(b.id, hash(JSON.stringify(b)));
  }
  return out;
}

/**
 * Where a change to canvas blocks that a document embeds lands (E712, #1039): the last embedded diagram, in `docAfter`
 * (docBlocksOf), whose block id changed between `beforeSigs` and `afterSigs` (blockSigsOf). The place is the start of
 * that diagram: it is an atom, so the doc view shows the cursor at the diagram itself. Null when no embedded one changed.
 */
export function embedSpot(beforeSigs = new Map(), afterSigs = new Map(), docAfter = []) {
  const changed = new Set();
  for (const [id, sig] of afterSigs) if (beforeSigs.get(id) !== sig) changed.add(id);
  for (let i = docAfter.length - 1; i >= 0; i--) {
    if (docAfter[i].ref !== undefined && changed.has(docAfter[i].ref)) return { index: i, offset: 0 };
  }
  return null;
}

/**
 * Where a document change from `before` to `after` (lists from docBlocksOf) ends: { index, offset } of the last
 * changed top-level block in `after` and the text offset just past the change in it (the end of a new block). A pure
 * removal lands at the start of the block that now stands in its place. Null when the document did not change.
 */
export function changedDocSpot(before = [], after = []) {
  const B = before.length;
  const A = after.length;
  let pre = 0;
  while (pre < A && pre < B && before[pre].sig === after[pre].sig) pre++;
  let suf = 0;
  while (suf < A - pre && suf < B - pre && before[B - 1 - suf].sig === after[A - 1 - suf].sig) suf++;
  if (pre === A && pre === B) return null;
  if (A - suf === pre) {
    // Only removed blocks: the block now at their place, or the one before it at the end.
    if (!A) return null;
    return { index: Math.min(pre, A - 1), offset: 0 };
  }
  const index = A - suf - 1;
  const now = after[index];
  const k = index - pre;
  const old = k < B - suf - pre ? before[pre + k] : null;
  if (!old || old.type !== now.type) return { index, offset: now.text.length };
  const a = now.text;
  const b = old.text;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { index, offset: a.length - s };
}

/**
 * The section a document change landed in (E537, #654): the text of the nearest non-empty heading at or above block
 * `index` in `blocks` (docBlocksOf), clipped to 60 characters; null above the first heading or without a place.
 */
export function sectionAt(blocks = [], index) {
  if (!Number.isInteger(index) || index < 0) return null;
  for (let i = Math.min(index, blocks.length - 1); i >= 0; i--) {
    const b = blocks[i];
    if (b?.type !== 'heading') continue;
    const t = String(b.text ?? '').replace(/\s+/g, ' ').trim();
    if (t) return [...t].slice(0, 60).join('');
  }
  return null;
}
