// Source order and layers for the graph layout (spec §1.3, §1.4): definition order, undirected edge flow,
// root-level layers and which children are free of edges.

import type { GraphChild, GraphDiagram, GraphEdge } from '../dsl/index.ts';
import type { Band, BandRoot } from './layout-lanes.ts';

/** Definition order of every node and group (pre-order over the source tree). */
export function definitionOrder(d: GraphDiagram): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (c: GraphChild): void => {
    order.set(c.id, order.size);
    if (c.kind === 'group') for (const k of c.children) walk(k);
  };
  for (const c of d.children) walk(c);
  return order;
}

/**
 * Whether ELK should lay `e` out from `to` to `from`. Undirected edges (`-`, `--`) do not set the flow
 * (spec §1.3): they point from the end defined first, so `Access - Distribution` under a `Distribution`
 * defined earlier keeps Distribution in the upper layer.
 */
export function flipped(e: GraphEdge, order: ReadonlyMap<string, number>): boolean {
  if (e.startArrow || e.endArrow) return false;
  return (order.get(e.to) ?? 0) < (order.get(e.from) ?? 0);
}

/**
 * Layer of every root-level item that has an edge: longest path from the sources over the edges between
 * root-level items (an edge into a group counts for the group), in ELK's direction. Approximates the
 * layers ELK will make, so root-level box nodes can share a size per layer (spec §1.1):
 * - a labelled edge spans two layers (ELK gives the label a layer of its own);
 * - a source sits right before its nearest target, as ELK's network-simplex layering pulls it;
 * - items with no edge get no layer (they keep their own size).
 * Edges that close a cycle are ignored.
 */
export function rootLayers(
  d: GraphDiagram,
  parent: ReadonlyMap<string, string | undefined>,
  order: ReadonlyMap<string, number>,
): Map<string, number> {
  const top = (id: string): string | undefined => {
    if (!parent.has(id)) return undefined;
    let cur = id;
    for (let p = parent.get(cur); p !== undefined; p = parent.get(cur)) cur = p;
    return cur;
  };
  const out = new Map<string, { to: string; span: number }[]>();
  const indeg = new Map<string, number>();
  for (const c of d.children) indeg.set(c.id, 0);
  const linked = new Set<string>();
  const seen = new Map<string, { to: string; span: number }>();
  for (const e of d.edges) {
    const flip = flipped(e, order);
    const a = top(flip ? e.to : e.from);
    const b = top(flip ? e.from : e.to);
    if (a === undefined || b === undefined || a === b) continue;
    linked.add(a);
    linked.add(b);
    const span = e.label ? 2 : 1;
    const prev = seen.get(`${a}\u0000${b}`);
    if (prev) {
      prev.span = Math.max(prev.span, span);
      continue;
    }
    const link = { to: b, span };
    seen.set(`${a}\u0000${b}`, link);
    out.set(a, [...(out.get(a) ?? []), link]);
  }
  // Drop back edges (DFS in model order) so the rest is a DAG.
  const state = new Map<string, 1 | 2>();
  const dag = new Map<string, { to: string; span: number }[]>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const n of out.get(id) ?? []) {
      if (state.get(n.to) === 1) continue;
      dag.set(id, [...(dag.get(id) ?? []), n]);
      indeg.set(n.to, (indeg.get(n.to) ?? 0) + 1);
      if (!state.has(n.to)) visit(n.to);
    }
    state.set(id, 2);
  };
  for (const c of d.children) if (!state.has(c.id)) visit(c.id);
  const layer = new Map<string, number>();
  const queue = d.children.map((c) => c.id).filter((id) => indeg.get(id) === 0 && linked.has(id));
  const sources = [...queue];
  for (const id of queue) layer.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const n of dag.get(id) ?? []) {
      layer.set(n.to, Math.max(layer.get(n.to) ?? 0, layer.get(id)! + n.span));
      indeg.set(n.to, indeg.get(n.to)! - 1);
      if (indeg.get(n.to) === 0) queue.push(n.to);
    }
  }
  for (const id of sources) {
    const next = (dag.get(id) ?? []).map((n) => (layer.get(n.to) ?? 0) - n.span);
    if (next.length > 0) layer.set(id, Math.max(0, Math.min(...next)));
  }
  return layer;
}

