// After the corridor router (#1066, docs/research/eraser/09-examples-style.md §1.7): lines that fan out of
// one side of a node (or into one) share a port and a trunk instead of running side by side a few pixels
// apart, and a label sits in the middle of the longest stretch that is its line's own.

import type { Point } from './scene.ts';
import type { Rect } from './layout-graph-common.ts';
import type { RoutedEdge } from './route-eraser.ts';

/** How far from its node a trunk splits, when the lines it joins allow (spec §1.7: 24 px out of the source). */
export const TRUNK_GAP = 24;
/** A trunk keeps this far from every node it passes. */
const CLEARANCE = 3;
/** Room a label needs at each end of the stretch it sits on. */
const LABEL_END = 6;

export interface TrunkEdge {
  id: string;
  from: string;
  to: string;
  /** Label plate size. */
  label?: { w: number; h: number };
}

type Side = 'left' | 'right' | 'top' | 'bottom';

const horizontal = (a: Point, b: Point): boolean => Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5;
const vertical = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5;

/** The side of its node a route leaves from: the direction of its first segment. */
function exitSide(pts: readonly Point[]): Side | undefined {
  const [a, b] = pts;
  if (!a || !b) return undefined;
  if (horizontal(a, b)) return b.x > a.x ? 'right' : 'left';
  if (vertical(a, b)) return b.y > a.y ? 'bottom' : 'top';
  return undefined;
}

function hitsRect(r: Rect, p: Point, q: Point, margin: number): boolean {
  return Math.max(p.x, q.x) > r.x - margin && Math.min(p.x, q.x) < r.x + r.w + margin && Math.max(p.y, q.y) > r.y - margin && Math.min(p.y, q.y) < r.y + r.h + margin;
}

/** Whether two axis-aligned segments run on one line and share more than a pixel of it. */
function runsOn(p: Point, q: Point, r: Point, s: Point): boolean {
  const shared = (a0: number, a1: number, b0: number, b1: number): number => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  if (horizontal(p, q) && horizontal(r, s)) return Math.abs(p.y - r.y) < 1 && shared(p.x, q.x, r.x, s.x) > 1;
  if (vertical(p, q) && vertical(r, s)) return Math.abs(p.x - r.x) < 1 && shared(p.y, q.y, r.y, s.y) > 1;
  return false;
}

/** A member of a trunk: a Z route (two bends) read from the trunk's node outwards. */
interface Member {
  e: TrunkEdge;
  /** Route from the hub outwards (reversed for a fan-in). */
  pts: Point[];
  reversed: boolean;
}

/**
 * Join the Z routes that leave one side of a node for different nodes on one port and one trunk, then the
 * ones that enter one side from different nodes. A group is left alone when the trunk would pass through
 * a node, run along another line, or when another line's port sits between the ports it joins. Rewrites
 * `routes` in place and returns, per joined edge, the stretch of its line no other member shares.
 */
