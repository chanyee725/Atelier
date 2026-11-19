// BPMN (swimlane, #841): pools and lanes as bands, nodes in flow-order slots inside their lane.
// Deterministic (no ELK): the slot of a node is its flow rank (`layout compact`: longest path from a start;
// `layout sequential`: one slot per node in flow order). Nodes of one lane that share a rank stack across
// the flow. Boxes keep flowchart sizes; drawing, edge routes and labels are the graph renderer's.

import { bpmnAsGraph } from '../dsl/index.ts';
import type { BpmnDiagram } from '../dsl/index.ts';
import { composeGraph, placedBase, type PlacedSizes } from './layout-graph.ts';
import type { Scene } from './scene.ts';

type Rect = { x: number; y: number; w: number; h: number };

/** Space between flow slots, between nodes stacked in one slot, and inside a lane. */
const FLOW_GAP = 56;
const STACK_GAP = 24;
const LANE_PAD = { side: 24, end: 18 } as const;
/** Pool walls around its lanes, and the gap between root bands (pools, lanes without a pool). */
const POOL_PAD = { side: 16, end: 14 } as const;
const BAND_GAP = 32;
/** Header of a band that has no box (nodes outside every lane). */
const BARE_HEAD = 16;

/** Rank of every node along the flow. Back edges (closing a cycle, found depth-first from the start nodes) are ignored. */
export function flowRanks(d: BpmnDiagram): Map<string, number> {
  const ids = d.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of d.edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      const s = state.get(to);
      if (s === 1) continue; // back edge
      forward.get(id)!.push(to);
      if (s === undefined) visit(to);
    }
    state.set(id, 2);
  };
  // Start from the starts (start events, then other nodes with no incoming edge), so a lane declared
  // before the start's lane cannot turn a forward edge into a back edge; then the rest in source order.
  const incoming = new Set(d.edges.filter((e) => e.from !== e.to).map((e) => e.to));
  const roots = [
    ...d.nodes.filter((n) => n.eventRole === 'start' && !incoming.has(n.id)).map((n) => n.id),
    ...ids.filter((id) => !incoming.has(id)),
    ...ids,
  ];
  for (const id of roots) if (!state.has(id)) visit(id);

  // Kahn's order over the forward edges, ties by source order.
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const tos of forward.values()) for (const to of tos) indeg.set(to, indeg.get(to)! + 1);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const topo: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!);
    const id = ready.shift()!;
    topo.push(id);
    for (const to of forward.get(id)!) {
      indeg.set(to, indeg.get(to)! - 1);
      if (indeg.get(to) === 0) ready.push(to);
    }
  }
  const rank = new Map<string, number>();
  if (d.layout === 'sequential') {
    topo.forEach((id, i) => rank.set(id, i));
    return rank;
  }
  for (const id of topo) rank.set(id, rank.get(id) ?? 0);
  for (const id of topo) for (const to of forward.get(id)!) rank.set(to, Math.max(rank.get(to) ?? 0, rank.get(id)! + 1));
  return rank;
}

/** One band of nodes: a lane (`id`), or the nodes of a pool or of the root outside every lane (no box). */
interface Band {
  id?: string;
  nodes: string[];
}

/** Root order: pools with their bands, then bands that stand alone, by source position. */
function rootBands(d: BpmnDiagram): { pool?: string; bands: Band[] }[] {
  const lanes = new Map(d.lanes.map((l) => [l.id, l]));
  const roots: { at: number; pool?: string; bands: Band[] }[] = [];
  for (const p of d.pools) {
    const bands: Band[] = p.lanes.map((id) => ({ id, nodes: lanes.get(id)!.nodes }));
    const loose = d.nodes.filter((n) => n.pool === p.id && !n.lane).map((n) => n.id);
    if (loose.length) bands.push({ nodes: loose });
    roots.push({ at: p.span.offset, pool: p.id, bands });
  }
  for (const l of d.lanes) if (!l.pool) roots.push({ at: l.span.offset, bands: [{ id: l.id, nodes: l.nodes }] });
  const loose = d.nodes.filter((n) => !n.pool && !n.lane);
  if (loose.length) roots.push({ at: loose[0]!.span.offset, bands: [{ nodes: loose.map((n) => n.id) }] });
  return roots.sort((a, b) => a.at - b.at).map(({ pool, bands }) => ({ pool, bands }));
}

/**
 * Rects for every node, lane and pool. `right` (and `left`/`up`, which Eraser does not have) puts the flow
 * left to right with lanes stacked as rows; `down` puts lanes side by side with the flow top to bottom.
 */