/**
 * Which children are free: a node no edge touches, or a group no edge crosses (edges inside it are fine,
 * it gets laid out on its own). Free siblings go in a grid instead of ELK's first layer (spec §1.4).
 */
export function freeChildren(edges: readonly GraphEdge[], parent: ReadonlyMap<string, string | undefined>): (c: GraphChild) => boolean {
  const touched = new Set<string>();
  const crossed = new Set<string>();
  const chain = (id: string): string[] => {
    const out = [id];
    for (let p = parent.get(id); p !== undefined; p = parent.get(p)) out.push(p);
    return out;
  };
  for (const e of edges) {
    touched.add(e.from);
    touched.add(e.to);
    const a = chain(e.from);
    const b = chain(e.to);
    for (const x of a) if (!b.includes(x)) crossed.add(x);
    for (const x of b) if (!a.includes(x)) crossed.add(x);
  }
  return (c) => (c.kind === 'node' ? !touched.has(c.id) : !crossed.has(c.id));
}

/**
 * Bands for a flowchart whose flow goes back and forth between root groups (#1066): the flow between root
 * items (an edge counts for the groups of its ends) has a cycle through at least two groups. ELK would keep
 * each group as one block and send the flow back across the picture; instead every root group becomes a
 * band across the flow (a row in a `right` flow, a column in a `down` one), in source order, and every node
 * a slot along the flow. Root nodes outside the groups share one band with no box.
 *
 * Only flat diagrams: groups hold nodes only, no dividers, no edge to a group, `right` or `down`.
 * Anything else returns undefined and keeps the ELK layout.
 */
export function crossGroupBands(d: GraphDiagram, order: ReadonlyMap<string, number>): BandRoot[] | undefined {
  if ((d.type !== 'flowchart' && d.type !== 'cloud-architecture') || (d.direction !== 'right' && d.direction !== 'down')) return undefined;
  const top = new Map<string, string>();
  const isDivider = (c: GraphChild): boolean => c.kind === 'node' && String(c.attrs.shape ?? '') === 'divider';
  for (const c of d.children) {
    if (isDivider(c)) return undefined;
    if (c.kind === 'node') top.set(c.id, c.id);
    else for (const k of c.children) {
      if (k.kind === 'group' || isDivider(k)) return undefined;
      top.set(k.id, c.id);
    }
  }
  const groups = new Set(d.children.filter((c) => c.kind === 'group').map((c) => c.id));
  if (groups.size < 2) return undefined;
  const links = new Map<string, Set<string>>();
  for (const e of d.edges) {
    if (groups.has(e.from) || groups.has(e.to)) return undefined;
    const flip = flipped(e, order);
    const a = top.get(flip ? e.to : e.from);
    const b = top.get(flip ? e.from : e.to);
    if (a === undefined || b === undefined || a === b) continue;
    links.set(a, (links.get(a) ?? new Set()).add(b));
  }
  // A cycle through two groups: some group reaches another group that reaches it back.
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      for (const n of links.get(stack.pop()!) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return seen;
  };
  const reached = new Map([...groups].map((g) => [g, reach(g)]));
  const backAndForth = [...groups].some((g) => [...reached.get(g)!].some((h) => h !== g && groups.has(h) && reached.get(h)!.has(g)));
  if (!backAndForth) return undefined;

  const roots: BandRoot[] = [];
  let loose: Band | undefined;
  for (const c of d.children) {
    if (c.kind === 'group') roots.push({ bands: [{ id: c.id, nodes: c.children.map((k) => k.id) }] });
    else if (loose) loose.nodes.push(c.id);
    else roots.push({ bands: [(loose = { nodes: [c.id] })] });
  }
  return roots;
}
