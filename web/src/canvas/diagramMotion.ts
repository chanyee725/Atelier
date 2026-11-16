// How an outside code change to a diagram is animated (E520, #543): the old and the new laid-out scene are cut into
// per-element groups (a node and its texts and icons, an edge and its label) and compared. New groups fade and scale
// in, groups that only moved glide, vanished groups fade out, changed ones cross-fade. Pure (no DOM): the markup is
// built here, `playMorph` (morphPlay.ts) runs it. Used on the canvas and in the document's diagram preview.
import { sceneToSvg, type Scene, type SceneItem, type SvgOptions } from '../../../shared/render/index.ts';

export type MorphState = 'same' | 'enter' | 'exit' | 'move' | 'change-in' | 'change-out';

export interface Group {
  key: string;
  items: SceneItem[];
}

export interface MorphEntry {
  key: string;
  state: MorphState;
  /** Items to paint: the new ones, or the old ones for `exit` / `change-out`. */
  items: SceneItem[];
  /** For `move`: where it comes from relative to where it ends (old − new). */
  dx?: number;
  dy?: number;
}

/** Cut a scene into element groups, in paint order. Texts, icons and badges belong to the box or edge before them. */
export function groupScene(scene: Pick<Scene, 'items'>): Group[] {
  const groups: Group[] = [];
  const used = new Map<string, number>();
  const uniq = (k: string) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return n ? `${k}#${n}` : k;
  };
  let cur: Group | null = null;
  scene.items.forEach((it, i) => {
    let key: string | null = null;
    if (it.kind === 'box') key = it.id ? `b:${it.id}` : `o:box:${i}`;
    else if (it.kind === 'edge') key = it.from && it.to ? `e:${it.from}>${it.to}` : `e:${it.id}`;
    else if (it.kind === 'line') key = `o:line:${i}`;
    if (key !== null) {
      // A box without an id (an entity header, a column) keeps joining the element it belongs to.
      if (it.kind === 'box' && !it.id && cur) {
        cur.items.push(it);
        return;
      }
      cur = { key: uniq(key), items: [it] };
      groups.push(cur);
    } else if (cur) cur.items.push(it);
    else {
      cur = { key: uniq(`o:${it.kind}:${i}`), items: [it] };
      groups.push(cur);
    }
  });
  return groups;
}

export function translateItem(it: SceneItem, dx: number, dy: number): SceneItem {
  if (it.kind === 'edge' || it.kind === 'line') return { ...it, points: it.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return { ...it, x: it.x + dx, y: it.y + dy };
}

/** Top-left of a group's first item: the point a move is measured at. */
export function anchorOf(g: Group): { x: number; y: number } {
  const it = g.items[0]!;
  if (it.kind === 'edge' || it.kind === 'line') return it.points[0] ?? { x: 0, y: 0 };
  return { x: it.x, y: it.y };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const sigOf = (items: SceneItem[]) => JSON.stringify(items, (_k, v) => (typeof v === 'number' ? r2(v) : v));
const relSig = (g: Group) => {
  const a = anchorOf(g);
  return sigOf(g.items.map((it) => translateItem(it, -a.x, -a.y)));
};

/** Compare two scenes. Entries are in paint order of the new scene; vanished groups come first (they sit at the back). */
export function diffScenes(prev: Pick<Scene, 'items'>, next: Pick<Scene, 'items'>): MorphEntry[] {
  const before = new Map(groupScene(prev).map((g) => [g.key, g]));
  const out: MorphEntry[] = [];
  const keep = new Set<string>();
  const after = groupScene(next);
  for (const g of after) {
    const old = before.get(g.key);
    if (!old) {
      out.push({ key: g.key, state: 'enter', items: g.items });
      continue;
    }
    keep.add(g.key);
    const a = anchorOf(old);
    const b = anchorOf(g);
    const same = relSig(old) === relSig(g);
    if (same && r2(a.x) === r2(b.x) && r2(a.y) === r2(b.y)) out.push({ key: g.key, state: 'same', items: g.items });
    else if (same) out.push({ key: g.key, state: 'move', items: g.items, dx: a.x - b.x, dy: a.y - b.y });
    else {
      out.push({ key: `${g.key}~old`, state: 'change-out', items: old.items });
      out.push({ key: g.key, state: 'change-in', items: g.items });
    }
  }
  const gone: MorphEntry[] = [];
  for (const [k, g] of before) if (!keep.has(k)) gone.push({ key: k, state: 'exit', items: g.items });
  return [...gone, ...out];
}

/** Whether anything would visibly animate. */
export const hasMotion = (entries: readonly MorphEntry[]) => entries.some((e) => e.state !== 'same');

const stripSvg = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<style>[\s\S]*?<\/style>/g, '');

export interface MorphMarkup {
  width: number;
  height: number;
  /** `<svg>` markup, each group wrapped in `<g data-m="state">`. */
  svg: string;
  entries: MorphEntry[];
}

/**
 * The markup that animates `prev` into `next`. Fonts are the page's (the markup is inlined in the DOM, not an <img>).
 * Null when nothing would move.
 */
export function morphMarkup(prev: Scene, next: Scene, options: SvgOptions = {}): MorphMarkup | null {
  const entries = diffScenes(prev, next);
  if (!hasMotion(entries)) return null;
  const width = Math.max(prev.width, next.width);
  const height = Math.max(prev.height, next.height);
  const body = entries
    .map((e) => {
      const inner = stripSvg(sceneToSvg({ ...next, items: e.items }, options));
      const extra = e.state === 'move' ? ` data-dx="${r2(e.dx ?? 0)}" data-dy="${r2(e.dy ?? 0)}"` : '';
      return `<g data-m="${e.state}"${extra}>${inner}</g>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" text-rendering="geometricPrecision" data-morph="">${body}</svg>`;
  return { width, height, svg, entries };
}