export function placeLanes(d: BpmnDiagram, sizes: PlacedSizes): Map<string, Rect> {
  const rank = flowRanks(d);
  const across = d.direction === 'down';
  const size = (id: string) => sizes.nodes.get(id) ?? { w: 0, h: 0 };
  // Flow length and cross length of a node.
  const along = (id: string) => (across ? size(id).h : size(id).w);
  const cross = (id: string) => (across ? size(id).w : size(id).h);
  const head = (id: string | undefined) => (id === undefined ? BARE_HEAD : sizes.headers.get(id) ?? BARE_HEAD);

  const slots = Math.max(0, ...rank.values()) + 1;
  const slotLen = Array.from({ length: slots }, () => 0);
  for (const [id, r] of rank) slotLen[r] = Math.max(slotLen[r]!, along(id));
  const slotAt: number[] = [];
  let acc = 0;
  for (let r = 0; r < slots; r++) {
    slotAt.push(acc);
    acc += slotLen[r]! + FLOW_GAP;
  }
  const flowLen = Math.max(0, acc - FLOW_GAP);

  /** Nodes of a band per slot, in band order: the stack index of each node and the band's stack depth. */
  const stack = (b: Band) => {
    const cells = new Map<number, string[]>();
    for (const id of b.nodes) {
      const r = rank.get(id) ?? 0;
      cells.set(r, [...(cells.get(r) ?? []), id]);
    }
    const depth = Math.max(1, ...[...cells.values()].map((c) => c.length));
    const thick = Math.max(0, ...b.nodes.map(cross));
    return { cells, depth, thick, len: depth * thick + (depth - 1) * STACK_GAP };
  };

  const rects = new Map<string, Rect>();
  const roots = rootBands(d);
  const put = (id: string, flow: number, crossAt: number, flowW: number, crossW: number) =>
    rects.set(id, across ? { x: crossAt, y: flow, w: crossW, h: flowW } : { x: flow, y: crossAt, w: flowW, h: crossW });
  const placeNodes = (b: Band, flow0: number, cross0: number) => {
    const { cells, thick } = stack(b);
    for (const [r, ids] of cells) {
      ids.forEach((id, i) => {
        const f = flow0 + slotAt[r]! + (slotLen[r]! - along(id)) / 2;
        const c = cross0 + i * (thick + STACK_GAP) + (thick - cross(id)) / 2;
        put(id, Math.round(f), Math.round(c), along(id), cross(id));
      });
    }
  };

  if (!across) {
    // Lanes are rows; every band spans the same flow, so slots line up across pools.
    const laneW = flowLen + 2 * LANE_PAD.side;
    let y = 0;
    for (const root of roots) {
      const poolY = y;
      const x0 = root.pool !== undefined ? POOL_PAD.side : 0;
      if (root.pool !== undefined) y += head(root.pool);
      for (const b of root.bands) {
        const s = stack(b);
        const h = head(b.id) + s.len + LANE_PAD.end;
        placeNodes(b, x0 + LANE_PAD.side, y + head(b.id));
        if (b.id !== undefined) rects.set(b.id, { x: x0, y, w: laneW, h });
        y += h;
      }
      if (root.pool !== undefined) {
        y += POOL_PAD.end;
        rects.set(root.pool, { x: 0, y: poolY, w: laneW + 2 * POOL_PAD.side, h: y - poolY });
      }
      y += BAND_GAP;
    }
    return rects;
  }

  // `down`: lanes are columns; the flow starts below the tallest pool and lane header so slots line up.
  const poolHead = Math.max(0, ...roots.filter((r) => r.pool !== undefined).map((r) => head(r.pool)));
  const laneHead = Math.max(0, ...roots.flatMap((r) => r.bands.map((b) => head(b.id))));
  const laneH = laneHead + flowLen + LANE_PAD.end;
  let x = 0;
  for (const root of roots) {
    const poolX = x;
    const pooled = root.pool !== undefined;
    if (pooled) x += POOL_PAD.side;
    const top = pooled || roots.some((r) => r.pool !== undefined) ? poolHead : 0;
    for (const b of root.bands) {
      const s = stack(b);
      const w = s.len + 2 * LANE_PAD.side;
      placeNodes(b, top + laneHead, x + LANE_PAD.side);
      if (b.id !== undefined) rects.set(b.id, { x, y: top, w, h: laneH });
      x += w;
    }
    if (pooled) {
      x += POOL_PAD.side;
      rects.set(root.pool!, { x: poolX, y: 0, w: x - poolX, h: poolHead + laneH + POOL_PAD.end });
    }
    x += BAND_GAP;
  }
  return rects;
}

/** Lay out a BPMN diagram. Lanes are fixed bands, so no drag handles (moved boxes would leave their lane). */
export async function layoutBpmn(d: BpmnDiagram): Promise<Scene> {
  const g = bpmnAsGraph(d);
  const base = await placedBase(g, (sizes) => placeLanes(d, sizes));
  const { handles: _handles, ...scene } = composeGraph(g, base);
  return { ...scene, type: 'bpmn' };
}
