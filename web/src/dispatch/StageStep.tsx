// Where a task stands among 계획 → 구현 → 리뷰 → 테스트 → 머지 (#1028), e.g. 리뷰 · 3/5: the stage colour dot and the
// count. One component for the dashboard's 진행 중인 이슈 row and the session board's 작업 보드, so both read the same.
import { cn } from '../lib/utils';
import { STAGE_BG, stageStep } from './lib/board.ts';
import type { TaskStage } from './types.ts';

/** `dot={false}` where a stage dot already sits next to it (the 작업 보드 row). */
export function StageStep({ stage, dot = true, className }: { stage: TaskStage; dot?: boolean; className?: string }) {
  const step = stageStep(stage);
  if (!step) return null;
  return (
    <span data-stage-step={stage} title={`${step.total}단계 중 ${step.n}단계: ${step.label}`} className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums', className)}>
      {dot && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STAGE_BG[stage])} />}
      <span>{step.text}</span>
    </span>
  );
}
