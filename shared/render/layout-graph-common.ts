// Small pieces shared by the graph layout files: the rect type and the spacing between siblings and layers.

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
