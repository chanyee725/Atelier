// Progress board overlay model (design: docs/design/dispatch-integration/2-file-format-and-live-overlay.md §5.1).
// Pure: from a laid-out scene and the run's step views, what to draw (rings, badges, edges) in scene coordinates.
// No DOM, so it runs under `node --test`. Colours are CSS expressions on the app tokens (--step-* for the node's state,
// --role-* for the agents), so the same model draws in light and dark.

import type { Point, Scene } from '../../../shared/render/scene.ts';
import { edgePaths, nodeRects, type Rect } from '../../../shared/render/overlay.ts';
import { edgeView, linkSteps, progress, stepNode, type Progress, type StepView } from '../../../shared/dispatch/step-view.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';
import { NODE_TONES, nodeStatus, type NodeTone } from './nodeStatus.ts';
import { BADGE_H, RUN_BAND, badgeRect } from '../../../shared/render/badge.ts';

/** Dispatch role ids (server/dispatch/roles.js). Unknown roles draw in the neutral `--idle` colour. */
export const ROLES = { lead: '관리자', impl: '구현자', review: '리뷰어', test: '테스터', design: '디자이너', docs: '문서화' } as const;
export type RoleId = keyof typeof ROLES;

/** One agent session working on a step. `name` is Dispatch's random short name, never a person. */
export interface RunAgent {
  /** Dispatch session id (opaque hub id), to open its live view from the node (#736). */
  sid?: string;
  name: string;
  role: string;
  /** Model label for the legend (metadata only). */
  model?: string;
  /** Its Dispatch state now, for the badge's hover text (#687). */
  state?: SessionState;
  /** Estimated time left while its step runs (#735); absent once the step is not running. */
  eta?: AgentEta;
  /** Title of the step it works on. */
  step?: string;
}

/** `left`: about `ms` more; `over`: running longer than similar steps did; `unknown`: not enough finished steps yet ("추정 중"). */
export type AgentEta = { kind: 'left'; ms: number } | { kind: 'over' } | { kind: 'unknown' };

/** What the overlay needs per step: the step ↔ node link and its computed `step.view` (E24). */
export interface RunStep {
  id: string;
  /** DSL node id; defaults to `id`. */
  node?: string;
  view: StepView;
  /** A session waits on a person ("사람 기다림"). */
  waiting?: boolean;
  /** A session on the step failed: painted red, not purple (#687). */
  failed?: boolean;
  /** Short title for the label (defaults to the node id). */
  title?: string;
  /** Sessions on the step; the first one owns the step's colour. */
  agents?: readonly RunAgent[];
  /** Blocked step: the view it had before blocking, so its progress weight holds (§5.1 "Progress"). */
  before?: StepView;
  /** Closed as abandoned (건너뜀/그만둠): left out of the progress. */
  skipped?: boolean;
  /** Elapsed time text of the step ("8분째"), for the node's hover card (#736). */
  time?: string;
}

export interface OverlayNode {
  step: string;
  node: string;
  rect: Rect;
  view: StepView;
  /** Painted state (#687): gray pending, blue active, green done, red failed, purple blocked or needs a decision. */
  tone: NodeTone;
  glyph: string;
  /** Visible label text: `진행 · Juno`. */
  text: string;
  /** Full accessible name: `Implement · 진행 · Juno(구현자) · 사람 기다림`. */
  label: string;
  color: string;
  /** A session runs on it (active/review): a progress line sweeps under the node. */
  live: boolean;
  waiting: boolean;
  /** Round initial badges above the node, one per agent, overlapping (#687). */
  badges: NodeBadges;
  /** In progress only: the agents whose live view the node opens (hover card, click, Enter; #736). */
  open: LiveTarget[];
  /** Step title (the node id when the plan names none). */
  title: string;
  /** Step elapsed time text, when known. */
  time?: string;
}

/** An agent a node can open the live view of (#736). */
export interface LiveTarget {
  sid: string;
  name: string;
}

