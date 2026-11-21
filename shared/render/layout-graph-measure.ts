// Node and group sizes for the graph layout (spec §1.1, §2.1): width buckets, box cards, dividers, subtitles.

import type { GraphDiagram, GraphGroup, GraphNode } from '../dsl/index.ts';
import { fontSize, measureLabel, round, styleFor } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { RUN_BAND } from './badge.ts';
import type { ShapeKind } from './scene.ts';
import { nodeAutoIcon } from './auto-icon.ts';

const SHAPES: readonly ShapeKind[] = [
  'rectangle', 'circle', 'cylinder', 'diamond', 'document', 'ellipse',
  'hexagon', 'oval', 'parallelogram', 'star', 'trapezoid', 'triangle',
];
export const NODE_TEXT_MAX = 160;
// Eraser-like sizes and spacing, from the survey of its public examples
// (docs/research/eraser/09-examples-style.md §1.1, §1.5, §1.6).
/** Box nodes take a fixed width from these buckets instead of hugging their text. */
const WIDTH_BUCKETS = [160, 200, 260] as const;
/** Lines a label may wrap to before the node moves up a width bucket. */
const MAX_LINES = 3;
/** Box height for one line, and the least for two (title + subtitle). More text grows it by NODE_PAD_Y. */
const NODE_MIN_H = 52;
const NODE_TWO_LINE_H = 56;
/** Space a box node keeps around its content: left + right, top + bottom. */
const NODE_PAD_X = 32;
const NODE_PAD_Y = 12;
/**
 * Box card (spec §2.1, issue #114): an architecture node with an icon draws as a box with the icon on the
 * left, CARD_INSET from the edge, and its text centred in the room right of the icon (CARD_RIGHT from the edge).
 */
export const CARD_INSET = 20;
export const CARD_RIGHT = 16;
/** Subtitle (`subtitle:`) size relative to the title (Eraser 10.44 / 13.05), and the gap above it. */
const SUBTITLE_SCALE = 0.8;
export const SUBTITLE_GAP = 2;
/** Shapes that get width buckets and one size per group. The rest keep shape-specific sizing. */
const BUCKETED: ReadonlySet<ShapeKind> = new Set(['rectangle', 'cylinder', 'document']);
/**
 * Divider (`shape: divider`, spec §2.1, issue #115): a 1.3px line broken by its label in the middle. Its label
 * is the group-title size (12.18 / 13.05), its box at least DIVIDER_MIN_W wide, with DIVIDER_GAP either side of
 * the label before the line resumes.
 */
const DIVIDER_SCALE = 0.93;
const DIVIDER_MIN_W = 200;
export const DIVIDER_GAP = 8;
const DIVIDER_H = 28;
/** Group padding around its children; `top` includes the title line. */
export const GROUP_PAD = { top: 40, side: 16, bottom: 14 } as const;

export interface NodeGeom {
  node: GraphNode;
  style: ElementStyle;
  label: Label;
  shape: ShapeKind;
  /** `nodeStyle icon`: architecture nodes with an icon draw as a big icon with the label underneath, no box. */
  iconOnly: boolean;
  /** Box card: icon on the left, text centred in the rest (architecture nodes with an icon, the default). */
  card: boolean;
  /** `shape: divider`: a line broken by the label instead of a box. */
  divider?: boolean;
  iconSize: number;
  /** The icon drawn: `icon:` or the automatic one from the label (#734). */
  icon?: string;
  /** Second line from `subtitle:`, smaller and muted. */
  sub?: Label;
  w: number;
  h: number;
}

export interface GroupGeom {
  group: GraphGroup;
  style: ElementStyle;
  label: Label;
  iconSize: number;
  header: number;
  minW: number;
}

const subtitleOf = (node: GraphNode): string | undefined => node.attrs.subtitle?.trim() || undefined;

/** The subtitle label, wrapped to `maxWidth`. */
function measureSub(node: GraphNode, style: ElementStyle, maxWidth: number): Label | undefined {
  const text = subtitleOf(node);
  return text === undefined ? undefined : measureLabel(text, round(fontSize(style) * SUBTITLE_SCALE), style.typeface, style.wrap, maxWidth);
}

