// 플랜 view (#729): the open pipeline file's plan as a diagram — steps as nodes, arrows for the order they run in —
// with each step's live state (#687 colours, glyphs and agent initial badges), and the plan strip on top, so the plan
// is reviewed and approved (시작하기, or again for a revision) right here. It follows the file (write_plan saves) and
// the run (`run` events, live sessions).
// #889 refresh (Plan.dc.html): the plan sheet (title, opening paragraph, steps with role and model) and the diagram
// sit side by side as cards, and the approval bar with 시작하기 is pinned under them.
import { useEffect, useId, useMemo, type CSSProperties } from 'react';
import { connect } from '../dispatch/store.ts';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';
import { cn } from '../lib/utils';
import { nodeLabels, overlaySteps } from './runModel.ts';
import { NODE_H, NODE_W, planGraph, type PlanGraphNode } from './planGraphModel.ts';
import { useRunModel } from './useRunModel.ts';
import { useAskingSteps } from './useAskingSteps';
import { PlanStrip } from './PlanStrip';
import { planSheet, type PlanSheet } from './planSheetModel.ts';
import './plan-view.css';

function Node({ n }: { n: PlanGraphNode }) {
  const { shown, more } = n.badges;
  return (
    <li
      className="plan-node"
      data-step={n.id}
      data-tone={n.status.tone}
      aria-label={n.label}
      style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H, '--tone': n.status.color } as CSSProperties}
    >
      <div className={cn('plan-node-box', n.live && 'is-live')} aria-hidden="true">
        <span className="plan-node-title">
          <span className="plan-node-n">{n.n}</span>
          {n.title}
        </span>
        <span className="plan-node-state">
          <span className="plan-node-glyph">{n.status.glyph}</span>
          {n.status.label}
        </span>
      </div>
      {shown.length > 0 && (
        <span className="plan-badges" aria-hidden="true">
          {shown.map((b) => (
            <span key={b.name} className="plan-badge" title={b.title} style={{ background: b.color }}>
              {b.initial}
            </span>
          ))}
          {more > 0 && <span className="plan-badge plan-badge-more">+{more}</span>}
        </span>
      )}
    </li>
  );
}

function Sheet({ title, sheet }: { title: string; sheet: PlanSheet }) {
  const head = useId();
  return (
    <article className="plan-card plan-sheet" aria-labelledby={head}>
      <h2 id={head}>{title}</h2>
      {sheet.summary && <p className="text-muted-foreground">{sheet.summary}</p>}
      <h3>단계</h3>
      <ol className="plan-steps">
        {sheet.steps.map((s) => (
          <li key={s.id} className="plan-step" data-sheet-step={s.id}>
            <span className="plan-step-n">{s.n}</span>
            <span className="min-w-0">
              <span className="plan-step-title block">{s.title}</span>
              {s.task && <span className="plan-step-task block" title={s.task}>{s.task}</span>}
            </span>
            <span className="plan-step-meta">
              {s.role && <span className="plan-role">{s.role}</span>}
              {s.who && <span className="plan-step-who" title={s.who}>{s.who}</span>}
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export default function PlanView({ session }: { session: FileSession }) {
  const plan = useSession(session, (s) => s.file?.plan ?? null);
  const blocks = useSession(session, (s) => s.file?.blocks);
  const title = useSession(session, (s) => s.file?.title ?? '');
  const document = useSession(session, (s) => s.file?.document);
  const code = blocks?.find((b) => b.id === plan?.block)?.code;
  const asking = useAskingSteps(session);
  const m = useRunModel(code, asking);
  // Live session states come from the Dispatch store; load it while this view is open, like the 실행 view.
  useEffect(() => connect(), []);
  const labels = useMemo(() => nodeLabels(code), [code]);
  const steps = useMemo(() => overlaySteps(m.rows), [m.rows]);
  const graph = useMemo(() => (plan ? planGraph(plan, blocks ?? [], steps, labels) : null), [plan, blocks, steps, labels]);
  const sheet = useMemo(() => (plan ? planSheet(plan, document, steps, labels) : null), [plan, document, steps, labels]);

  const strip = <PlanStrip session={session} inTab />;
  if (!graph || !sheet || graph.nodes.length === 0) {
    return (
      <div data-plan-view>
        <div className="plan-body">
          <p className="m-0 text-sm text-muted-foreground">아직 계획에 단계가 없어요. 관리자가 계획을 쓰면 여기에 그려져요.</p>
        </div>
        {strip}
      </div>
    );
  }
  return (
    <div data-plan-view>
      <div className="plan-body">
        <Sheet title={title || '계획'} sheet={sheet} />
        {/* Focusable so a keyboard can scroll a wide plan; its name says what the picture is. */}
        <section className="plan-card plan-canvas" aria-label="단계 다이어그램" tabIndex={0}>
          {graph.problem && (
            <p role="status" className="plan-problem">
              순서를 읽지 못해서 계획 순서대로 보여 줘요.
            </p>
          )}
          <div className="plan-graph" style={{ width: graph.width, height: graph.height }}>
            <svg className="plan-edges" width={graph.width} height={graph.height} aria-hidden="true">
              <defs>
                {(['flow', 'done'] as const).map((k) => (
                  <marker key={k} id={`plan-arrow-${k}`} className="plan-arrow" data-done={k === 'done' || undefined} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" />
                  </marker>
                ))}
              </defs>
              {graph.edges.map((e) => (
                <path key={e.key} className="plan-edge" data-done={e.done || undefined} d={e.d} markerEnd={`url(#plan-arrow-${e.done ? 'done' : 'flow'})`} />
              ))}
            </svg>
            <ol aria-label="계획 단계">
              {graph.nodes.map((n) => (
                <Node key={n.id} n={n} />
              ))}
            </ol>
          </div>
        </section>
      </div>
      {strip}
    </div>
  );
}
