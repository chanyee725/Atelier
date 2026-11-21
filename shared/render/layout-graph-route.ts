// Edge routes for the graph layout: around divider rows, elbows between boxes and into groups, and the
// corridor router pass (with its per-base cache) that redraws elbow edges around the drawn boxes.

import type { GraphDiagram } from '../dsl/index.ts';
import { round } from './common.ts';
import { PLATE_PAD } from './text.ts';
import { ROUTE_GAP, routeAround } from './route-around.ts';
import { routeOrthogonal } from './route-eraser.ts';
import type { PartialRoute, RoutedEdge, RouterBox } from './route-eraser.ts';
import type { Point } from './scene.ts';
import { isZero } from './layout-graph-common.ts';
import type { BaseEdge, Delta, GraphBase, Rect } from './layout-graph-common.ts';
import { DIVIDER_GAP, GROUP_PAD } from './layout-graph-measure.ts';
import type { NodeGeom } from './layout-graph-measure.ts';

/**
 * What a route around boxes must avoid among `ids`: other boxes are blocks; a divider that spans its row is
 * a band (cross it, never run along it) plus a block for its label.
 */
export function obstacles(
  ids: Iterable<string>,
  nodes: ReadonlyMap<string, NodeGeom>,
  rects: ReadonlyMap<string, Rect>,
  spans: ReadonlyMap<string, Rect>,
): { blocks: Rect[]; bands: Rect[] } {
  const blocks: Rect[] = [];
  const bands: Rect[] = [];
  for (const id of ids) {
    const r = rects.get(id);
    if (!r) continue;
    const span = spans.get(id);
    const g = nodes.get(id);
    if (!span || !g) {
      blocks.push(r);
      continue;
    }
    bands.push(span);
    if (g.label.lines.some((l) => l.trim())) {
      const half = g.label.w / 2 + DIVIDER_GAP;
      blocks.push({ x: span.x + span.w / 2 - half, y: span.y + span.h / 2 - g.label.h / 2, w: half * 2, h: g.label.h });
    }
  }
  return { blocks, bands };
}

export const growRect = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

/**
 * Real routes for the edges that cross a divider row (#244): around the other nodes and groups of the
 * rows' scope and the divider labels, never along a divider line, inside the group when the rows are in
 * one. Edges are routed one after the other, each kept off the routes already found (never along them), so
 * they run on their own tracks; crossing edges not routed yet do not count (their placeholders are about
 * to move). When nothing fits (#255): retry with room for a track per crossing edge outside the boxes,
 * then allow running along other edges, then both (a group's rows then leave the group). Running along a
 * line or outside the group beats running through nodes.
 */
