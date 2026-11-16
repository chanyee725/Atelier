// Code references on canvas nodes (docs/design/code-linked-nodes.md §3): which nodes carry code, what the "기능 코드"
// panel shows, when it opens and closes, and where the `</>` badges sit. Pure (no React or Excalidraw import), so it
// runs under `node --test`.
import { parse } from '../../../shared/dsl/index.ts';
import type { GraphChild } from '../../../shared/dsl/types.ts';
import { BLOCK_CODE_VERSION, blockCodeProblem, dslCodeRefs, mergeCodeRefs, type BlockCode, type CodeRef, type NodeCode } from '../../../shared/render/block-code.ts';
import type { Scene } from '../../../shared/render/index.ts';
import { layoutFrame } from './layoutEdit.ts';
import { blockIdOf, type SceneEl } from './sync.ts';

export type { CodeRef, NodeCode };

/** The block fields code info is read from. */
export type CodeBlock = { id: string; type: string; code: string; codeRefs?: BlockCode };

/** What the panel shows: one node of a diagram block, or one free-form shape. */
export type CodeTarget = { kind: 'node'; blockId: string; node: string } | { kind: 'shape'; id: string };

export type BlockCodeInfo = {
  /** Node name -> merged code (block JSON plus DSL `code:`), only nodes with at least one ref or a summary. No prototype. */
  nodes: Record<string, NodeCode>;
  /** Node name -> label shown on the diagram. No prototype. */
  labels: Record<string, string>;
  /** Keys of `block.codeRefs.nodes` that match no node in the code (a renamed or removed node). */
  orphans: string[];
};

const EMPTY: BlockCodeInfo = { nodes: Object.create(null), labels: Object.create(null), orphans: [] };

const hasCode = (n: NodeCode | undefined): n is NodeCode => !!n && (n.refs.length > 0 || !!n.summary);

function walkNodes(list: readonly GraphChild[], out: Record<string, string>) {
  for (const c of list) {
    if (c.kind === 'node') out[c.name] = c.label;
    else if (c.kind === 'group') walkNodes(c.children, out);
  }
}

/** Code info of one block: what its nodes link to and which stored entries are orphaned. */
export function blockCodeInfo(b: CodeBlock): BlockCodeInfo {
  const stored = b.codeRefs;
  const parsed = parse(b.code).ast;
  const children = 'children' in parsed ? (parsed.children as GraphChild[]) : null;
  if (!children && !stored) return EMPTY;
  const labels: Record<string, string> = Object.create(null);
  if (children) walkNodes(children, labels);
  const merged = mergeCodeRefs(stored, children ? dslCodeRefs(children as never) : undefined);
  const nodes: Record<string, NodeCode> = Object.create(null);
  for (const [k, n] of Object.entries(merged)) if (Object.hasOwn(labels, k) && hasCode(n)) nodes[k] = n;
  const orphans = stored && stored.v <= BLOCK_CODE_VERSION && stored.nodes ? Object.keys(stored.nodes).filter((k) => !Object.hasOwn(labels, k)) : [];
  return { nodes, labels, orphans };
}

/** {@link blockCodeInfo} remembered per block id while its code and `codeRefs` stay the same (blocks change on every drag frame). */
export function codeInfoCache() {
  const memo = new Map<string, { code: string; type: string; refs: BlockCode | undefined; info: BlockCodeInfo }>();
  return (b: CodeBlock): BlockCodeInfo => {
    const m = memo.get(b.id);
    if (m && m.code === b.code && m.type === b.type && m.refs === b.codeRefs) return m.info;
    const info = blockCodeInfo(b);
    memo.set(b.id, { code: b.code, type: b.type, refs: b.codeRefs, info });
    return info;
  };
}

/** The block's `codeRefs` without entries for nodes that are no longer in its code; undefined when none are left. */
export function withoutOrphans(stored: BlockCode | undefined, orphans: readonly string[]): BlockCode | undefined {
  if (!stored || stored.v > BLOCK_CODE_VERSION) return stored;
  const drop = new Set(orphans);
  const nodes = Object.fromEntries(Object.entries(stored.nodes).filter(([k]) => !drop.has(k)));
  return Object.keys(nodes).length ? { v: stored.v, nodes } : undefined;
}