/** What a press on the node does: one agent opens its live view at once; several show the list to pick from. */
export function pressAction(open: readonly LiveTarget[]): { kind: 'open'; sid: string } | { kind: 'pick' } | null {
  if (!open.length) return null;
  return open.length === 1 ? { kind: 'open', sid: open[0]!.sid } : { kind: 'pick' };
}

/** The agents of an in-progress step that have a session id, in step order; empty for any other step. */
export function liveTargets(s: Pick<RunStep, 'view' | 'agents'>): LiveTarget[] {
  if (s.view !== 'active' && s.view !== 'review') return [];
  return (s.agents ?? []).flatMap((a) => (a.sid ? [{ sid: a.sid, name: a.name }] : []));
}

export interface NodeBadge {
  name: string;
  initial: string;
  /** The agent's role colour (--role-*, a lightness step per agent of the same role). */
  color: string;
  /** Hover text: `Juno · 구현자 · Opus 5.5 · 일하는 중`. */
  title: string;
}

/** `shown` badges drawn, `more` folded into a "+N" badge. */
export interface NodeBadges {
  shown: NodeBadge[];
  more: number;
}

/** Badges drawn on one node before the rest fold into "+N". */
export const BADGE_MAX = 3;

const AGENT_STATE: Record<SessionState, string> = { working: '일하는 중', waiting: '답 기다림', stuck: '멈춤', failed: '실패', resting: '쉬는 중', done: '끝남' };

export function nodeBadges(agents: readonly RunAgent[], colors: ReadonlyMap<string, string>, max = BADGE_MAX): NodeBadges {
  const all = agents.map((a) => ({
    name: a.name,
    initial: ([...a.name][0] ?? '?').toUpperCase(),
    color: colors.get(a.name) ?? roleColor(a.role),
    title: [a.name, roleLabel(a.role), ...(a.model ? [a.model] : []), ...(a.state ? [AGENT_STATE[a.state] ?? a.state] : [])].join(' · '),
  }));
  // Past the limit the rest fold into one "+N" badge (#987), so the row never grows past max + 1 badges.
  const n = Math.min(all.length, max);
  return { shown: all.slice(0, n), more: all.length - n };
}

export interface OverlayEdge {
  key: string;
  points: Point[];
  kind: 'flow' | 'done';
  color: string;
}

export interface OverlayModel {
  nodes: OverlayNode[];
  edges: OverlayEdge[];
  /** Steps whose node is not in the diagram ("다이어그램에 없는 단계"). */
  missing: string[];
  /** Weighted progress over every step of the run, drawn or not. */
  progress: Progress;
  legend: Legend;
  /** Per-agent time-left rows for the corner panel (#735); empty when no agent is working. */
  etas: EtaPanel;
}

export interface EtaRow {
  name: string;
  role: string;
  roleName: string;
  color: string;
  /** First letter of the name, the badge's initial. */
  initial: string;
  step: string;
  eta: AgentEta;
}

/** `rows` are the agents shown; `more` how many are folded into "+N" (#727 style). */
export interface EtaPanel {
  rows: EtaRow[];
  more: number;
}

/** Rows shown before the rest fold into "+N". */
export const ETA_MAX = 5;

/** The goal (목표) stage is never listed: it is where the aim is written, not a working step. */
const GOAL = new Set(['목표', 'goal']);

