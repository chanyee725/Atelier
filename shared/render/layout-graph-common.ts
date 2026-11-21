// Small pieces shared by the graph layout files: the rect type, the spacing between siblings and layers,
// the base layout types and the override deltas.

import type { GraphEdge } from '../dsl/index.ts';
import type { ElementStyle, Label } from './common.ts';
import type { Point } from './scene.ts';
import type { GroupGeom, NodeGeom } from './layout-graph-measure.ts';

export type Rect = { x: number; y: number; w: number; h: number };

export const SPACING = {
  /** Same-layer neighbours side by side (vertical flow). */
  neighbour: 40,
  /** Same-layer nodes stacked as a list (horizontal flow). */
  list: 12,
  /** Siblings in a parent that holds groups (the root included): big blocks. */
  block: 48,
  /**
   * Between layers. Eraser uses 56, or 76 when the edges carry labels; ELK gives each edge label a layer
   * of its own, so a labelled gap is already 56 + label + 56 and needs no bigger value.
   */
  layer: 56,
} as const;

/** A laid-out edge before overrides: its ELK route (layout coordinates) and what drawing it needs. */
export interface BaseEdge {
  edge: GraphEdge;
  style: ElementStyle;
  label?: Label;
  points: Point[];
  /** Self loops, ancestor links and parallel edges always draw elbow. */
  forcedElbow: boolean;
  /** Routed by the wrap or divider-row code (#733): the corridor router leaves it alone. */
  ownRoute?: boolean;
  /** Position among the drawn edges joining the same two ends, and how many there are. */
  pairIndex: number;
  pairSize: number;
}

/**
 * The slow, cacheable half of a graph layout: measurements and the ELK result in layout coordinates
 * (ELK root space, before `finishScene` moves everything to start at the padding). Read-only for
 * `composeGraph`, so one base serves every drag preview of the same code.
 */
export interface GraphBase {
  readonly nodes: ReadonlyMap<string, NodeGeom>;
  readonly groups: ReadonlyMap<string, GroupGeom>;
  /** Parent group of every node and group, `undefined` at the root. */
  readonly parent: ReadonlyMap<string, string | undefined>;
  readonly rects: ReadonlyMap<string, Readonly<Rect>>;
  readonly edges: readonly BaseEdge[];
}

/** Layout switches that are not part of the diagram's code. */
export interface GraphLayoutOptions {
  /**
   * Experimental (E65, #276): wrap the top-level groups into rows towards a 3:2 picture instead of one
   * line. Off by default; `right` and `down` flows only.
   */
  wrapGroups?: boolean;
}

export interface Delta {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export const ZERO: Delta = { dx: 0, dy: 0, dw: 0, dh: 0 };
/** Centre-to-corner arithmetic leaves float noise; anything below this is "not moved". */
const EPS = 1e-6;
export const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
export const isZero = (d: Delta): boolean => near(d.dx, 0) && near(d.dy, 0) && near(d.dw, 0) && near(d.dh, 0);
export const sameShift = (a: Delta, b: Delta): boolean =>
  near(a.dw, 0) && near(a.dh, 0) && near(b.dw, 0) && near(b.dh, 0) && near(a.dx, b.dx) && near(a.dy, b.dy);
