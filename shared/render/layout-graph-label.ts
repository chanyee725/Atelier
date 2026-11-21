// Edge ends and labels: clip a line to the drawn outline of a node and place its label plate clear of others.

import { round } from './common.ts';
import type { Label } from './common.ts';
import { PLATE_PAD } from './text.ts';
import type { Point } from './scene.ts';
import type { Rect } from './layout-graph-common.ts';

/** Clip the segment from the centre of `r` towards `p` at the rectangle border. */
function clipToRect(r: { x: number; y: number; w: number; h: number }, p: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Whether `p` is inside the drawn outline of a shape whose bounding box is `r` (rect-like shapes: the box). */
function insideShape(shape: string, r: Rect, p: Point): boolean {
  const u = (p.x - (r.x + r.w / 2)) / (r.w / 2);
  const v = (p.y - (r.y + r.h / 2)) / (r.h / 2);
  if (shape === 'diamond') return Math.abs(u) + Math.abs(v) <= 1;
  if (shape === 'circle' || shape === 'ellipse') return u * u + v * v <= 1;
  return Math.abs(u) <= 1 && Math.abs(v) <= 1;
}

const CURVED = new Set(['diamond', 'circle', 'ellipse']);

/**
 * Move `p` (on the bounding box) along the ray towards `toward` (a point further out on the edge)
 * reversed, i.e. into the node, until it meets the shape outline.
 */
export function snapToShape(shape: string, r: Rect, p: Point, toward: Point): Point {
  if (!CURVED.has(shape)) return p;
  const dx = p.x - toward.x;
  const dy = p.y - toward.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const reach = Math.hypot(r.w, r.h);
  const at = (t: number): Point => ({ x: p.x + (dx / len) * t, y: p.y + (dy / len) * t });
  const N = 64;
  let hi = -1;
  for (let i = 0; i <= N; i++) {
    if (insideShape(shape, r, at((reach * i) / N))) {
      hi = i;
      break;
    }
  }
  if (hi < 0) return p;
  if (hi === 0) return p;
  let lo = (reach * (hi - 1)) / N;
  let up = (reach * hi) / N;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + up) / 2;
    if (insideShape(shape, r, at(mid))) up = mid;
    else lo = mid;
  }
  return at(up);
}

/** Like clipToRect, but to the drawn outline of diamonds, circles and ellipses. */
export function clipToShape(shape: string | undefined, r: Rect, p: Point): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const u = Math.abs(p.x - cx) / (r.w / 2);
  const v = Math.abs(p.y - cy) / (r.h / 2);
  let k = 0;
  if (shape === 'diamond') k = u + v;
  else if (shape === 'circle' || shape === 'ellipse') k = Math.hypot(u, v);
  if (k === 0) return clipToRect(r, p);
  return { x: cx + (p.x - cx) / k, y: cy + (p.y - cy) / k };
}

/** Label centre on the drawn line: the middle of its longest segment (arc: the curve's midpoint). */
function labelAnchor(points: Point[], route: string): Point {
  if (route === 'arc' && points.length === 2) {
    const [p0, p1] = points as [Point, Point];
    return { x: (p0.x + p1.x) / 2 - (p1.y - p0.y) * 0.1, y: (p0.y + p1.y) / 2 + (p1.x - p0.x) * 0.1 };
  }
  let best = 0;
  let at = { x: points[0]!.x, y: points[0]!.y };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best + 0.5) {
      best = len;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return at;
}

/** How far a label that would overlap moves along its line towards the end node (spec §1.7: 22-26 px). */
export const LABEL_SHIFT = 24;

/** Plate rect of a label centred on `c`, as drawn by sceneToSvg. */
export function labelRect(c: Point, label: Label): Rect {
  const w = label.w + PLATE_PAD * 2;
  return { x: c.x - w / 2, y: c.y - label.h / 2 - 2, w, h: label.h + 4 };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Distance under which a label centre counts as sitting on another line (a shared run or a split point). */
const LABEL_LINE_CLEAR = 12;

/** Whether `c` lies on, or right beside, a segment of another edge's route (so the label would read as theirs). */
function onOtherLine(c: Point, others: readonly Point[][]): boolean {
  for (const pts of others) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2)) : 0;
      if (Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) < LABEL_LINE_CLEAR) return true;
    }
  }
  return false;
}

/**
 * Label centre for an edge: the middle of its longest segment, or, when that plate would overlap a label
 * already placed or a node, or sits on another edge's line (a run shared with a sibling, a split point), moved along the
 * line towards the end node in LABEL_SHIFT steps (first clear spot wins; if every spot is near another line, the first one clear of labels and nodes, the middle included; none clear keeps the middle). Records the chosen plate in `placed`. Exported for tests.
 */
export function placeLabel(points: Point[], route: string, label: Label, placed: Rect[], nodeRects: Rect[], others: Point[][] = []): Point {
  const start = labelAnchor(points, route);
  const clear = (c: Point, ignoreLines = false): boolean => {
    const r = labelRect(c, label);
    return !placed.some((o) => overlaps(r, o)) && !nodeRects.some((o) => overlaps(r, o)) && (ignoreLines || !onOtherLine(c, others));
  };
  let best = start;
  if (!clear(start)) {
    // Path from the anchor to the end of the line.
    const last = points[points.length - 1]!;
    let path: Point[] = [start, last];
    if (route !== 'arc') {
      let k = 1;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const t = Math.hypot(b.x - a.x, b.y - a.y);
        if (t > 0 && Math.abs(Math.hypot(start.x - a.x, start.y - a.y) + Math.hypot(b.x - start.x, b.y - start.y) - t) < 0.01) { k = i; break; }
      }
      path = [start, ...points.slice(k)];
    }
    const total = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) : 0), 0);
    const at = (d: number): Point => {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const t = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= t) return t ? { x: a.x + ((b.x - a.x) * d) / t, y: a.y + ((b.y - a.y) * d) / t } : a;
        d -= t;
      }
      return path[path.length - 1]!;
    };
    // Second pass (staggered tracks sit 6 px apart, so every spot can be near another line): the first spot
    // clear of labels and nodes, as before the line check existed. It starts at the middle itself (d = 0),
    // which the first pass skipped only because of the line check.
    search: for (const ignoreLines of [false, true]) {
      for (let d = ignoreLines ? 0 : LABEL_SHIFT; d <= total; d += LABEL_SHIFT) {
        const c = at(d);
        if (clear(c, ignoreLines)) { best = { x: round(c.x), y: round(c.y) }; break search; }
      }
    }
  }
  placed.push(labelRect(best, label));
  return best;
}