export function etaPanel(steps: readonly RunStep[], colors: ReadonlyMap<string, string> = agentColors(steps), max = ETA_MAX): EtaPanel {
  const all: EtaRow[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.skipped || (s.view !== 'active' && s.view !== 'review')) continue;
    const title = s.title ?? stepNode(s);
    if (GOAL.has(title) || GOAL.has(stepNode(s))) continue;
    for (const a of s.agents ?? []) {
      if (!a.eta || seen.has(a.name)) continue;
      seen.add(a.name);
      all.push({ name: a.name, role: a.role, roleName: roleLabel(a.role), color: colors.get(a.name) ?? roleColor(a.role), initial: [...a.name][0] ?? '?', step: a.step ?? title, eta: a.eta });
    }
  }
  return { rows: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export interface LegendAgent {
  name: string;
  roleName: string;
  model: string;
  color: string;
}

/** Only the agents and states present in the run (§5.1 "Colour rules"). */
export interface Legend {
  agents: LegendAgent[];
  states: { key: string; tone: NodeTone; glyph: string; label: string; color: string }[];
}

/** Legend order of the painted states. */
const TONE_ORDER = Object.keys(NODE_TONES) as NodeTone[];

/** Up to 3 lightness steps per role; later sessions of the same role reuse the last step (their name tells them apart). */
const SHADES = 3;

export const roleLabel = (role: string): string => (Object.hasOwn(ROLES, role) ? ROLES[role as RoleId] : role);

/** Colour of one role at a lightness step: step 0 is the token, later steps move toward the text colour (more contrast in both themes). */
export function roleColor(role: string, shade = 0): string {
  const base = Object.hasOwn(ROLES, role) ? `var(--role-${role})` : 'var(--idle)';
  const s = Math.min(Math.max(shade, 0), SHADES - 1);
  return s === 0 ? base : `color-mix(in oklch, ${base}, var(--foreground) ${s * 25}%)`;
}

/**
 * Agent name → colour for the whole run: same role, same hue; the n-th distinct agent of a role gets lightness step n
 * (in step order, then session order), so a colour stays with its agent across steps.
 */
export function agentColors(steps: readonly RunStep[]): Map<string, string> {
  const out = new Map<string, string>();
  const perRole = new Map<string, number>();
  for (const s of steps)
    for (const a of s.agents ?? []) {
      if (out.has(a.name)) continue;
      const n = perRole.get(a.role) ?? 0;
      perRole.set(a.role, n + 1);
      out.set(a.name, roleColor(a.role, n));
    }
  return out;
}

export function legendOf(steps: readonly RunStep[], colors: ReadonlyMap<string, string> = agentColors(steps)): Legend {
  const agents: LegendAgent[] = [];
  const seen = new Set<string>();
  for (const s of steps)
    for (const a of s.agents ?? []) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      agents.push({ name: a.name, roleName: roleLabel(a.role), model: a.model ?? '', color: colors.get(a.name)! });
    }
  const present = new Map<string, Legend['states'][number]>();
  for (const s of steps) {
    if (s.skipped) continue;
    const st = nodeStatus(s);
    if (!present.has(st.label)) present.set(st.label, { key: st.label, ...st });
  }
  const states = [...present.values()].sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
  return { agents, states };
}

export const runProgress = (steps: readonly RunStep[]): Progress => progress(steps.map((s) => ({ view: s.view, before: s.before, abandoned: s.skipped })));

export function overlayModel(scene: Scene, steps: readonly RunStep[]): OverlayModel {
  const rects = nodeRects(scene);
  const { linked, missing } = linkSteps(steps, rects.keys());
  const colors = agentColors(steps);
  const byNode = new Map<string, OverlayNode>();
  const nodes: OverlayNode[] = [];
  for (const s of steps) {
    const node = linked.get(s.id);
    // Two steps on one node: the first wins (the plan validator rejects that; the overlay must not draw twice).
    if (node === undefined || byNode.has(node)) continue;
    const live = s.view === 'active' || s.view === 'review';
    const st = nodeStatus(s);
    const who = (s.agents ?? []).map((a) => a.name);
    const waiting = !!s.waiting && live;
    const text = [st.label, ...(who.length > 2 ? [`${who[0]} 외 ${who.length - 1}`] : who)].join(' · ');
    const label = [s.title ?? stepNode(s), st.label, ...(s.agents ?? []).map((a) => `${a.name}(${roleLabel(a.role)})`), ...(waiting ? ['사람 기다림'] : [])].join(' · ');
    const n: OverlayNode = { step: s.id, node, rect: rects.get(node)!, view: s.view, tone: st.tone, glyph: st.glyph, text, label, color: st.color, live, waiting, badges: nodeBadges(s.agents ?? [], colors), open: liveTargets(s), title: s.title ?? stepNode(s), ...(s.time ? { time: s.time } : {}) };
    byNode.set(node, n);
    nodes.push(n);
  }
  const edges: OverlayEdge[] = [];
  for (const [key, list] of edgePaths(scene, new Set(byNode.keys()))) {
    const a = byNode.get(list[0]!.from)!;
    const b = byNode.get(list[0]!.to)!;
    const kind = edgeView(a.view, b.view);
    if (kind === 'none') continue;
    list.forEach((p, i) => edges.push({ key: i ? `${key}#${i}` : key, points: p.points, kind, color: kind === 'done' ? NODE_TONES.done.color : b.color }));
  }
  return { nodes, edges, missing, progress: runProgress(steps), legend: legendOf(steps, colors), etas: etaPanel(steps, colors) };
}

