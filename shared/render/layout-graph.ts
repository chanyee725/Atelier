// Cloud architecture and flowchart: ELK layered layout with groups as compound nodes.
// This file composes the scene (overrides, routes, labels, badges); the base layout and its helpers live in
// layout-graph-base, -measure, -order, -pack, -label, -route and -common. Re-exports keep the old import path.

import type { GraphChild, GraphDiagram, GraphGroup } from '../dsl/index.ts';
import { finishScene, round, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { textWidth } from './text.ts';
import { BADGE_FONT_SIZE, BADGE_FONT_WEIGHT, badgeRect } from './badge.ts';
import { sanitizeColor } from './theme.ts';
import { BLOCK_LAYOUT_VERSION } from './block-layout.ts';
import type { BlockLayout } from './block-layout.ts';
import { straightPorts } from './layout-routes.ts';
import { ROUTE_GAP, alongLine, routeAround } from './route-around.ts';
import type { Point, Scene, SceneBadge, SceneEdge, SceneHandle, SceneItem } from './scene.ts';
import { ZERO, isZero, sameShift } from './layout-graph-common.ts';
import type { Delta, GraphBase, GraphLayoutOptions, Rect } from './layout-graph-common.ts';
import { clipToShape, labelRect, placeLabel, snapToShape } from './layout-graph-label.ts';
import { CARD_INSET, CARD_RIGHT, DIVIDER_GAP, GROUP_PAD, SUBTITLE_GAP, textHeight } from './layout-graph-measure.ts';
import { EDGE_W, dividerSpans, growRect, obstacles, routeElbow, routeElbows, routeIntoGroup } from './layout-graph-route.ts';
import { graphBase } from './layout-graph-base.ts';

export { bandColumns, gridColumns, packGrid } from './layout-graph-pack.ts';
export { LABEL_SHIFT, placeLabel } from './layout-graph-label.ts';
export { runBand } from './layout-graph-measure.ts';
export type { GraphBase, GraphLayoutOptions } from './layout-graph-common.ts';
export { graphBase, placedBase } from './layout-graph-base.ts';
export type { PlacedSizes } from './layout-graph-base.ts';

/** Spacing between parallel edges' bends and end points when the router redraws them. */
const PARALLEL_GAP = 12;

/**
 * Apply `layout` to copies of the ELK rects: overridden nodes (and empty groups) move their centre,
 * groups with moved descendants refit inner-first. Overrides that do not match the current code
 * (unknown name, group with children, different parent, bad numbers, unknown `v`) are ignored.
 */
function placeRects(d: GraphDiagram, base: GraphBase, layout: BlockLayout | undefined): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [id, r] of base.rects) rects.set(id, { ...r });
  if (!layout || layout.v !== BLOCK_LAYOUT_VERSION || typeof layout.items !== 'object' || layout.items === null) return rects;

  let any = false;
  for (const id of Object.keys(layout.items)) {
    const it = layout.items[id];
    const r = rects.get(id);
    if (!it || !r || !Number.isFinite(it.cx) || !Number.isFinite(it.cy)) continue;
    const group = base.groups.get(id);
    if (group && group.group.children.length > 0) continue;
    if (it.parent !== (base.parent.get(id) ?? '')) continue;
    r.x = it.cx - r.w / 2;
    r.y = it.cy - r.h / 2;
    any = true;
  }
  if (!any) return rects;

  const deltaOf = (id: string): Delta => {
    const a = base.rects.get(id);
    const b = rects.get(id);
    return a && b ? { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h } : ZERO;
  };
  /** Refit `g` around its children; returns the deltas of its leaves (nodes and empty groups). */
  const fit = (g: GraphGroup): Delta[] => {
    if (g.children.length === 0) return [deltaOf(g.id)];
    const leaves: Delta[] = [];
    for (const c of g.children) leaves.push(...(c.kind === 'group' ? fit(c) : [deltaOf(c.id)]));
    if (leaves.every(isZero)) return leaves;
    const r = rects.get(g.id)!;
    const first = leaves[0]!;
    if (leaves.every((l) => sameShift(l, first))) {
      // Dragged as a whole: keep ELK's box, shifted.
      const b = base.rects.get(g.id)!;
      r.x = b.x + first.dx;
      r.y = b.y + first.dy;
      return leaves;
    }
    const geom = base.groups.get(g.id)!;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of g.children) {
      const cr = rects.get(c.id)!;
      x0 = Math.min(x0, cr.x);
      y0 = Math.min(y0, cr.y);
      x1 = Math.max(x1, cr.x + cr.w);
      y1 = Math.max(y1, cr.y + cr.h);
    }
    r.x = x0 - GROUP_PAD.side;
    r.y = y0 - geom.header;
    r.w = Math.max(x1 - x0 + GROUP_PAD.side * 2, geom.minW);
    r.h = Math.max(y1 - y0 + geom.header + GROUP_PAD.bottom, geom.header + 40);
    return leaves;
  };
  for (const c of d.children) if (c.kind === 'group') fit(c);
  return rects;
}

