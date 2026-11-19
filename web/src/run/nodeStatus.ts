// Diagram-first board (#687): a step's display state → the colour, glyph and short text its diagram node is painted
// with. Pure, so it runs under `node --test`. Colours are CSS expressions on the --step-* tokens (index.css), so they
// follow light and dark and fall back to system colours in forced-colors mode. Never colour alone: every tone has
// its own glyph and text.

import { STEP_VIEWS, type StepView } from '../../../shared/dispatch/step-view.ts';

/** gray 대기 · blue 진행 · green 완료 · red 실패 · purple 막힘 / 결정 필요. */
export type NodeTone = 'pending' | 'active' | 'done' | 'failed' | 'blocked';

export const NODE_TONES: Readonly<Record<NodeTone, { color: string; glyph: string; label: string }>> = {
  pending: { color: 'var(--step-pending)', glyph: STEP_VIEWS.pending.glyph, label: STEP_VIEWS.pending.label },
  active: { color: 'var(--step-active)', glyph: STEP_VIEWS.active.glyph, label: STEP_VIEWS.active.label },
  done: { color: 'var(--step-done)', glyph: STEP_VIEWS.done.glyph, label: STEP_VIEWS.done.label },
  failed: { color: 'var(--step-failed)', glyph: '✕', label: '실패' },
  blocked: { color: 'var(--step-blocked)', glyph: STEP_VIEWS.blocked.glyph, label: STEP_VIEWS.blocked.label },
};

export interface NodeStatus {
  tone: NodeTone;
  color: string;
  glyph: string;
  /** Short visible text: `진행`, `리뷰`, `실패`, `결정 필요`... */
  label: string;
}

export interface NodeStatusInput {
  view: StepView;
  /** A session on the step failed (red). Without it a blocked step is purple. */
  failed?: boolean;
  /** A session waits on a person's answer: needs a decision (purple). */
  waiting?: boolean;
}

/** Worst first: failed (red), blocked (purple), needs a decision (purple), then the step view. */
export function nodeStatus({ view, failed, waiting }: NodeStatusInput): NodeStatus {
  if (failed && view !== 'done') return { tone: 'failed', ...NODE_TONES.failed };
  if (view === 'blocked') return { tone: 'blocked', ...NODE_TONES.blocked };
  const live = view === 'active' || view === 'review';
  if (live && waiting) return { tone: 'blocked', color: NODE_TONES.blocked.color, glyph: '?', label: '결정 필요' };
  if (view === 'review') return { tone: 'active', color: NODE_TONES.active.color, glyph: STEP_VIEWS.review.glyph, label: STEP_VIEWS.review.label };
  const tone: NodeTone = view;
  return { tone, ...NODE_TONES[tone] };
}
