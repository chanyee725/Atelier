// The progress board layer (design §5.1): one transparent SVG over a block picture, in the picture's own (scene)
// coordinates, so it scales with the picture. Draws a glyph corner chip, a "state · agent" label chip and, on a
// running step, a progress line per step, and traces active edges; never a fill or a ring over the node (#935). Never touches the picture, the canvas elements or the file.
// The same component draws on the canvas (RunOverlay) and in the document's diagram embed (DiagramView).
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { progressLabel } from '../../../shared/dispatch/step-view.ts';
import type { Scene } from '../../../shared/render/index.ts';
import { boardShown, etaPanel, legendOf, BADGE_R, BADGE_STEP, badgeSpan, legendOpen, legendScale, legendSpot, MARK_INSET, nodeBoxes, markY, overlayModel, pathData, runProgress, stepMarks, type OverlayNode, type RunStep, type Size } from './overlayModel';
import { setStill, useStill } from './runStore';
import { fmtDur } from './runModel';
import type { AgentEta, EtaPanel } from './overlayModel';
import { NodeLiveCard } from './NodeLiveCard';

type Props = {
  scene: Scene;
  steps: readonly RunStep[];
  /** Where the picture's top-left sits in the positioned parent, in CSS px. */
  left: number;
  top: number;
  /** CSS px per scene unit (picture scale × zoom). */
  scale: number;
  /** No room above the picture (it touches the top of a clipped view): the motion switch sits inside its corner. */
  motionInside?: boolean;
  /** The document draws the time-left panel itself, in flow under the picture (`RunEta`). */
  hideEta?: boolean;
};

/** Below this scale the labels are too small to read and hidden (§5 "hidden below 40 % zoom"). */
const MIN_LABEL_SCALE = 0.4;

export function RunLayer({ scene, steps, left, top, scale, motionInside, hideEta }: Props) {
  const model = useMemo(() => overlayModel(scene, steps), [scene, steps]);
  const still = useStill();
  if (!model.nodes.length) return null;
  const moving = model.nodes.some((n) => n.live) || model.edges.some((e) => e.kind === 'flow');
  const labels = scale >= MIN_LABEL_SCALE;
  return (
    <div className="run-layer" data-run-layer="" data-still={still ? '' : undefined} data-motion-inside={motionInside ? '' : undefined} style={{ left, top, width: scene.width * scale, height: scene.height * scale }}>
      <svg role="group" aria-label="실행 상태" viewBox={`0 0 ${scene.width} ${scene.height}`} width="100%" height="100%" overflow="visible">
        {model.edges.map((e) => (
          <path key={e.key} className="run-edge" data-edge-kind={e.kind} d={pathData(e.points)} stroke={e.color} />
        ))}
        {model.nodes.map((n) => (
          <Step key={n.node} n={n} labels={labels} />
        ))}
      </svg>
      {model.nodes.map((n) => n.open.length > 0 && <NodeLiveCard key={n.node} open={n.open} title={n.title} time={n.time} box={badgeBox(n, scale)} />)}
      {!hideEta && <EtaCorner panel={model.etas} />}
      {moving && (
        <button type="button" className="run-motion" onClick={() => setStill(!still)}>
          {still ? '움직임 켜기' : '움직임 멈추기'}
        </button>
      )}
    </div>
  );
}

/** Text of one agent's time left. Never a made-up number: "추정 중" until enough steps have finished. */
export function etaText(e: AgentEta): string {
  if (e.kind === 'left') return `남은 시간 ~${fmtDur(e.ms)}`;
  if (e.kind === 'over') return '평소보다 길어요';
  return '추정 중';
}

/** The panel for the document, in flow under the picture's bottom-right so it never covers a node (#735). */
export function RunEta({ steps }: { steps: readonly RunStep[] }) {
  const panel = useMemo(() => etaPanel(steps), [steps]);
  return <EtaCorner panel={panel} />;
}