/** Height of the title plus the subtitle under it. */
export const textHeight = (label: Label, sub: Label | undefined): number => label.h + (sub ? SUBTITLE_GAP + sub.h : 0);

export function measureNode(d: GraphDiagram, node: GraphNode): NodeGeom {
  const icon = node.attrs.icon ?? nodeAutoIcon(d, node);
  const geom = measureNodeWith(d, node, icon);
  return geom.iconSize ? { ...geom, icon } : geom;
}

function measureNodeWith(d: GraphDiagram, node: GraphNode, icon: string | undefined): NodeGeom {
  const style = styleFor(d, node.attrs, node.span.line);
  const size = fontSize(style);
  const shapeAttr = node.attrs.shape?.toLowerCase();
  if (shapeAttr === 'divider') {
    const label = measureLabel(node.label, round(size * DIVIDER_SCALE), style.typeface, style.wrap, NODE_TEXT_MAX * 2);
    const w = Math.ceil(Math.max(DIVIDER_MIN_W, label.w + 2 * (DIVIDER_GAP + 40)));
    return { node, style, label, shape: 'rectangle', iconOnly: false, card: false, divider: true, iconSize: 0, w, h: Math.max(DIVIDER_H, Math.ceil(label.h + 8)) };
  }
  const shape = (SHAPES as readonly string[]).includes(shapeAttr ?? '') ? (shapeAttr as ShapeKind) : 'rectangle';
  const card = d.type === 'cloud-architecture' && !!icon && !node.attrs.shape;
  if (card && d.styles.nodeStyle === 'icon') {
    const label = measureLabel(node.label, size, style.typeface, style.wrap, 120);
    const sub = measureSub(node, style, 120);
    const iconSize = Math.round(size * 3);
    const w = Math.ceil(Math.max(iconSize, label.w, sub?.w ?? 0) + 8);
    return { node, style, label, sub, shape, iconOnly: true, card: false, iconSize, w, h: Math.ceil(iconSize + 6 + textHeight(label, sub)) };
  }
  // Box-card icons stay 20px at every textSize (spec §2.1); other icons scale with the text.
  const iconSize = icon ? (card ? 20 : Math.round(size * 1.5)) : 0;
  const iconW = icon ? iconSize + 8 : 0;
  if (BUCKETED.has(shape)) return measureBucketed(node, style, shape, iconSize, card);
  const label = measureLabel(node.label, size, style.typeface, style.wrap, NODE_TEXT_MAX);
  const sub = measureSub(node, style, NODE_TEXT_MAX);
  const cw = Math.max(label.w, sub?.w ?? 0) + iconW;
  const ch = Math.max(textHeight(label, sub), iconSize);
  let w = Math.max(cw + 32, 96);
  let h = Math.max(ch + 22, 44);
  switch (shape) {
    case 'diamond':
      w = Math.max(cw * 1.6 + 40, 110);
      h = Math.max(ch * 2 + 30, 70);
      break;
    case 'circle':
      w = h = Math.max(cw + 30, ch + 30, 64);
      break;
    case 'ellipse':
      w = Math.max(cw * 1.35 + 30, 100);
      h = Math.max(ch * 1.6 + 20, 54);
      break;
    case 'oval':
      w += h / 2;
      break;
    case 'hexagon':
    case 'parallelogram':
    case 'trapezoid':
      w += 32;
      break;
    case 'triangle':
      w = Math.max(cw * 2 + 40, 110);
      h = Math.max(ch * 2.2 + 30, 80);
      break;
    case 'star':
      w = h = Math.max(cw * 2 + 30, ch * 3 + 30, 100);
      break;
    default:
      break;
  }
  return { node, style, label, sub, shape, iconOnly: false, card: false, iconSize, w: Math.ceil(w), h: Math.ceil(h) };
}

