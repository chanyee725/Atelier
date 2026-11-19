// Edge routing and label placement through the vendored eraser-diagrams corridor router (MIT, #733).
// Node and group boxes are input; the router only draws the lines between them and places their labels,
// so node positions (ELK's or the ones the user moved) never change here.

import { LayoutManager, routeConnections } from '../vendor/eraser-layout/layout/index.ts';
import type { LayoutConnection, LayoutEntity, NewConnection, OutlineDescriptor } from '../vendor/eraser-layout/layout/index.ts';
import type { Point, ShapeKind } from './scene.ts';

export interface RouterBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Enclosing group, `undefined` at the root. */
  parent?: string;
  /** Groups: their children route inside, their header blocks lines. */
  container?: { header: number };
  shape?: ShapeKind;
}

export interface RouterEdge {
  id: string;
  from: string;
  to: string;
  startArrow: boolean;
  endArrow: boolean;
  /** Label plate size; the router places it clear of nodes, lines and other labels. */
  label?: { w: number; h: number };
}

export interface RoutedEdge {
  points: Point[];
  /** Centre of the placed label plate, when the edge has a label. */
  label?: Point;
}

/**
 * Repair runs to completion: a wall-clock budget would make the same input route differently under
 * load, and a render must be a pure function of the code and the moved positions (as upstream's
 * render package does).
 */
const REPAIR = false as const;

/** Drawn boundary for endpoint attachment, in the router's normalized 0–100 frame. */
function outlineOf(shape: ShapeKind | undefined): OutlineDescriptor | undefined {
  switch (shape) {
    case 'circle':
    case 'ellipse':
      return { kind: 'ellipse' };
    case 'diamond':
      return { kind: 'polygon', vertices: [[50, 0], [100, 50], [50, 100], [0, 50]] };
    case 'hexagon':
      return { kind: 'polygon', vertices: [[20, 0], [80, 0], [100, 50], [80, 100], [20, 100], [0, 50]] };
    default:
      return undefined;
  }
}

/** Partial routing: keep `previous` routes and reroute only the edges in `only` (upstream's drag mode). */
export interface PartialRoute {
  previous: ReadonlyMap<string, RoutedEdge>;
  only: ReadonlySet<string>;
}

/**
 * Orthogonal routes for `edges` between `boxes`. Edges the router could not solve (direct fallback
 * geometry) and edges whose ends are missing are left out: the caller keeps its own route for them.
 * With `partial`, edges outside `partial.only` that have a previous route keep it as is (the rerouted
 * ones keep off it); the rest are routed.
 */
export function routeOrthogonal(boxes: readonly RouterBox[], edges: readonly RouterEdge[], partial?: PartialRoute): Map<string, RoutedEdge> {
  const out = new Map<string, RoutedEdge>();
  const ids = new Set(boxes.map((b) => b.id));
  const wanted = edges.filter((e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to));
  if (wanted.length === 0) return out;

  // The router works on integers; a zero-size box divides by zero in its port arithmetic.
  const entities: LayoutEntity[] = boxes.map((b) => {
    const outline = outlineOf(b.shape);
    return {
      id: b.id,
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(1, Math.round(b.w)),
      height: Math.max(1, Math.round(b.h)),
      ...(b.parent !== undefined && ids.has(b.parent) ? { containerId: b.parent } : {}),
      ...(b.container ? { isContainer: true, textPlacement: { relativeX: 0, relativeY: 0, width: Math.max(1, Math.round(b.w)), height: Math.max(1, Math.round(b.container.header)) } } : {}),
      ...(outline ? { outline } : {}),
    };
  });
  const plate = (e: RouterEdge) => (e.label ? { width: Math.ceil(e.label.w), height: Math.ceil(e.label.h) } : undefined);
  const kept = new Map<string, RoutedEdge>();
  const existing: LayoutConnection[] = [];
  for (const e of wanted) {
    const prev = partial && !partial.only.has(e.id) ? partial.previous.get(e.id) : undefined;
    const o = prev?.points[0];
    if (!prev || !o || prev.points.length < 2) continue;
    kept.set(e.id, prev);
    const size = plate(e);
    existing.push({
      id: e.id,
      from: e.from,
      to: e.to,
      connectorStyle: 'elbow',
      fromArrowhead: e.startArrow,
      toArrowhead: e.endArrow,
      x: o.x,
      y: o.y,
      points: prev.points.map((p): [number, number] => [p.x - o.x, p.y - o.y]),
      ...(size && prev.label ? { textPlacement: { x: prev.label.x - size.width / 2, y: prev.label.y - size.height / 2, ...size }, textPlacementSource: 'stored' as const } : {}),
    });
  }
  const connections: NewConnection[] = wanted.filter((e) => !kept.has(e.id)).map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    connectorStyle: 'elbow',
    fromArrowhead: e.startArrow,
    toArrowhead: e.endArrow,
    x: 0,
    y: 0,
    points: [],
    ...(e.label ? { textPlacement: { x: Number.NaN, y: Number.NaN, width: Math.ceil(e.label.w), height: Math.ceil(e.label.h) }, textPlacementSource: 'measure' as const } : {}),
  }));

  const manager = new LayoutManager({ entities, connections: existing });
  let fallbacks: ReadonlySet<string> = new Set();
  try {
    if (connections.length > 0) ({ fallbacks } = routeConnections({ layoutManager: manager, connectionsToRoute: connections, repair: REPAIR }));
  } catch {
    return new Map(kept);
  }
  for (const e of wanted) {
    const prev = kept.get(e.id);
    if (prev) {
      out.set(e.id, prev);
      continue;
    }
    if (fallbacks.has(e.id)) continue;
    const c = manager.getConnectionById(e.id);
    if (!c || c.points.length < 2) continue;
    const points = c.points.map(([px, py]) => ({ x: c.x + px, y: c.y + py }));
    const t = c.textPlacement;
    const label = e.label && t && Number.isFinite(t.x) && Number.isFinite(t.y) ? { x: t.x + t.width / 2, y: t.y + t.height / 2 } : undefined;
    out.set(e.id, label ? { points, label } : { points });
  }
  return out;
}