/**
 * Per-agent time left (#735). One row per working agent, the rest fold into "+N". In the document it is a card under
 * the picture (`RunEta`); on the canvas it is the middle part of the legend card under the picture (#987).
 */
function EtaCorner({ panel }: { panel: EtaPanel }) {
  if (!panel.rows.length) return null;
  return (
    <section className="run-eta" data-run-eta="" aria-label="에이전트별 남은 시간">
      <ul>
        {panel.rows.map((r) => (
          <li key={r.name}>
            <span className="run-eta-badge" aria-hidden="true" style={{ background: r.color }}>
              {r.initial}
            </span>
            <span className="run-eta-name">{r.name}</span>
            <span className="run-eta-step">{r.step}</span>
            <span className="run-eta-time">{etaText(r.eta)}</span>
          </li>
        ))}
      </ul>
      {panel.more > 0 && <p className="run-eta-more">+{panel.more}명 더 일해요</p>}
    </section>
  );
}

function Step({ n, labels }: { n: OverlayNode; labels: boolean }) {
  const { chip, label, progress } = stepMarks(n, labels, badgeSpan(n.badges.shown.length + (n.badges.more > 0 ? 1 : 0)));
  return (
    <g role="img" aria-label={n.label} data-step={n.step} data-view={n.view} data-tone={n.tone} style={{ color: n.color }}>
      {progress && (
        <g className="run-progress-line" aria-hidden="true">
          <line className="run-progress-track" x1={progress.x1} y1={progress.y} x2={progress.x2} y2={progress.y} />
          <line className="run-progress-bar" x1={progress.x1} y1={progress.y} x2={progress.x2} y2={progress.y} pathLength={100} />
        </g>
      )}
      <Badges n={n} />
      {label ? (
        <g className="run-label" aria-hidden="true">
          <rect x={label.x} y={label.y} width={label.w} height={label.h} rx={label.h / 2} />
          <text x={label.x + label.w / 2} y={label.y + label.h / 2} textAnchor="middle" dominantBaseline="central">
            {label.text}
          </text>
        </g>
      ) : (
        <g className="run-corner" aria-hidden="true">
          <rect x={chip.x} y={chip.y} width={chip.w} height={chip.h} rx={chip.h / 2} />
          <text x={chip.x + chip.w / 2} y={chip.y + chip.h / 2} textAnchor="middle" dominantBaseline="central">
            {n.glyph}
          </text>
        </g>
      )}
    </g>
  );
}

/**
 * Agents on the step as round initial badges in the band above the node, at the left, overlapping, in their role colour (#687).
 * Hover shows the full name, role, model and state (native SVG tooltip); the step's accessible name already lists them.
 * The first agent is drawn last so it sits on top.
 */
function Badges({ n }: { n: OverlayNode }) {
  const { shown, more } = n.badges;
  if (!shown.length) return null;
  const cy = markY(n.rect);
  const cx = (i: number) => n.rect.x + MARK_INSET + BADGE_R + i * BADGE_STEP;
  return (
    <g className="run-badges" aria-hidden="true">
      {more > 0 && (
        <g className="run-badge run-badge-more">
          <title>{`${more}명 더`}</title>
          <circle cx={cx(shown.length)} cy={cy} r={BADGE_R} />
          <text x={cx(shown.length)} y={cy} textAnchor="middle" dominantBaseline="central">
            +{more}
          </text>
        </g>
      )}
      {shown
        .map((b, i) => (
          <g key={b.name} className="run-badge" data-agent={b.name} style={{ color: b.color }}>
            <title>{b.title}</title>
            <circle cx={cx(i)} cy={cy} r={BADGE_R} />
            <text x={cx(i)} y={cy} textAnchor="middle" dominantBaseline="central">
              {b.initial}
            </text>
          </g>
        ))
        .reverse()}
    </g>
  );
}

/** Smallest hit target of a node's live button, CSS px (WCAG 2.5.8). */
const MIN_HIT = 24;

