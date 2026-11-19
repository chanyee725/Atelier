import { Cursor, endStatement, GRAPH_KEYS, parseKeywordValue } from './common.ts';
import { parseGraph } from './graph.ts';
import type {
  BpmnDiagram, BpmnLane, BpmnNode, BpmnNodeType, BpmnPool, GraphChild, GraphDiagram, GraphGroup, GraphNode,
} from './types.ts';

export const BPMN_KEYS = new Set([...GRAPH_KEYS, 'type']);
const NODE_TYPES: readonly string[] = ['activity', 'event', 'gateway'];
const LAYOUTS: readonly string[] = ['compact', 'sequential'];

/**
 * BPMN (swimlane), Eraser syntax: a root `{ }` with lanes inside is a pool, a `{ }` holding nodes is a lane,
 * nodes take `type: activity | event | gateway`, and connections link nodes (ones to pools or lanes are ignored).
 * Parsed with the graph parser, then reshaped into flat pools, lanes and nodes.
 */
export function parseBpmn(c: Cursor): BpmnDiagram {
  let layout: BpmnDiagram['layout'] = 'compact';
  const graph = parseGraph(c, 'cloud-architecture', {
    keys: BPMN_KEYS,
    keyword: (cur) => {
      const t = cur.peek();
      const nx = cur.peek(1);
      if (t.kind !== 'word' || t.text !== 'layout') return false;
      if (nx.kind !== 'colon' && !(nx.kind === 'word' && LAYOUTS.includes(nx.text))) return false;
      const kv = parseKeywordValue(cur);
      if (kv) {
        if (LAYOUTS.includes(kv.value)) layout = kv.value as BpmnDiagram['layout'];
        else cur.warn(kv.span, `Unknown layout '${kv.value}'. Use one of: ${LAYOUTS.join(', ')}`);
      }
      endStatement(cur);
      return true;
    },
  });

  const { type: _type, children, edges: graphEdges, direction, ...base } = graph;
  const ast: BpmnDiagram = { ...base, type: 'bpmn', direction, layout, pools: [], lanes: [], nodes: [], edges: [] };
  const containers = new Set<string>();

  const meta = (g: GraphGroup) => ({ id: g.id, name: g.name, label: g.label, attrs: g.attrs, span: g.span });

  const addNode = (n: GraphNode, lane?: BpmnLane, pool?: BpmnPool) => {
    const raw = n.attrs.type;
    let type: BpmnNodeType = 'activity';
    if (raw !== undefined) {
      if (NODE_TYPES.includes(raw)) type = raw as BpmnNodeType;
      else c.warn(n.span, `Unknown BPMN type '${raw}'. Use one of: ${NODE_TYPES.join(', ')}`);
    }
    const node: BpmnNode = {
      id: n.id, name: n.name, label: n.label, attrs: n.attrs, type, implicit: n.implicit, span: n.span,
    };
    if (n.code) node.code = n.code;
    if (lane) {
      node.lane = lane.id;
      lane.nodes.push(n.id);
    }
    if (pool) node.pool = pool.id;
    ast.nodes.push(node);
  };

  /** Every node under `g`, however deep; deeper groups are flattened into the lane. */
  const fillLane = (items: GraphChild[], lane: BpmnLane, pool?: BpmnPool) => {
    for (const item of items) {
      if (item.kind === 'node') addNode(item, lane, pool);
      else {
        c.error(item.span, `Lane '${lane.name}' cannot hold another group '${item.name}'. Put its nodes in the lane`);
        containers.add(item.id);
        fillLane(item.children, lane, pool);
      }
    }
  };

  const addLane = (g: GraphGroup, pool?: BpmnPool) => {
    const lane: BpmnLane = { ...meta(g), nodes: [] };
    if (pool) {
      lane.pool = pool.id;
      pool.lanes.push(g.id);
    }
    ast.lanes.push(lane);
    containers.add(g.id);
    fillLane(g.children, lane, pool);
  };

  for (const item of children) {
    if (item.kind === 'node') {
      addNode(item);
      continue;
    }
    containers.add(item.id);
    if (!item.children.some((ch) => ch.kind === 'group')) {
      addLane(item);
      continue;
    }
    const pool: BpmnPool = { ...meta(item), lanes: [] };
    ast.pools.push(pool);
    for (const ch of item.children) {
      if (ch.kind === 'group') addLane(ch, pool);
      else {
        c.warn(ch.span, `'${ch.name}' sits in pool '${item.name}' outside every lane. Put it in a lane`);
        addNode(ch, undefined, pool);
      }
    }
  }

  for (const e of graphEdges) {
    const bad = [e.from, e.to].find((id) => containers.has(id));
    if (bad) c.warn(e.span, `Connections to pools and lanes are ignored ('${bad}'). Connect nodes instead`);
    else ast.edges.push(e);
  }

  const incoming = new Set(ast.edges.map((e) => e.to));
  const outgoing = new Set(ast.edges.map((e) => e.from));
  for (const n of ast.nodes) {
    if (n.type !== 'event') continue;
    n.eventRole = !incoming.has(n.id) ? 'start' : !outgoing.has(n.id) ? 'end' : 'intermediate';
  }
  return ast;
}

/**
 * The same diagram as plain graph groups (pool > lane > node), so a graph layout can draw it until a lane
 * layout exists. Gateways become diamonds and events circles.
 */
export function bpmnAsGraph(d: BpmnDiagram): GraphDiagram {
  const { type: _type, layout: _layout, direction, pools, lanes, nodes, edges, ...base } = d;
  const shapes: Record<BpmnNodeType, string | undefined> = { activity: undefined, event: 'circle', gateway: 'diamond' };
  const toNode = (n: BpmnNode): GraphNode => {
    const shape = n.attrs.shape ?? shapes[n.type];
    const node: GraphNode = {
      kind: 'node', id: n.id, name: n.name, label: n.label, attrs: shape ? { ...n.attrs, shape } : n.attrs,
      implicit: n.implicit, span: n.span,
    };
    if (n.code) node.code = n.code;
    return node;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const laneGroup = (l: BpmnLane): GraphGroup => ({
    kind: 'group', id: l.id, name: l.name, label: l.label, attrs: l.attrs, span: l.span,
    children: l.nodes.map((id) => toNode(byId.get(id)!)),
  });
  const poolGroup = (p: BpmnPool): GraphGroup => ({
    kind: 'group', id: p.id, name: p.name, label: p.label, attrs: p.attrs, span: p.span,
    children: [
      ...p.lanes.map((id) => laneGroup(laneById.get(id)!)),
      ...nodes.filter((n) => n.pool === p.id && !n.lane).map(toNode),
    ],
  });
  // Root order follows the source: pools, loose lanes and loose nodes by position.
  const roots: { at: number; make: () => GraphChild }[] = [
    ...pools.map((p) => ({ at: p.span.offset, make: () => poolGroup(p) })),
    ...lanes.filter((l) => !l.pool).map((l) => ({ at: l.span.offset, make: () => laneGroup(l) })),
    ...nodes.filter((n) => !n.pool && !n.lane).map((n) => ({ at: n.span.offset, make: () => toNode(n) })),
  ];
  roots.sort((a, b) => a.at - b.at);
  return { ...base, type: 'flowchart', direction, children: roots.map((r) => r.make()), edges };
}