/** The board draws only when at least one step links to a node of the picture; the legend follows the same rule. */
export const boardShown = (scene: Scene, steps: readonly RunStep[]): boolean => overlayModel(scene, steps).nodes.length > 0;

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

/**
 * Smallest and largest scale of the canvas legend (#987). Not as small as the picture's 60% floor: the card sits under
 * the picture or in a clear spot at the pane bottom, never over a node, so it can stay big enough to read.
 */
export const LEGEND_SCALE = { min: 0.8, max: 1 } as const;

/**
 * Scale of the canvas legend for a picture drawn at `scale` CSS px per scene unit: the same as the picture, so the
 * card never looks bigger than the diagram, but within LEGEND_SCALE (never blown up, never too small to read).
 */
export const legendScale = (scale: number): number => (Number.isFinite(scale) ? Math.min(LEGEND_SCALE.max, Math.max(LEGEND_SCALE.min, scale)) : 1);

/** Most agents the canvas legend lists open; more and the list starts folded (#987). */
export const LEGEND_OPEN_MAX = 6;
export const legendOpen = (agents: number, canvas?: boolean): boolean => !canvas || agents <= LEGEND_OPEN_MAX;

/** Margin kept between the canvas legend and the overlay's edges. */
const EDGE = 8;

/** Every node of the picture in overlay px, with the run-mark band above it (#987), for `legendSpot` to keep clear. */
export function nodeBoxes(scene: Scene, left: number, top: number, scale: number): Box[] {
  return [...nodeRects(scene).values()].map((r) => ({ left: left + r.x * scale, top: top + (r.y - RUN_BAND) * scale, width: r.w * scale, height: (r.h + RUN_BAND) * scale }));
}

/** Whether two boxes overlap (touching edges do not). */
const overlaps = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Where the canvas legend goes, in overlay px (§5.1, #987, #1005): under the picture (below the step labels), lined
 * up with its left edge, the same place the document puts its run card, when it fits there on screen. When the
 * picture reaches the pane's bottom (a tall plan at the 60% floor) the card is pinned to the pane's bottom instead,
 * so the progress and time left show without scrolling, at the spot nearest that left edge where it covers no node
 * (`nodes`, overlay px, the mark band above each included). Only when no such spot exists does it stay under the
 * picture, below the fold. It is moved sideways to stay inside the overlay, and a picture scrolled out of view takes
 * the card with it, so it never sits over another block.
 */
export function legendSpot(pic: Box, size: Size, area: Size, gap = 12, below = 0, nodes: readonly Box[] = []): { left: number; top: number } {
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, area.width - size.width - EDGE));
  const left = clampX(pic.left);
  const under = { left, top: pic.top + pic.height + below + gap };
  const bottom = area.height - size.height - EDGE;
  // Fits under the picture on screen, or the picture is off screen (the card goes with it).
  if (under.top <= bottom || pic.top + pic.height <= 0 || pic.top >= area.height) return under;
  // Pinned to the pane's bottom, never above the picture's top (that is another block's room).
  if (bottom < Math.max(EDGE, pic.top)) return under;
  const xs = [left, EDGE, area.width - size.width - EDGE, ...nodes.flatMap((n) => [n.left + n.width + gap, n.left - gap - size.width])].map(clampX);
  const clear = xs
    .sort((a, b) => Math.abs(a - left) - Math.abs(b - left))
    .find((x) => !nodes.some((n) => overlaps({ left: x, top: bottom, width: size.width, height: size.height }, n)));
  return clear === undefined ? under : { left: clear, top: bottom };
}

