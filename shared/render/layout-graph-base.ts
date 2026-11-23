// The slow, cacheable half of the graph layout: measure the diagram and run ELK (`graphBase`), or take the
// caller's boxes and route elbows between them (`placedBase`, BPMN lanes).

import type { GraphChild, GraphDiagram, GraphEdge, GraphGroup } from '../dsl/index.ts';
import { measureLabel, round, styleFor } from './common.ts';
import type { Label } from './common.ts';
import { absolutePositions, edgeOffset, runElk } from './elk.ts';
import type { ElkExtendedEdge, ElkNode } from './elk.ts';
import { PLATE_PAD } from './text.ts';
import { alignLayout, orthogonalize } from './layout-align.ts';
import { routeEdges } from './layout-routes.ts';
import { wrapTopLevel } from './layout-wrap.ts';
import type { ShapeKind } from './scene.ts';
import { prepareIcons } from './auto-icon.ts';
import { SPACING } from './layout-graph-common.ts';
import type { BaseEdge, GraphBase, GraphLayoutOptions, Rect } from './layout-graph-common.ts';
import { BAND_GAP, GRID_GAP, attachTail, bandColumns, gridColumns, packGrid, placePiece } from './layout-graph-pack.ts';
import type { Piece } from './layout-graph-pack.ts';
import { GROUP_PAD, measureGroup, measureNode, runBand, unifySizes } from './layout-graph-measure.ts';
import type { GroupGeom, NodeGeom } from './layout-graph-measure.ts';
import { definitionOrder, flipped, freeChildren, rootLayers } from './layout-graph-order.ts';
import { routeAcross, routeElbow } from './layout-graph-route.ts';

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

  const measure = (child: GraphChild, parentId: string | undefined, color?: string): void => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      nodes.set(child.id, measureNode(d, child, color));
      return;
    }
    const geom = measureGroup(d, child, color);
    groups.set(child.id, geom);
    for (const c of child.children) measure(c, child.id, geom.style.paint.color);
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
  const measure = (child: GraphChild, parentId: string | undefined, color?: string): void => {
    parent.set(child.id, parentId);
    if (child.kind === 'node') {
      nodes.set(child.id, measureNode(d, child, color));
      return;
    }
    const geom = measureGroup(d, child, color);
    groups.set(child.id, geom);
    for (const c of child.children) measure(c, child.id, geom.style.paint.color);
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
