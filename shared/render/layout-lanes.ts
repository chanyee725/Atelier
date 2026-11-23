// Bands with flow slots (BPMN lanes #841, flowcharts whose flow goes back and forth between groups #1066):
// every node gets a slot along the flow (its rank), every band (lane or group) a row across it (a column in
// a `down` flow). Nodes of one band that share a slot stack across the flow. Deterministic, no ELK.

type Rect = { x: number; y: number; w: number; h: number };

export interface FlowEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * Rank of every id along the flow. Back edges (closing a cycle, found depth-first from `starts`, then from
 * the ids with no incoming edge, then the rest in source order) are ignored. `sequential` gives one slot per
 * id in topological order; otherwise the rank is the longest path from a source, where an edge is `step`
 * slots long (1 by default; 0 lets both ends share a slot).
 */
export function rankFlow(
  ids: readonly string[],
  edges: readonly FlowEdge[],
  starts: readonly string[] = [],
  sequential = false,
  step: (from: string, to: string) => number = () => 1,
): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
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
  // Start from the starts, so a band declared before the start's band cannot turn a forward edge into a
  // back edge; then the rest in source order.
  const incoming = new Set(edges.filter((e) => e.from !== e.to).map((e) => e.to));
  const roots = [...starts.filter((id) => !incoming.has(id)), ...ids.filter((id) => !incoming.has(id)), ...ids];
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
  if (sequential) {
    topo.forEach((id, i) => rank.set(id, i));
    return rank;
  }
  for (const id of topo) rank.set(id, rank.get(id) ?? 0);
  for (const id of topo) for (const to of forward.get(id)!) rank.set(to, Math.max(rank.get(to) ?? 0, rank.get(id)! + step(id, to)));
  return rank;
}

/** One band of nodes: a lane or group (`id`), or nodes outside every band (no box). */
export interface Band {
  id?: string;
  nodes: string[];
}

/** A root band, or a pool holding several bands. */
export interface BandRoot {
  pool?: string;
  bands: Band[];
}

export interface BandSpacing {
  /** Space between flow slots (before `gapAfter`). */
  flowGap: number;
  /** Space between nodes stacked in one slot. */
  stackGap: number;
  /** Inside a band: along the flow (`side`) and at the end across it (`end`). */
  lanePad: { side: number; end: number };
  /** Pool walls around its bands. */
  poolPad: { side: number; end: number };
  /** Gap between root bands. */
  bandGap: number;
  /** Header of a band that has no box. */
  bareHead: number;
  /** Space after slot `r` when it must be wider than `flowGap` (room for a label). */
  gapAfter?: (slot: number) => number;
}

export interface BandSizes {
  readonly nodes: ReadonlyMap<string, { readonly w: number; readonly h: number }>;
  readonly headers: ReadonlyMap<string, number>;
}

/**
 * Rects for every node, band and pool. `across` false puts the flow left to right with bands stacked as
 * rows; true puts bands side by side with the flow top to bottom.
 */
export function placeBands(roots: readonly BandRoot[], rank: ReadonlyMap<string, number>, across: boolean, sizes: BandSizes, sp: BandSpacing): Map<string, Rect> {
  const size = (id: string) => sizes.nodes.get(id) ?? { w: 0, h: 0 };
  // Flow length and cross length of a node.
  const along = (id: string) => (across ? size(id).h : size(id).w);
  const cross = (id: string) => (across ? size(id).w : size(id).h);
  const head = (id: string | undefined) => (id === undefined ? sp.bareHead : sizes.headers.get(id) ?? sp.bareHead);

  const slots = Math.max(0, ...rank.values()) + 1;
  const slotLen = Array.from({ length: slots }, () => 0);
  for (const [id, r] of rank) slotLen[r] = Math.max(slotLen[r]!, along(id));
  const slotAt: number[] = [];
  let acc = 0;
  let lastGap = 0;
  for (let r = 0; r < slots; r++) {
    slotAt.push(acc);
    lastGap = Math.max(sp.flowGap, sp.gapAfter?.(r) ?? 0);
    acc += slotLen[r]! + lastGap;
  }
  const flowLen = Math.max(0, acc - lastGap);

  /** Nodes of a band per slot, in band order: the stack index of each node and the band's stack depth. */
  const stack = (b: Band) => {
    const cells = new Map<number, string[]>();
    for (const id of b.nodes) {
      const r = rank.get(id) ?? 0;
      cells.set(r, [...(cells.get(r) ?? []), id]);
    }
    const depth = Math.max(1, ...[...cells.values()].map((c) => c.length));
    const thick = Math.max(0, ...b.nodes.map(cross));
    return { cells, depth, thick, len: depth * thick + (depth - 1) * sp.stackGap };
  };

  const rects = new Map<string, Rect>();
  const put = (id: string, flow: number, crossAt: number, flowW: number, crossW: number) =>
    rects.set(id, across ? { x: crossAt, y: flow, w: crossW, h: flowW } : { x: flow, y: crossAt, w: flowW, h: crossW });
  const placeNodes = (b: Band, flow0: number, cross0: number) => {
    const { cells, thick } = stack(b);
    for (const [r, ids] of cells) {
      ids.forEach((id, i) => {
        const f = flow0 + slotAt[r]! + (slotLen[r]! - along(id)) / 2;
        const c = cross0 + i * (thick + sp.stackGap) + (thick - cross(id)) / 2;
        put(id, Math.round(f), Math.round(c), along(id), cross(id));
      });
    }
  };

  if (!across) {
    // Bands are rows; every band spans the same flow, so slots line up across pools.
    const laneW = flowLen + 2 * sp.lanePad.side;
    let y = 0;
    for (const root of roots) {
      const poolY = y;
      const x0 = root.pool !== undefined ? sp.poolPad.side : 0;
      if (root.pool !== undefined) y += head(root.pool);
      for (const b of root.bands) {
        const s = stack(b);
        const h = head(b.id) + s.len + sp.lanePad.end;
        placeNodes(b, x0 + sp.lanePad.side, y + head(b.id));
        if (b.id !== undefined) rects.set(b.id, { x: x0, y, w: laneW, h });
        y += h;
      }
      if (root.pool !== undefined) {
        y += sp.poolPad.end;
        rects.set(root.pool, { x: 0, y: poolY, w: laneW + 2 * sp.poolPad.side, h: y - poolY });
      }
      y += sp.bandGap;
    }
    return rects;
  }

  // Bands are columns; the flow starts below the tallest pool and band header so slots line up.
  const poolHead = Math.max(0, ...roots.filter((r) => r.pool !== undefined).map((r) => head(r.pool)));
  const laneHead = Math.max(0, ...roots.flatMap((r) => r.bands.map((b) => head(b.id))));
  const laneH = laneHead + flowLen + sp.lanePad.end;
  let x = 0;
  for (const root of roots) {
    const poolX = x;
    const pooled = root.pool !== undefined;
    if (pooled) x += sp.poolPad.side;
    const top = pooled || roots.some((r) => r.pool !== undefined) ? poolHead : 0;
    for (const b of root.bands) {
      const s = stack(b);
      const w = s.len + 2 * sp.lanePad.side;
      placeNodes(b, top + laneHead, x + sp.lanePad.side);
      if (b.id !== undefined) rects.set(b.id, { x, y: top, w, h: laneH });
      x += w;
    }
    if (pooled) {
      x += sp.poolPad.side;
      rects.set(root.pool!, { x: poolX, y: 0, w: x - poolX, h: poolHead + laneH + sp.poolPad.end });
    }
    x += sp.bandGap;
  }
  return rects;
}