/** SVG path data through the edge's points (straight segments; the overlay traces, it does not redraw the connector). */
export function pathData(points: readonly Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join('');
}

/**
 * How far in from a node's left and right corners its marks sit (scene units). Every mark stays inside the node's
 * width (#971), so nothing reaches sideways into the gap where the next node, an edge or a neighbour's marks are.
 */
export const MARK_INSET = 10;
/**
 * Centre line of the marks: the middle of the band above the node's top edge (#987), outside the box, so the badges
 * and chips never cover the node's title. The layout keeps that band free (`runMarks on`, shared/render/badge.ts).
 */
export const markY = (rect: Pick<Rect, 'y'>): number => rect.y - RUN_BAND / 2;
/** Agent badge radius and the step between overlapping badges (scene units). */
export const BADGE_R = 9;
export const BADGE_STEP = 13;
export const MARK_FONT = 11;

/** Rough text width for the label plate: Hangul and other wide characters about one em, the rest about 0.6 em. */
export function textWidth(s: string, size = MARK_FONT): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.6;
  return Math.ceil(w);
}

export interface StepMarks {
  /** Glyph chip, the same chip as a diagram node's `badge:` (shared/render/badge.ts), on the top edge at the right. */
  chip: Rect;
  /** "state · agent" chip in the chip's place; none when labels are hidden (too small to read) or it does not fit. */
  label?: Rect & { text: string };
  /** Running step: a thin line along the node's bottom edge, inside the box. */
  progress?: { x1: number; x2: number; y: number };
}

/** Width the agent badges take from the node's left inset (scene units). */
export function badgeSpan(count: number): number {
  return count > 0 ? BADGE_R * 2 + (count - 1) * BADGE_STEP : 0;
}

/**
 * What the run layer draws for a step (#935): only chips and a progress line, never a fill or a ring over the node,
 * so the node keeps the diagram's own look (eraser-diagrams rules) and the state never reshapes it.
 * The chips sit in the band above the node's top edge (#987), inside its width (#971): the agent badges at the left (`lead` is their span),
 * the state at the right. The label says "glyph state · agents" when that fits beside the badges, else the state
 * word alone, else only the glyph chip shows.
 */
export function stepMarks(n: Pick<OverlayNode, 'rect' | 'glyph' | 'text' | 'live'>, labels: boolean, lead = 0): StepMarks {
  const { x, y, w, h } = n.rect;
  const right = x + w - MARK_INSET;
  const my = markY(n.rect);
  const chip = badgeRect(right - BADGE_H / 2, my, textWidth(n.glyph));
  const room = right - (x + MARK_INSET + lead + (lead ? 4 : 0));
  const fit = labels ? [`${n.glyph} ${n.text}`, `${n.glyph} ${n.text.split(' · ')[0]}`].find((t) => textWidth(t) + 12 <= room) : undefined;
  const label = fit ? { x: right - (textWidth(fit) + 12), y: my - BADGE_H / 2, w: textWidth(fit) + 12, h: BADGE_H, text: fit } : undefined;
  const inset = Math.min(6, w / 4);
  const progress = n.live ? { x1: x + inset, x2: x + w - inset, y: y + h - 2 } : undefined;
  return { chip, ...(label ? { label } : {}), ...(progress ? { progress } : {}) };
}
