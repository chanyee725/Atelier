// An issue a team works on now (#898), as one block at the top of the 이슈 card (#1025; it was the 진행 중 card's 이슈
// tab, which listed the same issues a second time): number and title with the stage chip (구현, 리뷰, 머지 대기, 머지됨),
// then who has it (관리자, 팀원), the PR counts, a merged-of-total bar when the issue is split into several PRs, and the
// time left when a board task has an ETA (set by the lead, or estimated from past runs: #1028). The chip shows the
// step count (리뷰 · 3/5). Quiet on purpose: the dashboard's standout is the working-session number.
import { GitPullRequest } from 'lucide-react';
import { cn } from '../lib/utils';
import { openIssueTeam } from '../live/issueStore';
import { StageStep } from '../dispatch/StageStep';
import { ACTIVE_STAGE, issueEta, type ActiveIssue } from './activeIssues';
import type { Session } from '../../../shared/dispatch/types.ts';

/** The stage chip: the step count (리뷰 · 3/5, #1028) when the issue has one, else its stage (머지됨). */
function StageChip({ stage, step }: { stage: ActiveIssue['stage']; step: ActiveIssue['step'] }) {
  const st = ACTIVE_STAGE[stage];
  return (
    <span data-active-stage={stage} className="inline-flex h-6 min-w-[5.75rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground/6 px-2.5 text-xs text-muted-foreground">
      {step ? <StageStep stage={step} /> : (
        <>
          <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
          <span className="truncate">{st.label}</span>
        </>
      )}
    </span>
  );
}

const names = (list: readonly Session[]) => list.map((s) => s.name).join(', ');

export function ActiveLine({ issue: x, now, open }: { issue: ActiveIssue; now: number; open: boolean }) {
  const eta = issueEta(x.etaAt, now, x.etaEstimated);
  const title = (
    <>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{x.number}</span>
      <span className="min-w-0 truncate" title={x.title}>{x.title || '제목 없음'}</span>
    </>
  );
  return (
    // data-origin + aria-current (#942): the row that opened the team panel keeps a ring while it is open.
    <li data-active-issue={x.number} data-origin aria-current={open || undefined} className="grid min-w-0 gap-1.5 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" aria-expanded={open} aria-label={`#${x.number} 팀 모니터링 열기`} onClick={(e) => openIssueTeam(x.number, e.currentTarget)} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          {title}
        </button>
        <StageChip stage={x.stage} step={x.step} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {x.leads.length > 0 && (
          <span data-active-leads className="min-w-0 truncate">
            관리자 <span className="text-foreground">{names(x.leads)}</span>
          </span>
        )}
        {x.members.length > 0 && (
          <span data-active-members className="min-w-0 truncate" title={names(x.members)}>
            팀원 <span className="text-foreground">{names(x.members)}</span>
          </span>
        )}
        {(x.openPrs > 0 || x.mergedPrs > 0) && (
          <span data-active-prs className="inline-flex shrink-0 items-center gap-1 tabular-nums">
            <GitPullRequest aria-hidden className="size-3" />
            {x.openPrs > 0 && <span>열림 {x.openPrs}</span>}
            {x.openPrs > 0 && x.mergedPrs > 0 && <span aria-hidden>·</span>}
            {x.mergedPrs > 0 && <span>머지 {x.mergedPrs}</span>}
          </span>
        )}
        {eta && (
          <span data-active-eta className={cn('ml-auto shrink-0 tabular-nums', eta.late ? 'text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]' : 'text-foreground')}>
            {eta.text}
          </span>
        )}
      </div>
      {x.progress && <Progress {...x.progress} />}
    </li>
  );
}

/** PRs merged out of the issue's PRs, as a thin bar and its sentence (e.g. PR 6개 중 4개 머지). */
function Progress({ merged, total }: { merged: number; total: number }) {
  const text = `PR ${total}개 중 ${merged}개 머지`;
  return (
    <div data-active-progress className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <div role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={total} aria-valuenow={merged} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/8">
        <div className="h-full rounded-full bg-merged" style={{ width: `${(merged / total) * 100}%` }} />
      </div>
      <span aria-hidden className="shrink-0 tabular-nums">{text}</span>
    </div>
  );
}
