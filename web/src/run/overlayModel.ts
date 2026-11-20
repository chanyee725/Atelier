// Progress board overlay model (design: docs/design/dispatch-integration/2-file-format-and-live-overlay.md §5.1).
// Pure: from a laid-out scene and the run's step views, what to draw (rings, badges, edges) in scene coordinates.
// No DOM, so it runs under `node --test`. Colours are CSS expressions on the app tokens (--step-* for the node's state,
// --role-* for the agents), so the same model draws in light and dark.

import type { Point, Scene } from '../../../shared/render/scene.ts';
import { edgePaths, nodeRects, type Rect } from '../../../shared/render/overlay.ts';
import { edgeView, linkSteps, progress, stepNode, type Progress, type StepView } from '../../../shared/dispatch/step-view.ts';
import type { SessionState } from '../../../shared/dispatch/types.ts';
import { NODE_TONES, nodeStatus, type NodeTone } from './nodeStatus.ts';
import { badgeRect } from '../../../shared/render/badge.ts';

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
  // With one over the limit, drawing it beats a "+1" badge of the same size.
  const n = all.length > max + 1 ? max : all.length;
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

/** Margin kept between the canvas legend and the overlay's edges. */
const EDGE = 8;

/**
 * Where the canvas legend goes, in overlay px (§5.1): under the picture (below the step labels), else left of it,
 * else right, else above; the first side where it fits whole inside the overlay. When none does it goes under the
 * picture. Either way it is clamped inside the overlay so the pane edge never cuts it.
 */
export function legendSpot(pic: Box, size: Size, area: Size, gap = 12, below = 0): { left: number; top: number } {
  const sides = [
    { left: pic.left, top: pic.top + pic.height + below + gap },
    { left: pic.left - gap - size.width, top: pic.top },
    { left: pic.left + pic.width + gap, top: pic.top },
    { left: pic.left, top: pic.top - gap - size.height },
  ];
  const fits = (p: { left: number; top: number }) => p.left >= EDGE && p.top >= EDGE && p.left + size.width <= area.width - EDGE && p.top + size.height <= area.height - EDGE;
  const p = sides.find(fits) ?? sides[0]!;
  const clamp = (v: number, max: number) => Math.max(EDGE, Math.min(v, max - EDGE));
  return { left: clamp(p.left, area.width - size.width), top: clamp(p.top, area.height - size.height) };
}

/** SVG path data through the edge's points (straight segments; the overlay traces, it does not redraw the connector). */
export function pathData(points: readonly Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join('');
}

/** Gap between a node and its marks, and the label text size (scene units). */
export const MARK_PAD = 5;
export const MARK_FONT = 11;

/** Rough text width for the label plate: Hangul and other wide characters about one em, the rest about 0.6 em. */
export function textWidth(s: string, size = MARK_FONT): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.6;
  return Math.ceil(w);
}

export interface StepMarks {
  /** Glyph chip on the top-right corner, the same chip as a diagram node's `badge:` (shared/render/badge.ts). */
  chip: Rect;
  /** "state · agent" chip under the node; none when labels are hidden (too small to read). */
  label?: Rect & { text: string };
  /** Running step: a thin line along the node's bottom edge, inside the box. */
  progress?: { x1: number; x2: number; y: number };
}

/**
 * What the run layer draws for a step (#935): only chips and a progress line, never a fill or a ring over the node,
 * so the node keeps the diagram's own look (eraser-diagrams rules) and the state never reshapes it.
 */
export function stepMarks(n: Pick<OverlayNode, 'rect' | 'glyph' | 'text' | 'live'>, labels: boolean): StepMarks {
  const { x, y, w, h } = n.rect;
  const chip = badgeRect(x + w + MARK_PAD, y - MARK_PAD, textWidth(n.glyph));
  const text = `${n.glyph} ${n.text}`;
  const tw = textWidth(text) + 12;
  const label = labels ? { x: x + w / 2 - tw / 2, y: y + h + MARK_PAD + 4, w: tw, h: 18, text } : undefined;
  const inset = Math.min(6, w / 4);
  const progress = n.live ? { x1: x + inset, x2: x + w - inset, y: y + h - 2 } : undefined;
  return { chip, ...(label ? { label } : {}), ...(progress ? { progress } : {}) };
}