/** Paint the diagram from `base`, with `layout` overrides applied. Synchronous and fast (drag previews). */
export interface ComposeOptions {
  /**
   * A drag frame (#733): lines with a moved end take the quick old route instead of waiting for the
   * corridor router (tens of ms on a 100-node diagram); compose the drop without it to route them.
   */
  draft?: boolean;
}

export function composeGraph(d: GraphDiagram, base: GraphBase, layout?: BlockLayout, options: ComposeOptions = {}): Scene {
  const { nodes, groups } = base;
  const rects = placeRects(d, base, layout);
  const deltaOf = (id: string): Delta => {
    const a = base.rects.get(id);
    const b = rects.get(id);
    return a && b ? { dx: b.x - a.x, dy: b.y - a.y, dw: b.w - a.w, dh: b.h - a.h } : ZERO;
  };
  const isAncestor = (a: string, b: string): boolean => {
    for (let p = base.parent.get(b); p !== undefined; p = base.parent.get(p)) if (p === a) return true;
    return false;
  };

  const groupItems: SceneItem[] = [];
  const nodeItems: SceneItem[] = [];
  const edgeItems: SceneEdge[] = [];
  const labelItems: SceneItem[] = [];
  const handles: SceneHandle[] = [];
  const drawn = dividerSpans(d, base.nodes, base.parent, rects);
  const handle = (id: string, kind: 'node' | 'group'): void => {
    const r = drawn.get(id) ?? rects.get(id)!;
    handles.push({ id, kind, parent: base.parent.get(id) ?? '', x: r.x, y: r.y, w: r.w, h: r.h, moved: !isZero(deltaOf(id)) });
  };

  // Groups, outer first so inner boxes paint on top.
  const drawGroups = (list: GraphChild[]): void => {
    for (const c of list) {
      if (c.kind !== 'group') continue;
      const g = groups.get(c.id)!;
      const r = rects.get(c.id)!;
      handle(c.id, 'group');
      groupItems.push({ kind: 'box', id: c.id, role: 'group', shape: 'rectangle', x: r.x, y: r.y, w: r.w, h: r.h, paint: g.style.paint, shadow: false });
      let tx = r.x + 14;
      const midY = r.y + 11 + Math.max(g.label.h, g.iconSize) / 2;
      if (g.iconSize) {
        groupItems.push({ kind: 'icon', name: c.attrs.icon!, x: tx, y: midY - g.iconSize / 2, size: g.iconSize, paint: g.style.paint });
        tx += g.iconSize + 8;
      }
      groupItems.push(textItem(g.label.lines, tx, midY - g.label.h / 2, { size: g.label.size, font: g.style.typeface, anchor: 'start', weight: 400, tone: 'group', on: { ...g.style.paint, mode: g.style.paint.mode === 'bold' ? 'pastel' : g.style.paint.mode } }));
      drawGroups(c.children);
    }
  };
  drawGroups(d.children);

  const badgeItems: SceneBadge[] = [];
  for (const g of nodes.values()) {
    const r = drawn.get(g.node.id) ?? rects.get(g.node.id)!;
    handle(g.node.id, 'node');
    const { style, label } = g;
    const badge = g.node.attrs.badge?.trim();
    if (badge && !g.divider) {
      const box = badgeRect(r.x + r.w, r.y, textWidth(badge, BADGE_FONT_SIZE, 'clean', BADGE_FONT_WEIGHT === 600));
      badgeItems.push({ kind: 'badge', of: g.node.id, text: badge, ...box, color: sanitizeColor(g.node.attrs.badgeColor ?? g.node.attrs.color) });
    }
    if (g.divider) {
      // The line stops DIVIDER_GAP short of the label on both sides; an empty label leaves one unbroken line.
      const cy = round(r.y + r.h / 2);
      const half = label.lines.some((l) => l.trim()) ? label.w / 2 + DIVIDER_GAP : 0;
      const mid = r.x + r.w / 2;
      const line = (x0: number, x1: number): SceneItem => ({ kind: 'line', points: [{ x: x0, y: cy }, { x: x1, y: cy }], dashed: false, tone: 'muted', width: EDGE_W });
      if (half) {
        nodeItems.push(line(r.x, mid - half), line(mid + half, r.x + r.w));
        nodeItems.push(textItem(label.lines, mid, cy - label.h / 2, { size: label.size, font: style.typeface, tone: 'muted' }));
      } else nodeItems.push(line(r.x, r.x + r.w));
      continue;
    }
    const { sub } = g;
    // The subtitle is muted, kept readable on the node's fill (svg.ts); on a bold fill it takes the contrast colour.
    const subItem = (x: number, y: number, anchor: 'start' | 'middle', on?: ElementStyle['paint']): SceneItem =>
      textItem(sub!.lines, x, y, { size: sub!.size, font: style.typeface, anchor, tone: 'muted', ...(on ? { on } : {}) });
    if (g.iconOnly) {
      nodeItems.push({ kind: 'icon', name: g.icon!, x: r.x + r.w / 2 - g.iconSize / 2, y: r.y, size: g.iconSize, paint: style.paint });
      nodeItems.push(textItem(label.lines, r.x + r.w / 2, r.y + g.iconSize + 6, { size: label.size, font: style.typeface }));
      if (sub) nodeItems.push(subItem(r.x + r.w / 2, r.y + g.iconSize + 6 + label.h + SUBTITLE_GAP, 'middle'));
      continue;
    }
    nodeItems.push({ kind: 'box', id: g.node.id, role: 'node', shape: g.shape, x: r.x, y: r.y, w: r.w, h: r.h, paint: style.paint, shadow: style.styleMode !== 'plain' && style.paint.mode !== 'outline' });
    const cy = g.shape === 'triangle' ? r.y + r.h * 0.64 : g.shape === 'cylinder' ? r.y + r.h / 2 + 5 : r.y + r.h / 2;
    const top = cy - textHeight(label, sub) / 2;
    const subY = top + label.h + SUBTITLE_GAP;
    if (g.card) {
      // Box card: icon at the left edge, title and subtitle centred in the room right of it.
      const ix = r.x + CARD_INSET;
      nodeItems.push({ kind: 'icon', name: g.icon!, x: ix, y: cy - g.iconSize / 2, size: g.iconSize, paint: style.paint, inside: true });
      const tx = (ix + g.iconSize + 8 + r.x + r.w - CARD_RIGHT) / 2;
      nodeItems.push(textItem(label.lines, tx, top, { size: label.size, font: style.typeface, on: style.paint }));
      if (sub) nodeItems.push(subItem(tx, subY, 'middle', style.paint));
      continue;
    }
    const contentW = Math.max(label.w, sub?.w ?? 0) + (g.iconSize ? g.iconSize + 8 : 0);
    let x = r.x + r.w / 2 - contentW / 2;
    if (g.iconSize) {
      nodeItems.push({ kind: 'icon', name: g.icon!, x, y: cy - g.iconSize / 2, size: g.iconSize, paint: style.paint, inside: true });
      x += g.iconSize + 8;
    }
    const anchor = g.iconSize ? 'start' : 'middle';
    const tx = g.iconSize ? x : r.x + r.w / 2;
    nodeItems.push(textItem(label.lines, tx, top, { size: label.size, font: style.typeface, anchor, on: style.paint }));
    if (sub) nodeItems.push(subItem(tx, subY, anchor, style.paint));
  }

  // Spec §1.7: straight connectors join side ports dealt out at (i + 1) / (n + 1), as soft diagonal lines.
  const straight = base.edges.filter((be) => !be.forcedElbow && be.style.connectorStyle === 'straight');
  const ports = straightPorts(rects, straight.map((be) => be.edge));
  const portOf = new Map(straight.map((be, i) => [be, ports[i]!]));

  const nodeRects = [...nodes.keys()].map((id) => rects.get(id)!).filter(Boolean);
  const nodeIds = [...nodes.keys()];
  /** Each node's obstacles as drawn: its box, or for a divider spanning its row only its label (lazy). */
  let blocksOf: Map<string, Rect[]> | undefined;
  /** Whether `points` runs through a node other than `from` and `to` (after a drag, #255). */
  const cutsOthers = (points: Point[], from: string, to: string): boolean => {
    blocksOf ??= new Map(nodeIds.map((id) => [id, obstacles([id], nodes, rects, drawn).blocks]));
    for (const [id, blocks] of blocksOf) {
      if (id === from || id === to) continue;
      for (const r of blocks) {
        for (let k = 1; k < points.length; k++) {
          const p = points[k - 1]!;
          const q = points[k]!;
          if (Math.max(p.x, q.x) > r.x + 0.5 && Math.min(p.x, q.x) < r.x + r.w - 0.5 && Math.max(p.y, q.y) > r.y + 0.5 && Math.min(p.y, q.y) < r.y + r.h - 0.5) return true;
        }
      }
    }
    return false;
  };
  /** Whether an orthogonal `points` runs along one of `lines` (crossing is fine). */
  const runsAlong = (points: Point[], lines: Point[][]): boolean => points.some((q, k) => k > 0 && alongLine(lines, points[k - 1]!, q));
  /**
   * Routes already known when an edge is rerouted: those drawn so far, and the base routes of edges not
   * drawn yet whose ends did not move. A reroute keeps off them (never along them).
   */
  const knownLines = (id: string): Point[][] => {
    const out = new Map<string, Point[]>();
    for (const o of base.edges) if (isZero(deltaOf(o.edge.from)) && isZero(deltaOf(o.edge.to))) out.set(o.edge.id, o.points);
    for (const o of edgeItems) out.set(o.id, o.points);
    out.delete(id);
    return [...out.values()];
  };
  /**
   * A route around the other nodes for an edge whose rerouted elbow cuts one (#255): first near its two
   * ends, then across the whole picture, kept off `lines`; last, allowed along them. Undefined when there
   * is none (the elbow stays).
   */
  const detour = (from: string, to: string, lines: Point[][]): Point[] | undefined => {
    const a = rects.get(from)!;
    const b = rects.get(to)!;
    const ids = nodeIds.filter((id) => id !== from && id !== to);
    const { blocks, bands } = obstacles(ids, nodes, rects, drawn);
    const span = (rs: Rect[]): Rect => {
      const x0 = Math.min(...rs.map((r) => r.x));
      const y0 = Math.min(...rs.map((r) => r.y));
      return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
    };
    const meets = (r: Rect, o: Rect): boolean => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h;
    const near = growRect(span([a, b]), 4 * ROUTE_GAP);
    const all = growRect(span([...rects.values()]), 4 * ROUTE_GAP);
    const box = (line: Point[]): Rect => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of line) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const boxes = lines.map(box);
    for (const [bounds, keepOff] of [[near, true], [all, true], [all, false]] as const) {
      const along = keepOff ? lines.filter((_, k) => meets(boxes[k]!, bounds)) : [];
      const route = routeAround(a, b, blocks.filter((r) => meets(r, bounds)), bands.filter((r) => meets(r, bounds)), bounds, along);
      if (route) return route.map((p) => ({ x: round(p.x), y: round(p.y) }));
    }
    return undefined;
  };
  const placedLabels: Rect[] = [];
  // Labels are placed once every route is known, so none lands on a line that is not its own.
  const pendingLabels: { edge: SceneEdge; label: Label; style: ElementStyle }[] = [];

  // #733: elbow lines and their labels come from the eraser-diagrams corridor router, on the boxes as
  // drawn (moved ones included). Self loops, and edges it cannot solve, keep the routes below.
  const routed = routeElbows(d, base, rects, drawn, deltaOf, options.draft === true);

  for (const be of base.edges) {
    const { edge: e, style } = be;
    const route = be.forcedElbow ? 'elbow' : style.connectorStyle;
    const a = rects.get(e.from)!;
    const b = rects.get(e.to)!;
    let points: Point[];
    const port = portOf.get(be);
    if (port) {
      const p0 = clipToShape(nodes.get(e.from)?.shape, a, port[0]);
      const p1 = clipToShape(nodes.get(e.to)?.shape, b, port[1]);
      points = [p0, p1].map((p) => ({ x: round(p.x), y: round(p.y) }));
    } else if (route !== 'elbow') {
      const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
      const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const p0 = clipToShape(nodes.get(e.from)?.shape, a, bc);
      const p1 = clipToShape(nodes.get(e.to)?.shape, b, ac);
      points = [p0, p1].map((p) => ({ x: round(p.x), y: round(p.y) }));
    } else if (routed.has(e.id)) {
      points = routed.get(e.id)!.points.map((p) => ({ x: round(p.x), y: round(p.y) }));
    } else {
      const da = deltaOf(e.from);
      const db = deltaOf(e.to);
      const offset = (be.pairIndex - (be.pairSize - 1) / 2) * PARALLEL_GAP;
      if (isZero(da) && isZero(db)) points = be.points.map((p) => ({ ...p }));
      else if (e.from === e.to || sameShift(da, db)) points = be.points.map((p) => ({ x: round(p.x + da.dx), y: round(p.y + da.dy) }));
      else if (isAncestor(e.from, e.to)) points = routeIntoGroup(a, groups.get(e.from)!.header, b, offset);
      else if (isAncestor(e.to, e.from)) points = routeIntoGroup(b, groups.get(e.to)!.header, a, offset).reverse();
      else {
        points = routeElbow(a, b, offset);
        if (cutsOthers(points, e.from, e.to)) {
          // The other pair of sides first (cheap), when the boxes leave room between them on that axis.
          const horizontal = Math.abs(b.x + b.w / 2 - a.x - a.w / 2) >= Math.abs(b.y + b.h / 2 - a.y - a.h / 2);
          const room = horizontal ? b.y >= a.y + a.h + 2 * ROUTE_GAP || a.y >= b.y + b.h + 2 * ROUTE_GAP : b.x >= a.x + a.w + 2 * ROUTE_GAP || a.x >= b.x + b.w + 2 * ROUTE_GAP;
          const flipped = room ? routeElbow(a, b, offset, true) : undefined;
          const lines = knownLines(e.id);
          const around = flipped && !cutsOthers(flipped, e.from, e.to) && !runsAlong(flipped, lines) ? flipped : detour(e.from, e.to, lines);
          if (around) points = around;
        }
      }
      if (points.length >= 2 && e.from !== e.to) {
        const sa = nodes.get(e.from)?.shape;
        const sb = nodes.get(e.to)?.shape;
        if (sa) points[0] = snapToShape(sa, a, points[0]!, points[1]!);
        if (sb) points[points.length - 1] = snapToShape(sb, b, points[points.length - 1]!, points[points.length - 2]!);
      }
    }
    const edge: SceneEdge = {
      kind: 'edge',
      id: e.id,
      points,
      route,
      dashed: e.lineStyle === 'dashed',
      start: e.startArrow ? 'arrow' : 'none',
      end: e.endArrow ? 'arrow' : 'none',
      color: style.paint.color,
      from: e.from,
      to: e.to,
    };
    if (port) edge.soft = true;
    edgeItems.push(edge);
    const at = be.label ? routed.get(e.id)?.label : undefined;
    if (be.label && at) {
      const c = { x: round(at.x), y: round(at.y) };
      placedLabels.push(labelRect(c, be.label));
      labelItems.push(textItem(be.label.lines, c.x, c.y - be.label.h / 2, { size: be.label.size, font: style.typeface, plate: true, color: style.paint.color, tone: 'muted' }));
    } else if (be.label) pendingLabels.push({ edge, label: be.label, style });
  }

  for (const { edge, label, style } of pendingLabels) {
    const others = edgeItems.filter((o) => o !== edge).map((o) => o.points);
    const { x: cx, y: cy } = placeLabel(edge.points, edge.route, label, placedLabels, nodeRects, others);
    labelItems.push(textItem(label.lines, cx, cy - label.h / 2, { size: label.size, font: style.typeface, plate: true, color: style.paint.color, tone: 'muted' }));
  }

  const scene = finishScene(d.type, d, [...groupItems, ...edgeItems, ...nodeItems, ...labelItems, ...badgeItems]);
  const o = scene.origin ?? { x: 0, y: 0 };
  scene.handles = handles.map((h) => ({ ...h, x: round(h.x + o.x), y: round(h.y + o.y), w: round(h.w), h: round(h.h) }));
  return scene;
}

/** ELK layout with optional overrides: `composeGraph(d, await graphBase(d), layout)`. */
export async function layoutGraph(d: GraphDiagram, layout?: BlockLayout, options: GraphLayoutOptions = {}): Promise<Scene> {
  return composeGraph(d, await graphBase(d, options), layout);
}