/** Where a node's live button sits (#736): over its badge row, in CSS px of the layer, at least MIN_HIT square. */
export function badgeBox(n: Pick<OverlayNode, 'rect' | 'badges'>, scale: number): { left: number; top: number; width: number; height: number } {
  const count = Math.max(1, n.badges.shown.length + (n.badges.more > 0 ? 1 : 0));
  const x = n.rect.x + MARK_INSET;
  const y = markY(n.rect) - BADGE_R;
  const w = BADGE_R * 2 + (count - 1) * BADGE_STEP;
  const h = BADGE_R * 2;
  const width = Math.max(MIN_HIT, w * scale);
  const height = Math.max(MIN_HIT, h * scale);
  return { left: (x + w / 2) * scale - width / 2, top: (y + h / 2) * scale - height / 2, width, height };
}

/**
 * The canvas legend: one card under the picture, or at the pane's bottom when that is below the fold (`legendSpot`,
 * #987, #1005), never over a node, with the progress, the
 * per-agent time left (the document shows the same rows in its card under the picture) and the legend. Measured
 * after it renders so the clamp knows its size, and scaled with the picture between 80% and 100% (`legendScale`).
 * Shown only when the board is (`boardShown`), like the document's.
 */
export function CanvasLegend({ scene, steps, left, top, scale, area }: Omit<Props, 'motionInside'> & { area: Size }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const shown = useMemo(() => boardShown(scene, steps), [scene, steps]);
  const etas = useMemo(() => etaPanel(steps), [steps]);
  const boxes = useMemo(() => nodeBoxes(scene, left, top, scale), [scene, left, top, scale]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((old) => (old && old.width === el.offsetWidth && old.height === el.offsetHeight ? old : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);
  if (!shown) return null;
  const pic = { left, top, width: scene.width * scale, height: scene.height * scale };
  // Scaled with the picture (#987); the transform leaves the measured size alone, so place it by the scaled size.
  const k = legendScale(scale);
  const at = size && area.width > 0 ? legendSpot(pic, { width: size.width * k, height: size.height * k }, area, 12, 0, boxes) : null;
  // The individual `scale` property, set even at 1 so the stacking context never flips as the zoom changes.
  const zoom: CSSProperties = { scale: String(k), transformOrigin: '0 0' };
  return <RunLegend ref={ref} steps={steps} etas={etas} canvas style={at ? { left: at.left, top: at.top, ...zoom } : { visibility: 'hidden' }} />;
}

/**
 * The board's legend (§5.1): the weighted progress bar and text, then a collapsible list of the agents and states in
 * the run. Under the picture on the canvas (`CanvasLegend`), so it never covers a node.
 */
export function RunLegend({ steps, etas, canvas, style, ref }: { steps: readonly RunStep[]; etas?: EtaPanel; canvas?: boolean; style?: CSSProperties; ref?: Ref<HTMLDivElement> }) {
  const id = useId();
  const p = useMemo(() => runProgress(steps), [steps]);
  const legend = useMemo(() => legendOf(steps), [steps]);
  return (
    <div ref={ref} className="run-legend" data-run-legend="" data-on-canvas={canvas ? '' : undefined} style={style}>
      <p id={id} className="run-legend-progress">
        {progressLabel(p)}
      </p>
      {p.total > 0 && <progress className="run-progress" value={p.percent} max={100} aria-labelledby={id} />}
      {etas && <EtaCorner panel={etas} />}
      {/* On the canvas a long list starts folded (#987), so the card under the picture stays short. */}
      <details open={legendOpen(legend.agents.length, canvas)}>
        <summary>범례</summary>
        <ul aria-label="에이전트">
          {legend.agents.map((a) => (
            <li key={a.name}>
              <span className="run-swatch" aria-hidden="true" style={{ background: a.color }} />
              <span>{a.name}</span>
              <span className="run-legend-dim">
                {a.roleName}
                {a.model ? ` · ${a.model}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <ul aria-label="상태">
          {legend.states.map((s) => (
            <li key={s.key}>
              <span className="run-legend-glyph" aria-hidden="true" style={{ color: s.color }}>
                {s.glyph}
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