/** A free-form element's code (`customData.codeRefs`), when it is well formed and has something to show. */
export function shapeCode(el: { customData?: Record<string, unknown> | null } | undefined): NodeCode | null {
  const c = el?.customData?.codeRefs;
  if (c === undefined || blockCodeProblem({ v: 1, nodes: { n: c } })) return null;
  const n = c as NodeCode;
  return hasCode(n) ? n : null;
}

/** The element fields the panel logic reads (an Excalidraw element has them all). */
export type CodeEl = SceneEl & { containerId?: string | null; text?: string };

/** The shape that owns the code for a selected element: itself, or the container of a selected bound text. */
export function codeShapeOf(els: readonly CodeEl[], id: string): CodeEl | null {
  const el = els.find((e) => e.id === id && !e.isDeleted);
  if (!el) return null;
  if (shapeCode(el)) return el;
  if (el.type === 'text' && el.containerId) {
    const box = els.find((e) => e.id === el.containerId && !e.isDeleted);
    if (box && shapeCode(box)) return box;
  }
  return null;
}

/** Label of a free-form shape: its bound text (or its own text). */
export function shapeLabel(els: readonly CodeEl[], shape: CodeEl): string {
  if (typeof shape.text === 'string' && shape.text.trim()) return shape.text.trim();
  const t = els.find((e) => !e.isDeleted && e.type === 'text' && e.containerId === shape.id);
  return t?.text?.trim() || '도형';
}

/** What the selection on the canvas means for the panel. */
export type SelectionView = {
  /** Excalidraw's selected element ids (deleted ones left out). */
  ids: readonly string[];
  /** Block in layout edit mode, if any (its image is not selected then). */
  editing: string | null;
};

/**
 * The panel's target after the canvas selection changed. A single selected free-form shape with code opens it;
 * a node target stays while its block's image is the selection or the block is in edit mode; anything else closes.
 */
export function targetAfterSelection(prev: CodeTarget | null, sel: SelectionView, els: readonly CodeEl[]): CodeTarget | null {
  if (sel.ids.length >= 1 && sel.ids.length <= 2) {
    // A shape and its bound text count as one selection.
    const owners = new Set(sel.ids.map((id) => codeShapeOf(els, id)?.id ?? `!${id}`));
    if (owners.size === 1) {
      const [only] = owners;
      if (!only!.startsWith('!')) return { kind: 'shape', id: only! };
    }
  }
  if (!prev || prev.kind === 'shape') return null;
  if (sel.editing === prev.blockId && sel.ids.length === 0) return prev;
  if (sel.ids.length === 1) {
    const el = els.find((e) => e.id === sel.ids[0]);
    if (el && blockIdOf(el) === prev.blockId) return prev;
  }
  return null;
}

/**
 * The target after the edit overlay's node selection changed: one node with code opens it; selecting other nodes
 * closes a target of that block. An empty selection (entering from the palette, a press beside the nodes) keeps it.
 */
export function targetAfterNodes(prev: CodeTarget | null, blockId: string, ids: readonly string[], info: BlockCodeInfo): CodeTarget | null {
  if (ids.length === 1 && Object.hasOwn(info.nodes, ids[0]!)) return { kind: 'node', blockId, node: ids[0]! };
  if (ids.length > 0 && prev?.kind === 'node' && prev.blockId === blockId) return null;
  return prev;
}

/** `path:start-end` (or `path:start`) for a ref. */
export function refText(r: CodeRef): string {
  return r.end !== undefined && r.end !== r.start ? `${r.path}:${r.start}-${r.end}` : `${r.path}:${r.start}`;
}

/** A ref's path split before its file name, so the start of a long path can shrink and the file name stays visible. */
export function splitPath(path: string): { dir: string; file: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', file: path } : { dir: path.slice(0, i + 1), file: path.slice(i + 1) };
}