export function shareTrunks(routes: Map<string, RoutedEdge>, edges: readonly TrunkEdge[], nodes: ReadonlyMap<string, Rect>): Map<string, [Point, Point][]> {
  const own = new Map<string, [Point, Point][]>();
  const pairs = new Map<string, number>();
  for (const e of edges) {
    const k = [e.from, e.to].sort().join('\u0000');
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  const single = (e: TrunkEdge): boolean => pairs.get([e.from, e.to].sort().join('\u0000')) === 1;
  const joined = new Set<string>();

  for (const fanIn of [false, true]) {
    const groups = new Map<string, Member[]>();
    for (const e of edges) {
      const r = routes.get(e.id);
      if (!r || r.points.length !== 4 || joined.has(e.id) || !single(e)) continue;
      const pts = fanIn ? [...r.points].reverse() : [...r.points];
      const side = exitSide(pts);
      // A Z: out along the side's normal, across, and on along the normal.
      const flat = side === 'left' || side === 'right';
      if (!side || !(flat ? vertical(pts[1]!, pts[2]!) && horizontal(pts[2]!, pts[3]!) : horizontal(pts[1]!, pts[2]!) && vertical(pts[2]!, pts[3]!))) continue;
      const key = `${fanIn ? e.to : e.from}\u0000${side}`;
      groups.set(key, [...(groups.get(key) ?? []), { e, pts, reversed: fanIn }]);
    }
    for (const [key, members] of groups) {
      const hub = key.slice(0, key.indexOf('\u0000'));
      const side = key.slice(key.indexOf('\u0000') + 1) as Side;
      if (members.length < 2 || new Set(members.map((m) => (fanIn ? m.e.from : m.e.to))).size < 2) continue;
      const flat = side === 'left' || side === 'right';
      // u runs along the side, v along its normal.
      const u = (p: Point): number => (flat ? p.y : p.x);
      const v = (p: Point): number => (flat ? p.x : p.y);
      const at = (uu: number, vv: number): Point => (flat ? { x: vv, y: uu } : { x: uu, y: vv });
      const sign = side === 'right' || side === 'bottom' ? 1 : -1;
      const v0 = v(members[0]!.pts[0]!);
      if (members.some((m) => Math.abs(v(m.pts[0]!) - v0) > 0.5)) continue;
      const ports = members.map((m) => u(m.pts[0]!));
      const lo = Math.min(...ports);
      const hi = Math.max(...ports);
      const ids = new Set(members.map((m) => m.e.id));
      // Another line's port between the joined ones would end up on the trunk's port.
      let blocked = false;
      for (const e of edges) {
        const r = routes.get(e.id);
        if (!r || ids.has(e.id)) continue;
        for (const [node, p] of [[e.from, r.points[0]!], [e.to, r.points[r.points.length - 1]!]] as const) {
          if (node === hub && Math.abs(v(p) - v0) < 0.5 && u(p) > lo - 0.5 && u(p) < hi + 0.5) blocked = true;
        }
      }
      if (blocked) continue;
      const port = Math.round(ports.reduce((s, p) => s + p, 0) / ports.length);
      const reach = Math.min(...members.map((m) => sign * (v(m.pts[1]!) - v0)));
      const levels = [...new Set([Math.min(TRUNK_GAP, reach), reach])].map((d) => v0 + sign * d);
      const others = edges.filter((e) => !ids.has(e.id) && routes.has(e.id)).map((e) => routes.get(e.id)!.points);
      const plan = (level: number): Point[][] | undefined => {
        const out: Point[][] = [];
        for (const m of members) {
          const end = m.pts[3]!;
          const pts = Math.abs(u(end) - port) < 0.5 ? [at(port, v0), at(port, v(end))] : [at(port, v0), at(port, level), at(u(end), level), end];
          for (let k = 1; k < pts.length; k++) {
            for (const [id, r] of nodes) if (id !== m.e.from && id !== m.e.to && hitsRect(r, pts[k - 1]!, pts[k]!, CLEARANCE)) return undefined;
            for (const o of others) for (let j = 1; j < o.length; j++) if (runsOn(pts[k - 1]!, pts[k]!, o[j - 1]!, o[j]!)) return undefined;
          }
          out.push(pts);
        }
        return out;
      };
      let level = levels[0]!;
      let planned: Point[][] | undefined;
      for (const l of levels) {
        planned = plan(l);
        level = l;
        if (planned) break;
      }
      if (!planned) continue;
      // Own stretches: the branch into the far node, and the part of the trunk between this member's
      // branch and the previous one (shared only with members that branch further out).
      const order = members.map((m, i) => ({ i, t: u(m.pts[3]!) - port }));
      members.forEach((m, i) => {
        const pts = planned![i]!;
        const prev = routes.get(m.e.id)!;
        routes.set(m.e.id, { ...prev, points: m.reversed ? [...pts].reverse() : pts });
        joined.add(m.e.id);
        const t = order[i]!.t;
        const stretches: [Point, Point][] = [];
        if (pts.length === 4) {
          stretches.push([pts[2]!, pts[3]!]);
          const nearer = order.filter((o) => o.i !== i && Math.sign(o.t) === Math.sign(t) && Math.abs(o.t) < Math.abs(t)).map((o) => o.t);
          const from = nearer.length ? (t > 0 ? Math.max(...nearer) : Math.min(...nearer)) : 0;
          stretches.push([at(port + from, level), pts[2]!]);
        } else stretches.push([pts[0]!, pts[1]!]);
        own.set(m.e.id, stretches);
      });
    }
  }
  return own;
}

const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Put every label in the middle of the longest stretch of its line (spec §1.7), for a trunk member the
 * longest stretch that is its own. A spot is taken only when the plate fits on the stretch and stays clear
 * of nodes, other labels and other lines; else the label keeps the router's place when that is still on its
 * line, and falls back to the middle of the longest stretch.
 */
export function settleLabels(routes: Map<string, RoutedEdge>, edges: readonly TrunkEdge[], nodes: ReadonlyMap<string, Rect>, own: ReadonlyMap<string, [Point, Point][]>): void {
  const plate = (c: Point, l: { w: number; h: number }): Rect => ({ x: c.x - l.w / 2, y: c.y - l.h / 2, w: l.w, h: l.h });
  const placed = new Map<string, Rect>();
  const labelled = edges.filter((e) => e.label && routes.get(e.id)?.label);
  for (const e of labelled) placed.set(e.id, plate(routes.get(e.id)!.label!, e.label!));
  const len = ([a, b]: [Point, Point]): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const onRoute = (c: Point, pts: readonly Point[]): boolean => pts.some((q, k) => k > 0 && hitsRect({ x: c.x, y: c.y, w: 0, h: 0 }, pts[k - 1]!, q, 1));
  for (const e of labelled) {
    const r = routes.get(e.id)!;
    const l = e.label!;
    const mine = own.get(e.id);
    const segs = (mine ?? r.points.slice(1).map((p, i): [Point, Point] => [r.points[i]!, p])).filter((s) => len(s) > 0);
    const clear = (c: Point): boolean => {
      const box = plate(c, l);
      for (const n of nodes.values()) if (overlap(box, n)) return false;
      for (const [id, o] of placed) if (id !== e.id && overlap(box, o)) return false;
      for (const o of edges) {
        const pts = o.id === e.id ? undefined : routes.get(o.id)?.points;
        if (!pts) continue;
        // A sibling on the same trunk shares part of this line: only its own stretches count.
        const theirs = own.has(o.id) && mine ? own.get(o.id)! : pts.slice(1).map((p, i): [Point, Point] => [pts[i]!, p]);
        for (const [a, b] of theirs) if (hitsRect(box, a, b, 0)) return false;
      }
      return true;
    };
    const fits = (s: [Point, Point]): boolean => len(s) >= (horizontal(s[0], s[1]) ? l.w : l.h) + 2 * LABEL_END;
    const mid = ([a, b]: [Point, Point]): Point => ({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
    const byLength = [...segs].sort((a, b) => len(b) - len(a));
    const spot = byLength.filter(fits).map(mid).find(clear);
    const next = spot ?? (onRoute(r.label!, r.points) ? r.label! : byLength[0] ? mid(byLength[0]) : r.label!);
    routes.set(e.id, { ...r, label: next });
    placed.set(e.id, plate(next, l));
  }
}