export function routeAcross(
  d: GraphDiagram,
  nodes: ReadonlyMap<string, NodeGeom>,
  parent: ReadonlyMap<string, string | undefined>,
  rects: ReadonlyMap<string, Rect>,
  list: readonly BaseEdge[],
  others: readonly BaseEdge[],
  scopeOf: ReadonlyMap<string, string | undefined>,
  headerOf: (group: string) => number,
): void {
  if (!list.length) return;
  const spans = dividerSpans(d, nodes, parent, rects);
  const within = (scope: string | undefined, id: string): boolean => {
    if (scope === undefined) return true;
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) if (p === scope) return true;
    return false;
  };
  const chain = (id: string): Set<string> => {
    const out = new Set([id]);
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.add(p);
    return out;
  };
  const all = [...rects.values()];
  const x0 = Math.min(...all.map((r) => r.x)) - 2 * ROUTE_GAP;
  const y0 = Math.min(...all.map((r) => r.y)) - 2 * ROUTE_GAP;
  const x1 = Math.max(...all.map((r) => r.x + r.w)) + 2 * ROUTE_GAP;
  const y1 = Math.max(...all.map((r) => r.y + r.h)) + 2 * ROUTE_GAP;
  const root: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  // One outside track per crossing edge on every side is always enough room.
  const room = (list.length + 1) * ROUTE_GAP;
  // Crossing edges not routed yet: their placeholder elbows sit on the tracks the others need.
  const waiting = new Set(list);
  for (const be of list) {
    waiting.delete(be);
    const { from, to } = be.edge;
    if (from === to) continue;
    const scope = scopeOf.get(be.edge.id);
    const skip = new Set([...chain(from), ...chain(to)]);
    const { blocks, bands } = obstacles([...rects.keys()].filter((id) => !skip.has(id) && within(scope, id)), nodes, rects, spans);
    let bounds = root;
    if (scope !== undefined) {
      const gr = rects.get(scope)!;
      const header = headerOf(scope);
      bounds = { x: gr.x + 4, y: gr.y + header - ROUTE_GAP, w: gr.w - 8, h: gr.h - header + ROUTE_GAP - 4 };
    }
    const lines = others.filter((o) => o !== be && !waiting.has(o)).map((o) => o.points);
    const wide = growRect(bounds, room);
    const tries: [Rect, Point[][]][] = scope === undefined
      ? [[bounds, lines], [wide, lines], [wide, []]]
      : [[bounds, lines], [bounds, []], [wide, lines], [wide, []]];
    for (const [box, along] of tries) {
      const route = routeAround(rects.get(from)!, rects.get(to)!, blocks, bands, box, along);
      if (!route) continue;
      be.points = route.map((p) => ({ x: round(p.x), y: round(p.y) }));
      break;
    }
  }
}
/** Drop repeated points and middle points of straight runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = { x: round(p.x), y: round(p.y) };
    const last = out[out.length - 1];
    if (last && last.x === q.x && last.y === q.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === q.x) || (prev.y === last.y && last.y === q.y))) out.pop();
    out.push(q);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Orthogonal route for an edge whose ends moved (no obstacle avoidance). Leaves `a` from the side facing
 * `b`: east/west with H-V-H when the centres differ more horizontally, else north/south with V-H-V.
 * `offset` spreads parallel edges apart. `flip` takes the other pair of sides (the caller checks there is
 * room between the boxes on that axis).
 */
export function routeElbow(a: Rect, b: Rect, offset: number, flip = false): Point[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if ((Math.abs(dx) >= Math.abs(dy)) !== flip) {
    const s = dx >= 0 ? 1 : -1;
    const p0 = { x: ac.x + (s * a.w) / 2, y: ac.y + clamp(offset, -a.h / 2 + 4, a.h / 2 - 4) };
    const p1 = { x: bc.x - (s * b.w) / 2, y: bc.y + clamp(offset, -b.h / 2 + 4, b.h / 2 - 4) };
    const mx = (p0.x + p1.x) / 2 + offset;
    return simplify([p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1]);
  }
  const s = dy >= 0 ? 1 : -1;
  const p0 = { x: ac.x + clamp(offset, -a.w / 2 + 4, a.w / 2 - 4), y: ac.y + (s * a.h) / 2 };
  const p1 = { x: bc.x + clamp(offset, -b.w / 2 + 4, b.w / 2 - 4), y: bc.y - (s * b.h) / 2 };
  const my = (p0.y + p1.y) / 2 + offset;
  return simplify([p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1]);
}

/**
 * Route from a group to a node inside it (`outer` contains `inner`): down from just under the header
 * to the node's top (V-H-V), or, when the node sits right under the header, across from the nearer wall.
 */
export function routeIntoGroup(outer: Rect, header: number, inner: Rect, offset: number): Point[] {
  const ic = { x: inner.x + inner.w / 2 + clamp(offset, -inner.w / 2 + 4, inner.w / 2 - 4), y: inner.y + inner.h / 2 };
  const top = outer.y + header;
  if (inner.y - top >= 16) {
    const p0 = { x: outer.x + outer.w / 2 + offset, y: top };
    const my = (top + inner.y) / 2;
    return simplify([p0, { x: p0.x, y: my }, { x: ic.x, y: my }, { x: ic.x, y: inner.y }]);
  }
  const y = inner.y + inner.h / 2 + clamp(offset, -inner.h / 2 + 4, inner.h / 2 - 4);
  const left = ic.x < outer.x + outer.w / 2;
  return simplify([{ x: left ? outer.x : outer.x + outer.w, y }, { x: left ? inner.x : inner.x + inner.w, y }]);
}
/** Router results for one set of drawn boxes, keyed by their geometry. */
interface RouteSet {
  sig: string;
  routes: Map<string, RoutedEdge>;
}

