// Grid packing for free siblings (spec §1.4, §1.5): row-first grids of laid-out pieces and the column counts they use.

import type { GraphDiagram } from '../dsl/index.ts';
import { round } from './common.ts';
import type { Point } from './scene.ts';
import { SPACING } from './layout-graph-common.ts';
import type { Rect } from './layout-graph-common.ts';

/** Grid cell gaps between free nodes (spec §1.4): across, down. */
export const GRID_GAP = { x: 16, y: 12 } as const;
/** Gaps between free sibling groups (spec §1.5): side by side in one row, stacked bands. */
export const BAND_GAP = { row: 24, stack: 12 } as const;
/** Width : height the block of free groups aims for when picking its column count. */
export const BAND_ASPECT = 1.5;
/** Most cells in one grid row. */
const GRID_MAX_COLS = 5;

/** Columns of a row-first grid of `n` cells: one row up to GRID_MAX_COLS, then about 3:2 wide. */
export function gridColumns(n: number): number {
  return n <= GRID_MAX_COLS ? Math.max(1, n) : Math.min(GRID_MAX_COLS, Math.ceil(Math.sqrt(n * 1.5)));
}

/**
 * Columns for free sibling groups: the count (1 to GRID_MAX_COLS) whose block comes closest to
 * BAND_ASPECT. Wide bands (a capability row) stack in one column; small boxes share rows.
 */
export function bandColumns(items: readonly { w: number; h: number }[]): number {
  let best = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= Math.min(GRID_MAX_COLS, items.length); cols++) {
    const p = packGrid(items.map((it) => ({ ...it, rects: new Map(), edges: new Map() })), cols, BAND_GAP.row, BAND_GAP.stack, false);
    const score = Math.abs(Math.log(p.w / p.h / BAND_ASPECT));
    if (score < bestScore - 1e-9) {
      best = cols;
      bestScore = score;
    }
  }
  return best;
}

/** Laid-out part of a diagram in its own coordinates: rects of everything in it and its edge routes. */
export interface Piece {
  w: number;
  h: number;
  rects: Map<string, Rect>;
  edges: Map<string, Point[]>;
}

/** Copy `from` into `into`, moved by (dx, dy). */
export function placePiece(into: Piece, from: Piece, dx: number, dy: number): void {
  for (const [id, r] of from.rects) into.rects.set(id, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
  for (const [id, pts] of from.edges) into.edges.set(id, pts.map((p) => ({ x: round(p.x + dx), y: round(p.y + dy) })));
}

/**
 * Row-first grid of `items`: every column as wide as its widest cell, every row as tall as its tallest.
 * `center` centres an item in its cell; otherwise it sits at the cell's top-left.
 */
export function packGrid(items: readonly Piece[], cols: number, gapX: number, gapY: number, center: boolean): Piece {
  const colW: number[] = [];
  const rowH: number[] = [];
  items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, it.w);
    rowH[r] = Math.max(rowH[r] ?? 0, it.h);
  });
  const xs: number[] = [];
  const ys: number[] = [];
  colW.reduce((x, w, c) => ((xs[c] = x), x + w + gapX), 0);
  rowH.reduce((y, h, r) => ((ys[r] = y), y + h + gapY), 0);
  const out: Piece = {
    w: colW.reduce((a, b) => a + b, 0) + gapX * (colW.length - 1),
    h: rowH.reduce((a, b) => a + b, 0) + gapY * (rowH.length - 1),
    rects: new Map(),
    edges: new Map(),
  };
  items.forEach((it, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const dx = center ? (colW[c]! - it.w) / 2 : 0;
    const dy = center ? (rowH[r]! - it.h) / 2 : 0;
    placePiece(out, it, xs[c]! + dx, ys[r]! + dy);
  });
  return out;
}

/**
 * Put `tail` after the laid-out content of `piece` in the flow direction (right of it, under it, ...), one
 * big-block gap away and lined up with its start, and grow `piece` to hold it.
 */
export function attachTail(piece: Piece, tail: Piece, direction: GraphDiagram['direction']): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of piece.rects.values()) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const gap = SPACING.block;
  const at =
    direction === 'right' ? { x: x1 + gap, y: y0 }
    : direction === 'left' ? { x: x0 - gap - tail.w, y: y0 }
    : direction === 'up' ? { x: x0, y: y0 - gap - tail.h }
    : { x: x0, y: y1 + gap };
  placePiece(piece, tail, at.x, at.y);
  piece.w = Math.max(piece.w, at.x + tail.w);
  piece.h = Math.max(piece.h, at.y + tail.h);
}