/** Label, width and height of a box node whose text wraps to fit `width`. */
function sizeBox(g: Pick<NodeGeom, 'node' | 'style' | 'shape' | 'iconSize' | 'card'>, width: number): Pick<NodeGeom, 'label' | 'sub' | 'w' | 'h'> {
  const size = fontSize(g.style);
  const iconW = g.iconSize ? g.iconSize + 8 : 0;
  const padX = g.card ? CARD_INSET + CARD_RIGHT : NODE_PAD_X;
  const room = width - padX - iconW;
  const label = measureLabel(g.node.label, size, g.style.typeface, g.style.wrap, room);
  const sub = measureSub(g.node, g.style, room);
  const w = Math.max(width, Math.ceil(Math.max(label.w, sub?.w ?? 0) + iconW + padX));
  const least = label.lines.length + (sub?.lines.length ?? 0) >= 2 ? NODE_TWO_LINE_H : NODE_MIN_H;
  let h = Math.max(least, Math.ceil(Math.max(textHeight(label, sub), g.iconSize) + NODE_PAD_Y));
  if (g.shape === 'cylinder') h += 18;
  else if (g.shape === 'document') h += 10;
  return { label, sub, w, h };
}

/**
 * Box nodes (spec §1.1): the smallest width bucket whose wrap stays within MAX_LINES lines; failing that,
 * the widest (a long word or unwrapped line widens it).
 */
function measureBucketed(node: GraphNode, style: ElementStyle, shape: ShapeKind, iconSize: number, card: boolean): NodeGeom {
  const base = { node, style, shape, iconSize, card };
  let pick: Pick<NodeGeom, 'label' | 'sub' | 'w' | 'h'> | undefined;
  for (const b of WIDTH_BUCKETS) {
    pick = sizeBox(base, b);
    if (pick.w === b && pick.label.lines.length <= MAX_LINES && (pick.sub?.lines.length ?? 0) <= MAX_LINES) break;
  }
  return { ...base, ...pick!, iconOnly: false };
}

/**
 * Box nodes of the same shape in the same group get one size: the widest bucket among them, labels
 * re-wrapped to that width, then the tallest height. The root is not one group: there only nodes in the
 * same layer (`rootLayer`) share a size. Root nodes in the root grid (`loose`) share one size; other root
 * nodes without edges keep their own.
 */
export function unifySizes(
  nodes: Iterable<NodeGeom>,
  parent: ReadonlyMap<string, string | undefined>,
  rootLayer: ReadonlyMap<string, number>,
  loose: ReadonlySet<string>,
): void {
  const sets = new Map<string, NodeGeom[]>();
  for (const g of nodes) {
    if (g.iconOnly || g.divider || !BUCKETED.has(g.shape)) continue;
    const p = parent.get(g.node.id);
    const layer = p === undefined ? rootLayer.get(g.node.id) : undefined;
    const at = p !== undefined ? `group:${p}` : loose.has(g.node.id) ? 'loose' : layer !== undefined ? `layer:${layer}` : undefined;
    if (at === undefined) continue; // root node with no edge outside the grid: keeps its own size
    const key = `${at}\u0000${g.shape}`;
    const list = sets.get(key) ?? [];
    list.push(g);
    sets.set(key, list);
  }
  for (const list of sets.values()) {
    const w = Math.max(...list.map((g) => g.w));
    for (const g of list) Object.assign(g, sizeBox(g, w));
    const h = Math.max(...list.map((g) => g.h));
    for (const g of list) g.h = h;
  }
}
export function measureGroup(d: GraphDiagram, group: GraphGroup): GroupGeom {
  const style = styleFor(d, group.attrs, group.span.line);
  const size = fontSize(style);
  const label = measureLabel(group.label, size, style.typeface, false, Infinity, true);
  const iconSize = group.attrs.icon ? Math.round(size * 1.4) : 0;
  const header = Math.max(GROUP_PAD.top, Math.max(label.h, iconSize) + 22) + runBand(d);
  return { group, style, label, iconSize, header, minW: Math.ceil(label.w + (iconSize ? iconSize + 8 : 0) + 40) };
}

/** Extra room above every node for the run marks (`runMarks on`, #987), else 0. */
export const runBand = (d: Pick<GraphDiagram, 'styles'>): number => (d.styles.runMarks === 'on' ? RUN_BAND : 0);
