// 진행 중인 이슈 card (#898): only the issues a team works on now (an open session or an open PR), one block each:
// number and title with the stage chip (구현, 리뷰, 머지 대기, 머지됨), then who has it (관리자, 팀원), the PR counts,
// a merged-of-total bar when the issue is split into several PRs, and the time left only when a board task set an ETA.
// Quiet on purpose: the dashboard's standout is the working-session number. Reuses the dashboard's feeds; no request
// of its own. Hidden while nothing is in progress (the 이슈 card covers the rest).
import { GitPullRequest } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card } from './dash';
import { openIssueTeam, useIssueTeamTarget } from '../live/issueStore';
import { ACTIVE_STAGE, issueEta, type ActiveIssue } from './activeIssues';
import { useActiveIssueList } from './IssuePanel';
import type { IssuesAnswer } from './issueBoard';
import type { Feed, PrAnswer } from './projectFeeds';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask } from '../dispatch/types.ts';

type Props = {
  issues: Feed<IssuesAnswer>;
  sessions: Feed<Session[]>;
  tasks: readonly BoardTask[];
  prs: Feed<ReadonlyMap<string, PrAnswer>>;
  now?: number;
};

export function ActiveIssuesCard({ issues, sessions, tasks, prs, now = Date.now() }: Props) {
  // The row's panel is drawn by the dashboard's one IssuePanel (#954).
  const { list } = useActiveIssueList({ issues, sessions, tasks, prs });
  const open = useIssueTeamTarget();
  if (!list.length) return null;
  return (
    // As tall as its rows up to a cap, then the rows scroll inside (like 세션 요청): a fill share cut rows in half.
    <Card id="active-issues" title="진행 중인 이슈" count={list.length} flush scroll className="max-h-80 shrink-0">
      <ul aria-label="진행 중인 이슈" className="m-0 list-none p-0 *:border-t">
        {list.map((x) => (
          <ActiveLine key={x.number} issue={x} now={now} open={open === x.number} />
        ))}
      </ul>
    </Card>
  );
}

function StageChip({ stage }: { stage: ActiveIssue['stage'] }) {
  const st = ACTIVE_STAGE[stage];
  return (
    <span data-active-stage={stage} className="inline-flex h-6 w-[5.75rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground/6 px-2.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
      <span className="truncate">{st.label}</span>
    </span>
  );
}

const names = (list: readonly Session[]) => list.map((s) => s.name).join(', ');

function ActiveLine({ issue: x, now, open }: { issue: ActiveIssue; now: number; open: boolean }) {
  const eta = issueEta(x.etaAt, now);
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
        <StageChip stage={x.stage} />
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