/** Plain 해요체 message for a failed code window request. */
export function codeError(status: number, error?: string): string {
  if (error === 'no-project') return '이 작업 폴더는 git 프로젝트 안에 있지 않아요';
  if (error === 'not-tracked') return 'git에 올라가지 않은 파일이라 보여 줄 수 없어요';
  switch (status) {
    case 400:
      return '경로나 줄 번호가 올바르지 않아요';
    case 403:
      return '이 파일은 보여 줄 수 없어요';
    case 404:
      return '파일을 찾지 못했어요';
    case 413:
      return '파일이 너무 커서 보여 줄 수 없어요';
    case 415:
      return '텍스트 파일이 아니에요';
    case 416:
      return '파일이 그 줄까지 없어요';
    default:
      return '코드를 불러오지 못했어요';
  }
}

/** A `</>` badge over one node of a block picture or a free-form shape, in wrapper pixels (the box's top-right corner). */
export type Badge = { blockId: string; node: string; label: string; x: number; y: number };

/** The element and view fields badge placement reads. */
export type BadgeEl = SceneEl & { opacity?: number; angle?: number; fileId?: string | null; containerId?: string | null; text?: string };
export type BadgeView = { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number };

/**
 * Badges for the nodes with code of every block picture on the canvas (rotated, hidden or deleted images, the
 * block in edit mode and later copies of a block are skipped). Free-form shapes with code get one too.
 */
export function placeBadges(
  els: readonly BadgeEl[],
  st: BadgeView,
  wrapRect: { left: number; top: number },
  codeOf: (blockId: string) => BlockCodeInfo | undefined,
  pictureOf: (fileId: string) => { width: number; scene?: Scene } | undefined,
  hide: string | null,
): Badge[] {
  const out: Badge[] = [];
  const seen = new Set<string>();
  const view = { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetX: st.offsetLeft - wrapRect.left, offsetY: st.offsetTop - wrapRect.top };
  for (const e of els) {
    if (e.isDeleted || e.opacity === 0 || (e.angle ?? 0) !== 0) continue;
    const blockId = blockIdOf(e);
    if (blockId === null) {
      if (!(e.type === 'text' && e.containerId) && shapeCode(e)) {
        const f = layoutFrame(e, { width: 1, origin: { x: 0, y: 0 } }, view);
        out.push({ blockId: '', node: e.id, label: shapeLabel(els, e), x: f.x + e.width * view.zoom, y: f.y });
      }
      continue;
    }
    if (e.type !== 'image' || blockId === hide || seen.has(blockId)) continue;
    const info = codeOf(blockId);
    const pic = pictureOf(e.fileId ?? '');
    if (!info || !pic?.scene?.handles || !(e.width > 0)) continue;
    seen.add(blockId);
    const f = layoutFrame(e, { width: pic.width, origin: { x: 0, y: 0 } }, view);
    for (const h of pic.scene.handles) {
      if (h.kind !== 'node' || !Object.hasOwn(info.nodes, h.id)) continue;
      out.push({ blockId, node: h.id, label: h.id, x: f.x + (h.x + h.w) * f.k, y: f.y + h.y * f.k });
    }
  }
  return out;
}

export const sameBadges = (a: readonly Badge[], b: readonly Badge[]) =>
  a.length === b.length && a.every((p, i) => p.blockId === b[i]!.blockId && p.node === b[i]!.node && p.label === b[i]!.label && p.x === b[i]!.x && p.y === b[i]!.y);

/**
 * Scroll offset for the code preview: a range that fits is centred; a taller one starts at its first line with a small
 * top margin. The margin grows smoothly from 0 to 16px past the fit boundary, so it never jumps by a whole margin.
 * `firstTop` is the first line's offset from the box's padding edge (scrollTop's frame), not its border edge.
 */
export function previewScrollTop({ firstTop, span, boxHeight }: { firstTop: number; span: number; boxHeight: number }): number {
  const margin = span <= boxHeight ? (boxHeight - span) / 2 : Math.min(16, span - boxHeight);
  return Math.max(0, firstTop - margin);
}