/**
 * Per base: `home` = routes on the unmoved boxes (a drag reroutes only the edges whose boxes moved, the
 * rest keep these), `last` = the latest moved picture (the drop composes the same layout more than once).
 * Both are keyed by the box geometry they were routed on, so a different layout never reads stale routes.
 */
const routeCache = new WeakMap<GraphBase, { home?: RouteSet; last?: RouteSet }>();

function routerBoxes(base: GraphBase, rects: ReadonlyMap<string, Rect>, drawn: ReadonlyMap<string, Rect>): RouterBox[] {
  const boxes: RouterBox[] = [];
  for (const [id, g] of base.groups) {
    const r = rects.get(id);
    if (r) boxes.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, parent: base.parent.get(id), container: { header: g.header } });
  }
  for (const [id, g] of base.nodes) {
    const r = drawn.get(id) ?? rects.get(id);
    if (r) boxes.push({ id, x: r.x, y: r.y, w: r.w, h: r.h, parent: base.parent.get(id), shape: g.divider ? undefined : g.shape });
  }
  return boxes;
}

const boxSig = (boxes: readonly RouterBox[]): string => boxes.map((b) => `${b.id}\u0000${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join('\u0001');

/**
 * Elbow routes and label centres from the eraser-diagrams router (#733) for every elbow edge but self
 * loops. Groups are containers (their header blocks lines); nodes are obstacles at their drawn box.
 * `draft` (a drag frame): edges with a moved end are left to the quick old route and the rest keep their
 * unmoved routes, so a frame never waits for the router; the drop composes without `draft` and routes them.
 */
export function routeElbows(d: GraphDiagram, base: GraphBase, rects: ReadonlyMap<string, Rect>, drawn: ReadonlyMap<string, Rect>, deltaOf: (id: string) => Delta, draft: boolean): Map<string, RoutedEdge> {
  const moved = new Set([...base.nodes.keys(), ...base.groups.keys()].filter((id) => !isZero(deltaOf(id))));
  const edges = base.edges
    .filter((be) => !be.ownRoute && (be.forcedElbow || be.style.connectorStyle === 'elbow') && be.edge.from !== be.edge.to)
    .map((be) => ({
      id: be.edge.id,
      from: be.edge.from,
      to: be.edge.to,
      startArrow: !!be.edge.startArrow,
      endArrow: !!be.edge.endArrow,
      ...(be.label ? { label: { w: be.label.w + PLATE_PAD * 2, h: be.label.h + 4 } } : {}),
    }));
  const cache = routeCache.get(base) ?? {};
  routeCache.set(base, cache);
  const solve = (boxes: RouterBox[], rs: ReadonlyMap<string, Rect>, dr: ReadonlyMap<string, Rect>, list: typeof edges, partial?: PartialRoute): Map<string, RoutedEdge> => {
    const out = routeOrthogonal(boxes, list, partial);
    // A line between two members of one group stays inside it; one that left falls back to the old route.
    for (const e of list) {
      const r = out.get(e.id);
      if (r && (!insideCommonGroup(base, rs, e.from, e.to, r.points) || !cleanRoute(base, dr, rs, e.from, e.to, r.points))) out.delete(e.id);
    }
    return out;
  };

  const homeDrawn = moved.size === 0 ? drawn : dividerSpans(d, base.nodes, base.parent, base.rects);
  const homeBoxes = routerBoxes(base, base.rects, homeDrawn);
  const homeSig = boxSig(homeBoxes);
  if (cache.home?.sig !== homeSig) cache.home = { sig: homeSig, routes: solve(homeBoxes, base.rects, homeDrawn, edges) };
  const home = cache.home.routes;
  if (moved.size === 0) return home;

  const only = new Set(edges.filter((e) => moved.has(e.from) || moved.has(e.to)).map((e) => e.id));
  if (draft) return new Map([...home].filter(([id]) => !only.has(id)));

  const boxes = routerBoxes(base, rects, drawn);
  const sig = boxSig(boxes);
  if (cache.last?.sig === sig) return cache.last.routes;
  // An edge reroutes when one of its ends moved or was refitted (a group dragged as a whole moves every
  // child too); the others keep their routes and the rerouted ones keep off them. An unmoved edge the
  // router had no clean line for stays on the old route rather than being solved afresh mid-drag.
  const routes = solve(boxes, rects, drawn, edges.filter((e) => only.has(e.id) || home.has(e.id)), { previous: home, only });
  cache.last = { sig, routes };
  return routes;
}

/**
 * A router line that jogs by a few pixels (parallel lanes squeezed between two ports), grazes a node it
 * does not connect to, or winds round with more than 3 bends (the old route never needs more) reads as a
 * glitch: such a line falls back to the old route.
 */
function cleanRoute(base: GraphBase, drawn: ReadonlyMap<string, Rect>, rects: ReadonlyMap<string, Rect>, from: string, to: string, points: readonly Point[]): boolean {
  const JOG = 4;
  const NEAR = 3;
  const MAX_BENDS = 3;
  if (points.length - 2 > MAX_BENDS) return false;
  for (let i = 1; i < points.length - 1; i++) {
    const len = Math.abs(points[i]!.x - points[i - 1]!.x) + Math.abs(points[i]!.y - points[i - 1]!.y);
    if (len > 0 && len <= JOG && i > 1 && i < points.length - 1) return false;
  }
  for (const id of base.nodes.keys()) {
    if (id === from || id === to) continue;
    const r = drawn.get(id) ?? rects.get(id);
    if (!r) continue;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (Math.max(a.x, b.x) > r.x - NEAR && Math.min(a.x, b.x) < r.x + r.w + NEAR && Math.max(a.y, b.y) > r.y - NEAR && Math.min(a.y, b.y) < r.y + r.h + NEAR) return false;
    }
  }
  return true;
}

/** Whether the router line is usable: strictly inside the innermost group that holds both ends (always true at the root), and not a group-to-member edge. */
function insideCommonGroup(base: GraphBase, rects: ReadonlyMap<string, Rect>, from: string, to: string, points: readonly Point[]): boolean {
  const chain = (id: string): string[] => {
    const up: string[] = [];
    for (let p = base.parent.get(id); p !== undefined && up.length < 64; p = base.parent.get(p)) up.push(p);
    return up;
  };
  const toUp = chain(to);
  const fromUp = chain(from);
  // A group and one of its own members: the old route draws it inside the group.
  if (toUp.includes(from) || fromUp.includes(to)) return false;
  const shared = new Set(toUp);
  const common = fromUp.find((g) => shared.has(g));
  const r = common === undefined ? undefined : rects.get(common);
  if (!r) return true;
  return points.every((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
}

/** Connector width (svg.ts EDGE_W): dividers draw at the same 1.3px (spec §2.1). */
export const EDGE_W = 1.3;

/**
 * Where each divider draws. A divider with no connections that shares no rows with its siblings (nothing
 * beside it) runs the full width of its parent: the group's inside, or the span of the root elements.
 * Otherwise it keeps its own box.
 */
export function dividerSpans(
  d: GraphDiagram,
  nodes: ReadonlyMap<string, NodeGeom>,
  parent: ReadonlyMap<string, string | undefined>,
  rects: ReadonlyMap<string, Rect>,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const linked = new Set(d.edges.flatMap((e) => [e.from, e.to]));
  for (const g of nodes.values()) {
    const id = g.node.id;
    const r = rects.get(id);
    if (!g.divider || !r || linked.has(id)) continue;
    const p = parent.get(id);
    const siblings = [...parent.entries()].filter(([o, q]) => q === p && o !== id).map(([o]) => rects.get(o)).filter((s): s is Rect => !!s);
    if (siblings.some((s) => s.y < r.y + r.h && r.y < s.y + s.h)) continue;
    let x0: number;
    let x1: number;
    if (p !== undefined) {
      const pr = rects.get(p)!;
      x0 = pr.x + GROUP_PAD.side;
      x1 = pr.x + pr.w - GROUP_PAD.side;
    } else {
      if (siblings.length === 0) continue;
      x0 = Math.min(...siblings.map((s) => s.x));
      x1 = Math.max(...siblings.map((s) => s.x + s.w));
    }
    x0 = Math.min(x0, r.x);
    x1 = Math.max(x1, r.x + r.w);
    out.set(id, { x: x0, y: r.y, w: x1 - x0, h: r.h });
  }
  return out;
}
