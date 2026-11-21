// Cloud architecture and flowchart: ELK layered layout with groups as compound nodes.

import type { GraphChild, GraphDiagram, GraphEdge, GraphGroup } from '../dsl/index.ts';
import { finishScene, measureLabel, round, styleFor, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { absolutePositions, edgeOffset, runElk } from './elk.ts';
import type { ElkExtendedEdge, ElkNode } from './elk.ts';
import { PLATE_PAD, textWidth } from './text.ts';
import { BADGE_FONT_SIZE, BADGE_FONT_WEIGHT, badgeRect } from './badge.ts';
import { sanitizeColor } from './theme.ts';
import { BLOCK_LAYOUT_VERSION } from './block-layout.ts';
import type { BlockLayout } from './block-layout.ts';
import { alignLayout, orthogonalize } from './layout-align.ts';
import { routeEdges, straightPorts } from './layout-routes.ts';
import { ROUTE_GAP, alongLine, routeAround } from './route-around.ts';
import { wrapTopLevel } from './layout-wrap.ts';
import type { Point, Scene, SceneBadge, SceneEdge, SceneHandle, SceneItem, ShapeKind } from './scene.ts';
import { prepareIcons } from './auto-icon.ts';
import { SPACING } from './layout-graph-common.ts';
import { ZERO, isZero, sameShift } from './layout-graph-common.ts';
import type { BaseEdge, Delta, GraphBase, GraphLayoutOptions, Rect } from './layout-graph-common.ts';
import { BAND_GAP, GRID_GAP, attachTail, bandColumns, gridColumns, packGrid, placePiece } from './layout-graph-pack.ts';
import type { Piece } from './layout-graph-pack.ts';

import { clipToShape, labelRect, placeLabel, snapToShape } from './layout-graph-label.ts';
import { CARD_INSET, CARD_RIGHT, DIVIDER_GAP, GROUP_PAD, SUBTITLE_GAP, measureGroup, measureNode, runBand, textHeight, unifySizes } from './layout-graph-measure.ts';
import type { GroupGeom, NodeGeom } from './layout-graph-measure.ts';
import { definitionOrder, flipped, freeChildren, rootLayers } from './layout-graph-order.ts';
import { EDGE_W, dividerSpans, growRect, obstacles, routeAcross, routeElbow, routeElbows, routeIntoGroup } from './layout-graph-route.ts';
export { bandColumns, gridColumns, packGrid } from './layout-graph-pack.ts';
export { LABEL_SHIFT, placeLabel } from './layout-graph-label.ts';
export { runBand } from './layout-graph-measure.ts';
export type { GraphBase, GraphLayoutOptions } from './layout-graph-common.ts';

const ELK_DIRECTION = { down: 'DOWN', up: 'UP', left: 'LEFT', right: 'RIGHT' } as const;
const EDGE_LABEL_SIZE = 12;

/**
 * Siblings in one layer keep their source order (spec §1.3), even at the cost of a crossing. Set on the
 * root of every ELK run (`layoutScope`: the diagram and each free group). ELK only honours it at that
 * root (set on a group, elkjs 0.12 throws in its model-order comparator), so `alignLayout` puts siblings
 * inside groups in source order afterwards.
 */
const MODEL_ORDER = {
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
} as const;
/** Gap above and below a divider that splits connected siblings into rows. */
const DIVIDER_ROW_GAP = 24;
/** Extra room at a group's sides and bottom when dividers split its children: edges run around the rows there. */
const ROUTE_ROOM = 12;

/** Measure the diagram and run ELK. Async and slow; cache the result per AST (and per `options`). */
export async function graphBase(d: GraphDiagram, options: GraphLayoutOptions = {}): Promise<GraphBase> {
  await prepareIcons(d);
  const nodes = new Map<string, NodeGeom>();
  const groups = new Map<string, GroupGeom>();
  const parent = new Map<string, string | undefined>();
  const elkId = (id: string): string => `n:${id}`;

  const measure = (child: GraphChild, parentId: string | undefined): void => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      nodes.set(child.id, measureNode(d, child));
      return;
    }
    groups.set(child.id, measureGroup(d, child));
    for (const c of child.children) measure(c, child.id);
  };
  for (const c of d.children) measure(c, undefined);
  const order = definitionOrder(d);
  const edges: GraphEdge[] = d.edges.filter((e) => parent.has(e.from) && parent.has(e.to));
  const free = freeChildren(edges, parent);
  // Free root nodes share one size (they go in the root grid). A lone one forms a set of one, so it keeps
  // its own size anyway.
  const loose = new Set(d.children.filter((c) => c.kind === 'node' && free(c)).map((c) => c.id));
  unifySizes(nodes.values(), parent, rootLayers(d, parent, order), loose);

  // ELK reads spacing per parent, so every group gets its own values (else ELK's 20 px default).
  const vertical = d.direction === 'down' || d.direction === 'up';
  // The run-mark band sits above each node, so it widens whichever gap runs vertically: between layers in a
  // vertical flow, between stacked neighbours in a horizontal one (#987).
  const band = runBand(d);
  const spacingFor = (kids: readonly GraphChild[]): Record<string, string> => ({
    'elk.spacing.nodeNode': String(
      (kids.some((c) => c.kind === 'group') ? SPACING.block : vertical ? SPACING.neighbour : SPACING.list) + (vertical ? 0 : band),
    ),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(SPACING.layer + (vertical ? band : 0)),
    'elk.spacing.edgeNode': '24',
    'elk.spacing.edgeEdge': '16',
    'elk.layered.spacing.edgeNodeBetweenLayers': '24',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
    'elk.spacing.edgeLabel': '4',
  });
  const isAncestor = (a: string, b: string): boolean => {
    for (let p = parent.get(b); p !== undefined; p = parent.get(p)) if (p === a) return true;
    return false;
  };
  const pairCount = new Map<string, number>();
  const pairKey = (e: GraphEdge): string => [e.from, e.to].sort().join('\u0000');
  for (const e of d.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);

  const edgeLabels = new Map<string, Label>();
  for (const e of edges) {
    const style = styleFor(d, e.attrs, e.span.line);
    if (e.label) edgeLabels.set(e.id, measureLabel(e.label, EDGE_LABEL_SIZE, style.typeface, style.wrap, 140));
  }
  const elkEdge = (e: GraphEdge): ElkExtendedEdge => {
    const label = edgeLabels.get(e.id);
    const flip = flipped(e, order);
    return {
      id: `e:${e.id}`,
      sources: [elkId(flip ? e.to : e.from)],
      targets: [elkId(flip ? e.from : e.to)],
      labels: label ? [{ id: `l:${e.id}`, text: e.label!, width: Math.ceil(label.w + PLATE_PAD * 2), height: label.h + 4 }] : [],
    };
  };
  /** Free nodes and groups placed in a grid: alignment leaves them where the grid put them (spec §1.4). */
  const gridded = new Set<string>();
  /** Groups whose children all went in one grid: they keep the grid's fitted size (spec §1.2 exception). */
  const gridGroups = new Set<string>();

  /** An unconnected divider: it splits its siblings into rows instead of sitting among them. */
  const isRowDivider = (c: GraphChild): boolean => c.kind === 'node' && !!nodes.get(c.id)?.divider && free(c);
  /** Siblings that dividerRows splits: a free divider among connected ones (all free: leafGrid does it). */
  const splitsIntoRows = (top: readonly GraphChild[]): boolean => top.some(isRowDivider) && !top.every((c) => free(c));
  /** Edges that cross a divider row, by the scope (group id, undefined for the root) whose rows they cross. */
  const rowCross = new Map<string, string | undefined>();
  /**
   * Dividers among connected siblings (#244): ELK would place a divider like any other node, beside them, and
   * leave a short line fragment. Instead the siblings are cut at each divider in source order, every part is
   * laid out on its own, and the parts stack with the dividers between them: top to bottom, bottom to top
   * for `up`. Edges that cross a divider get a placeholder elbow here and their real route, around the
   * nodes and the divider labels, once alignment is done (routeAcross).
   */
  const dividerRows = async (top: readonly GraphChild[], scope: string | undefined): Promise<Piece | undefined> => {
    if (!splitsIntoRows(top)) return undefined;
    const pieces: Piece[] = [];
    let run: GraphChild[] = [];
    const flush = async (): Promise<void> => {
      if (run.length) pieces.push(await layoutScope(run));
      run = [];
    };
    for (const c of top) {
      if (!isRowDivider(c)) {
        run.push(c);
        continue;
      }
      await flush();
      const g = nodes.get(c.id)!;
      gridded.add(c.id);
      pieces.push({ w: g.w, h: g.h, rects: new Map([[c.id, { x: 0, y: 0, w: g.w, h: g.h }]]), edges: new Map() });
    }
    await flush();
    if (d.direction === 'up') pieces.reverse();
    const out = packGrid(pieces, 1, 0, DIVIDER_ROW_GAP, true);
    for (const e of edges) {
      const a = out.rects.get(e.from);
      const b = out.rects.get(e.to);
      if (a && b && !out.edges.has(e.id)) {
        out.edges.set(e.id, routeElbow(a, b, 0));
        rowCross.set(e.id, scope);
      }
    }
    return out;
  };

  /**
   * A free group whose children dividerRows splits: the rows inside the group's padding, with ROUTE_ROOM
   * more at the sides and bottom so edges across the rows can run around them inside the group.
   */
  const groupRows = async (g: GraphGroup): Promise<Piece> => {
    const rows = (await dividerRows(g.children, g.id))!;
    const m = groups.get(g.id)!;
    const side = GROUP_PAD.side + ROUTE_ROOM;
    const w = Math.max(m.minW, rows.w + 2 * side);
    const h = m.header + rows.h + GROUP_PAD.bottom + ROUTE_ROOM;
    const piece: Piece = { w, h, rects: new Map([[g.id, { x: 0, y: 0, w, h }]]), edges: new Map() };
    placePiece(piece, rows, (w - rows.w) / 2, m.header);
    gridGroups.add(g.id);
    return piece;
  };

  /** Lay out `top` (the diagram's children, or one free group) with ELK; free siblings go in grids. */
  const layoutScope = async (top: readonly GraphChild[]): Promise<Piece> => {
    const rows = await dividerRows(top, undefined);
    if (rows) return rows;
    const present = new Set<string>();
    const grids = new Map<string, Piece>();
    /** Free block of the scope's top level when it also has linked children: placed after ELK, not by it. */
    let tail: Piece | undefined;
    const build = async (kids: readonly GraphChild[], key: string): Promise<ElkNode[]> => {
      const loose = kids.filter((c) => free(c));
      const linked = loose.length >= 2 ? kids.filter((c) => !free(c)) : kids;
      const out: ElkNode[] = [];
      for (const c of linked) out.push(await toElk(c));
      if (loose.length >= 2 && key === '' && linked.length > 0) {
        // ELK's LAST_SEPARATE would give the block a layer of its own, but crashes on some graphs.
        tail = await gridOf(loose);
      } else if (loose.length >= 2) {
        const block = await gridOf(loose);
        const id = `grid:${key}`;
        grids.set(id, block);
        // A group whose children all went in the grid keeps the grid's fitted width (spec §1.2 exception).
        if (linked.length === 0 && key !== '') gridGroups.add(key);
        // Spec §1.4: the unconnected rest of a partly connected parent goes at its end.
        const last = linked.length > 0 ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'LAST' } } : {};
        out.push({ id, width: block.w, height: block.h, ...last });
      }
      return out;
    };
    const toElk = async (child: GraphChild): Promise<ElkNode> => {
      present.add(child.id);
      if (child.kind === 'node') {
        const g = nodes.get(child.id)!;
        return { id: elkId(child.id), width: g.w, height: g.h };
      }
      if (free(child) && splitsIntoRows(child.children)) {
        // No edge crosses the group, so ELK can take it as one box.
        const block = await groupRows(child);
        const id = `rows:${child.id}`;
        grids.set(id, block);
        return { id, width: block.w, height: block.h };
      }
      const g = groups.get(child.id)!;
      const kids = await build(child.children, child.id);
      return {
        id: elkId(child.id),
        ...(kids.length === 0 ? { width: g.minW, height: g.header + 40 } : {}),
        children: kids,
        layoutOptions: {
          ...spacingFor(child.children),
          'elk.padding': `[top=${g.header},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${g.minW},${g.header + 40})`,
        },
      };
    };
    const children = await build(top, '');
    const scopeEdges = edges.filter((e) => present.has(e.from) && present.has(e.to));
    const root: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': ELK_DIRECTION[d.direction],
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        ...MODEL_ORDER,
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        ...spacingFor(top),
        'elk.edgeLabels.inline': 'true',
        'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
      },
      children,
      edges: scopeEdges.map(elkEdge),
    };

    const out = await runElk(root);
    const abs = absolutePositions(out);
    const piece: Piece = { w: out.width ?? 0, h: out.height ?? 0, rects: new Map(), edges: new Map() };
    const sizes = new Map<string, { w: number; h: number }>();
    const collect = (n: ElkNode): void => {
      for (const c of n.children ?? []) {
        sizes.set(c.id, { w: c.width ?? 0, h: c.height ?? 0 });
        collect(c);
      }
    };
    collect(out);
    for (const [id, p] of abs) {
      const s = sizes.get(id);
      if (s && id.startsWith('n:')) piece.rects.set(id.slice(2), { x: p.x, y: p.y, w: s.w, h: s.h });
      const grid = grids.get(id);
      if (grid) placePiece(piece, grid, p.x, p.y);
    }
    if (tail) attachTail(piece, tail, d.direction);
    const laid = new Map((out.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge & { container?: string }]));
    for (const e of scopeEdges) {
      const le = laid.get(`e:${e.id}`);
      const section = le?.sections?.[0];
      if (!le || !section) continue;
      const o = edgeOffset(le, abs);
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: round(p.x + o.x), y: round(p.y + o.y) }));
      if (flipped(e, order)) points.reverse();
      piece.edges.set(e.id, orthogonalize(points));
    }
    return piece;
  };

  /** A free group laid out on its own, in its own coordinates (top-left 0,0). */
  const groupPiece = async (g: GraphGroup): Promise<Piece> => {
    const laid = await layoutScope([g]);
    const r = laid.rects.get(g.id)!;
    const piece: Piece = { w: r.w, h: r.h, rects: new Map(), edges: new Map() };
    placePiece(piece, laid, -r.x, -r.y);
    return piece;
  };

  /**
   * Free nodes in a row-first grid. Dividers (#115) break it into rows: the nodes before a divider form one
   * grid, the divider its own row under it, the nodes after it the next grid, all stacked.
   */
  const leafGrid = (leaves: Piece[]): Piece => {
    const isDivider = (p: Piece): boolean => [...p.rects.keys()].some((id) => nodes.get(id)?.divider);
    if (!leaves.some(isDivider)) return packGrid(leaves, gridColumns(leaves.length), GRID_GAP.x, GRID_GAP.y + band, true);
    const rows: Piece[] = [];
    let run: Piece[] = [];
    const flush = (): void => {
      if (run.length) rows.push(packGrid(run, gridColumns(run.length), GRID_GAP.x, GRID_GAP.y + band, true));
      run = [];
    };
    for (const leaf of leaves) {
      if (!isDivider(leaf)) run.push(leaf);
      else {
        flush();
        rows.push(leaf);
      }
    }
    flush();
    return packGrid(rows, 1, GRID_GAP.x, GRID_GAP.y + band, true);
  };

  /**
   * Free siblings as one block (spec §1.4): free nodes in a row-first grid, then each free group as a cell
   * of a second grid whose columns keep the block near BAND_ASPECT (wide bands stack, as Eraser's do in
   * either direction).
   */
  const gridOf = async (loose: readonly GraphChild[]): Promise<Piece> => {
    const leaves: Piece[] = [];
    const bands: Piece[] = [];
    for (const c of loose) {
      gridded.add(c.id);
      if (c.kind === 'node') {
        const g = nodes.get(c.id)!;
        leaves.push({ w: g.w, h: g.h, rects: new Map([[c.id, { x: 0, y: 0, w: g.w, h: g.h }]]), edges: new Map() });
      } else bands.push(await groupPiece(c));
    }
    if (leaves.length > 0) bands.unshift(leafGrid(leaves));
    if (bands.length === 1) return bands[0]!;
    return packGrid(bands, bandColumns(bands), BAND_GAP.row, BAND_GAP.stack + band, false);
  };

  const placed = await layoutScope(d.children);
  const pairSeen = new Map<string, number>();
  const baseEdges: BaseEdge[] = [];
  for (const e of edges) {
    const points = placed.edges.get(e.id);
    if (!points) continue;
    const key = pairKey(e);
    const pairIndex = pairSeen.get(key) ?? 0;
    pairSeen.set(key, pairIndex + 1);
    baseEdges.push({
      edge: e,
      style: styleFor(d, e.attrs, e.span.line),
      label: edgeLabels.get(e.id),
      points,
      forcedElbow: e.from === e.to || isAncestor(e.from, e.to) || isAncestor(e.to, e.from) || (pairCount.get(key) ?? 0) > 1 || rowCross.has(e.id),
      ...(rowCross.has(e.id) ? { ownRoute: true } : {}),
      pairIndex,
      pairSize: 0,
    });
  }
  for (const be of baseEdges) be.pairSize = pairSeen.get(pairKey(be.edge)) ?? 1;

  // Spec §1.8 steps 4-5: snap layer centres, match sibling group bands, keep edges attached. Grid cells
  // stay as packed: grid groups keep their fitted width and left edge (spec §1.2 exception, §1.4).
  const rects = placed.rects;
  const kids = new Map<string | undefined, string[]>([[undefined, d.children.map((c) => c.id)]]);
  for (const g of groups.values()) kids.set(g.group.id, g.group.children.map((c) => c.id));
  alignLayout(
    {
      kids,
      parent,
      pad: (id) => ({ top: groups.get(id)!.header, side: GROUP_PAD.side, bottom: GROUP_PAD.bottom }),
      order,
      fixed: gridded,
      fitted: gridGroups,
    },
    rects,
    baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points })),
    vertical,
  );
  for (const be of baseEdges) be.points = be.points.map((p) => ({ x: round(p.x), y: round(p.y) }));
  if (options.wrapGroups && (d.direction === 'right' || d.direction === 'down') && rowCross.size === 0 && !splitsIntoRows(d.children)) {
    const wrapEdges = baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points }));
    const wrapped = wrapTopLevel({
      rects,
      top: d.children.map((c) => c.id),
      parent,
      isGroup: (id) => groups.has(id),
      titleOf: (id, r) => {
        const g = groups.get(id)!;
        // Same place composeGraph draws the title; `vertical` works mirrored, so the rect is mirrored too.
        const w = g.label.w + (g.iconSize ? g.iconSize + 8 : 0);
        const h = Math.max(g.label.h, g.iconSize);
        return vertical ? { x: r.x + 11, y: r.y + 14, w: h, h: w } : { x: r.x + 14, y: r.y + 11, w, h };
      },
      edges: wrapEdges,
      vertical,
    });
    // A route between two rows is drawn as found, whatever the connector style: a straight line would cut through the rows.
    baseEdges.forEach((be, i) => {
      be.points = wrapEdges[i]!.points.map((p) => ({ x: round(p.x), y: round(p.y) }));
      if (wrapped?.rerouted.has(i)) {
        be.forcedElbow = true;
        be.ownRoute = true;
      }
    });
  }
  routeAcross(d, nodes, parent, rects, baseEdges.filter((be) => rowCross.has(be.edge.id)), baseEdges, rowCross, (g) => groups.get(g)!.header);
  // Spec §1.8 step 6: even ports, straight lines first, at most two bends, shared buses.
  routeEdges(rects, parent, baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points, keep: be.forcedElbow })));

  return { nodes, groups, parent, rects, edges: baseEdges };
}

