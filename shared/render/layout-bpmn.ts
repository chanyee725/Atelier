// BPMN (swimlane, #841): pools and lanes as bands, nodes in flow-order slots inside their lane.
// Deterministic (no ELK): the slot of a node is its flow rank (`layout compact`: longest path from a start;
// `layout sequential`: one slot per node in flow order). Nodes of one lane that share a rank stack across
// the flow. Boxes keep flowchart sizes; drawing, edge routes and labels are the graph renderer's.

import { bpmnAsGraph } from '../dsl/index.ts';
import type { BpmnDiagram } from '../dsl/index.ts';
import { composeGraph, placedBase, type PlacedSizes } from './layout-graph.ts';
import type { Scene } from './scene.ts';
import { placeBands, rankFlow } from './layout-lanes.ts';
import type { Band, BandRoot } from './layout-lanes.ts';

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
  // Start from the start events, so a lane declared before the start's lane cannot turn a forward edge into a back edge.
  const starts = d.nodes.filter((n) => n.eventRole === 'start').map((n) => n.id);
  return rankFlow(d.nodes.map((n) => n.id), d.edges, starts, d.layout === 'sequential');
}

/** Root order: pools with their bands, then bands that stand alone, by source position. */
function rootBands(d: BpmnDiagram): BandRoot[] {
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
  return placeBands(rootBands(d), flowRanks(d), d.direction === 'down', sizes, {
    flowGap: FLOW_GAP,
    stackGap: STACK_GAP,
    lanePad: LANE_PAD,
    poolPad: POOL_PAD,
    bandGap: BAND_GAP,
    bareHead: BARE_HEAD,
  });
}

/** Gap between a back edge and the boxes it runs beside: inside the lane padding, off the lane wall. */
const BACK_GAP = LANE_PAD.side / 2;

/**
 * `direction down`: a back edge would come up into the bottom of its target, next to the line that
 * leaves it. Run it beside both boxes instead, right side to right side, when that path is clear.
 */
function sideBackEdges(d: BpmnDiagram, base: Awaited<ReturnType<typeof placedBase>>): void {
  const rank = flowRanks(d);
  const nodes = new Set(d.nodes.map((n) => n.id));
  const hits = (r: Rect, p: { x: number; y: number }, q: { x: number; y: number }): boolean =>
    Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h;
  for (const be of base.edges) {
    const { from, to } = be.edge;
    if (from === to || (rank.get(to) ?? 0) > (rank.get(from) ?? 0)) continue;
    const a = base.rects.get(from);
    const b = base.rects.get(to);
    if (!a || !b) continue;
    const x = Math.max(a.x + a.w, b.x + b.w) + BACK_GAP;
    const ay = Math.round(a.y + a.h / 2);
    const by = Math.round(b.y + b.h / 2);
    const points = [{ x: a.x + a.w, y: ay }, { x, y: ay }, { x, y: by }, { x: b.x + b.w, y: by }];
    const clear = [...base.rects].every(
      ([id, r]) => !nodes.has(id) || id === from || id === to || points.every((p, i) => i === 0 || !hits(r, points[i - 1]!, p)),
    );
    if (!clear) continue;
    be.points = points;
    be.forcedElbow = true;
    be.ownRoute = true;
  }
}

/** Lay out a BPMN diagram. Lanes are fixed bands, so no drag handles (moved boxes would leave their lane). */
export async function layoutBpmn(d: BpmnDiagram): Promise<Scene> {
  const g = bpmnAsGraph(d);
  const base = await placedBase(g, (sizes) => placeLanes(d, sizes));
  if (d.direction === 'down') sideBackEdges(d, base);
  const { handles: _handles, ...scene } = composeGraph(g, base);
  return { ...scene, type: 'bpmn' };
}
