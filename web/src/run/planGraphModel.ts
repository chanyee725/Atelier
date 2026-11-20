// 플랜 tab (#729): the pipeline plan as its own diagram, steps as nodes and arrows for the order they run in, each
// node painted with its live state (#687 colours and agent initial badges). Pure: no DOM, so it runs under
// `node --test`. Laid out left to right by dependency depth; rows keep the plan's step order.
// #935: drawn like the document diagrams (eraser-diagrams rules): 200×56 box nodes and orthogonal (elbow) arrows.

import type { Plan } from '../../../shared/dispatch/plan.ts';
import { planOrderIn } from '../../../shared/dispatch/plan-diagram.ts';
import { nodeStatus, type NodeStatus } from './nodeStatus.ts';
import { agentColors, nodeBadges, roleLabel, type NodeBadges, type RunStep } from './overlayModel.ts';

/** Node box (the eraser-diagrams 200 width bucket and 56 height) and gaps, in px. */
export const NODE_W = 200;
export const NODE_H = 56;
export const GAP_X = 72;
export const GAP_Y = 32;
/** Room above a node for its badges and around the picture. */
export const PAD = 24;

export interface PlanGraphNode {
  id: string;
  /** 1-based position in the plan. */
  n: number;
  title: string;
  /** The step's role (`lead`, `impl`...): its icon and colour. */
  role: string;
  /** Dependency depth (column) and place in it (row). */
  col: number;
  row: number;
  x: number;
  y: number;
  status: NodeStatus;
  /** A session runs on it now: the ring pulses. */
  live: boolean;
  badges: NodeBadges;
  /** Accessible name: `2 구현 · 진행 · Juno(구현자)`. */
  label: string;
}

export interface PlanGraphEdge {
  key: string;
  from: string;
  to: string;
  /** Orthogonal SVG path from the source's right edge to the target's left edge (one elbow pair when rows differ). */
  d: string;
  /** The source step finished. */
  done: boolean;
}

export interface PlanGraph {
  nodes: PlanGraphNode[];
  edges: PlanGraphEdge[];
  width: number;
  height: number;
  /** Why the order could not be read (missing block, cycle...); the steps then show in plan order without arrows. */
  problem: string | null;
}

type Block = { id: string; type: string; code: string };

/**
 * `steps`: the run's step views by step id (runModel overlaySteps); a step without one is 대기.
 * `labels`: node id → label from the plan block's code.
 */
export function planGraph(plan: Plan, blocks: readonly Block[], steps: readonly RunStep[] = [], labels: ReadonlyMap<string, string> = new Map()): PlanGraph {
  const order = planOrderIn(plan, blocks);
  const after: Record<string, string[]> = order.ok ? order.after : Object.fromEntries(plan.steps.map((s) => [s.id, []]));
  const ids = order.ok ? order.order : plan.steps.map((s) => s.id);
  const pos = new Map(plan.steps.map((s, i) => [s.id, i]));

  // Column: one past the deepest dependency, walked in run order so dependencies come first.
  const col = new Map<string, number>();
  for (const id of ids) col.set(id, Math.max(-1, ...(after[id] ?? []).map((a) => col.get(a) ?? 0)) + 1);
  const rows = new Map<number, string[]>();
  for (const s of plan.steps) {
    const c = col.get(s.id) ?? 0;
    rows.set(c, [...(rows.get(c) ?? []), s.id]);
  }

  const byId = new Map(steps.map((s) => [s.id, s]));
  const colors = agentColors(plan.steps.map((s) => byId.get(s.id)).filter((s): s is RunStep => !!s));
  const nodes: PlanGraphNode[] = plan.steps.map((s) => {
    const c = col.get(s.id) ?? 0;
    const r = rows.get(c)!.indexOf(s.id);
    const run = byId.get(s.id);
    const view = run?.view ?? 'pending';
    const status = nodeStatus({ view, failed: run?.failed, waiting: run?.waiting });
    const agents = run?.agents ?? [];
    const title = run?.title ?? labels.get(s.node) ?? s.node;
    const n = pos.get(s.id)! + 1;
    const who = agents.map((a) => `${a.name}(${roleLabel(a.role)})`).join(', ');
    return {
      id: s.id,
      n,
      title,
      role: s.role ?? run?.agents?.[0]?.role ?? '',
      col: c,
      row: r,
      x: PAD + c * (NODE_W + GAP_X),
      y: PAD + r * (NODE_H + GAP_Y),
      status,
      live: status.tone === 'active',
      badges: nodeBadges(agents, colors),
      label: [`${n} ${title}`, status.label, ...(who ? [who] : [])].join(' · '),
    };
  });

  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges: PlanGraphEdge[] = [];
  for (const s of plan.steps) {
    for (const a of after[s.id] ?? []) {
      const from = at.get(a);
      const to = at.get(s.id);
      if (!from || !to) continue;
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      const d = y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
      edges.push({ key: `${a}>${s.id}`, from: a, to: s.id, d, done: from.status.tone === 'done' });
    }
  }

  const cols = Math.max(0, ...nodes.map((n) => n.col + 1));
  const tall = Math.max(0, ...[...rows.values()].map((r) => r.length));
  return {
    nodes,
    edges,
    width: cols ? PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X : 0,
    height: tall ? PAD * 2 + tall * NODE_H + (tall - 1) * GAP_Y : 0,
    problem: order.ok ? null : order.problem,
  };
}