/** Box sizes a caller-made layout places: measured nodes (flowchart sizes) and each group's header height. */
export interface PlacedSizes {
  readonly nodes: ReadonlyMap<string, { readonly w: number; readonly h: number; readonly shape: ShapeKind }>;
  readonly headers: ReadonlyMap<string, number>;
}

/**
 * A graph base whose boxes the caller places instead of ELK (BPMN lanes, #841): the same measurements as
 * `graphBase` (box nodes in one group share a size), the caller's rects, then elbow routes between them
 * straightened by the corridor router. Deterministic: no ELK run.
 */
export async function placedBase(d: GraphDiagram, place: (sizes: PlacedSizes) => Map<string, Rect>): Promise<GraphBase> {
  await prepareIcons(d);
  const nodes = new Map<string, NodeGeom>();
  const groups = new Map<string, GroupGeom>();
  const parent = new Map<string, string | undefined>();
  const measure = (child: GraphChild, parentId: string | undefined): void => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      nodes.set(child.id, measureNode(d, child));
      return;
    }
    groups.set(child.id, measureGroup(d, child));
    for (const c of child.children) measure(c, child.id);
  };
  for (const c of d.children) measure(c, undefined);
  unifySizes(nodes.values(), parent, new Map(), new Set());
  const headers = new Map([...groups].map(([id, g]) => [id, g.header]));
  const rects = place({ nodes, headers });

  const edges = d.edges.filter((e) => rects.has(e.from) && rects.has(e.to));
  const pairKey = (e: GraphEdge): string => [e.from, e.to].sort().join('\u0000');
  const pairCount = new Map<string, number>();
  for (const e of edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
  const pairSeen = new Map<string, number>();
  const baseEdges: BaseEdge[] = edges.map((e) => {
    const style = styleFor(d, e.attrs, e.span.line);
    const key = pairKey(e);
    const pairIndex = pairSeen.get(key) ?? 0;
    pairSeen.set(key, pairIndex + 1);
    const points = routeElbow(rects.get(e.from)!, rects.get(e.to)!, 0).map((p) => ({ x: round(p.x), y: round(p.y) }));
    return {
      edge: e,
      style,
      ...(e.label ? { label: measureLabel(e.label, EDGE_LABEL_SIZE, style.typeface, style.wrap, 140) } : {}),
      points,
      forcedElbow: e.from === e.to || (pairCount.get(key) ?? 0) > 1,
      pairIndex,
      pairSize: pairCount.get(key) ?? 1,
    };
  });
  routeEdges(rects, parent, baseEdges.map((be) => ({ from: be.edge.from, to: be.edge.to, points: be.points, keep: be.forcedElbow })));
  return { nodes, groups, parent, rects, edges: baseEdges };
}

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
