// The card dashboard's PR과 머지 card (#793) and its parts: a compact card with one
// dense row per item; long lists scroll inside their card so the page keeps one screen (#800). Read-only, metadata only.
import { ArrowRight, GitPullRequest } from 'lucide-react';
import { Button } from '../components/ui/button';
import { boardHash, plainClick } from '../projectNav';
import { Card, EmptyState, StatusDot } from './dash';
import { prRows } from './dashboardRows';
import { issuesBlankReason, type IssuesAnswer } from './issueBoard';
import type { Feed, PrAnswer } from './projectFeeds';

const ROW = 'flex h-9 min-w-0 items-center gap-2 px-4 text-xs';
const PR_STATE = { open: { label: '열림', tone: 'warn' }, merged: { label: '머지됨', tone: 'merged' }, closed: { label: '닫힘', tone: 'idle' } } as const;
const CI: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  success: { label: 'CI 통과', tone: 'ok' },
  failure: { label: 'CI 실패', tone: 'bad' },
  pending: { label: 'CI 진행 중', tone: 'warn' },
};
const REVIEW: Record<string, string> = { approved: '승인됨', changes: '수정 요청', required: '리뷰 대기' };

/** Header link to a 세션 보드 tab; a real link so a new tab works too. */
export function BoardTabLink({ tab, label, onBoard }: { tab: 'usage'; label: string; onBoard: (folder: string, tab?: 'usage') => void }) {
  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
      <a href={`/${boardHash({ tab })}`} onClick={(e) => (plainClick(e) ? (e.preventDefault(), onBoard('', tab)) : undefined)}>
        {label} <ArrowRight aria-hidden />
      </a>
    </Button>
  );
}

/** PRs of the open issues: state, review and CI; each row opens the PR on GitHub. */
export function PrsCard({ issues, prs, grow }: { issues: Feed<IssuesAnswer>; prs: Feed<ReadonlyMap<string, PrAnswer>>; grow?: number }) {
  const rows = prCount(issues, prs);
  return (
    <Card id="prs" grow={grow} scroll className={grow === undefined ? 'max-h-[30rem]' : undefined} title="PR과 머지" count={rows || undefined} flush>
      <PrsList issues={issues} prs={prs} />
    </Card>
  );
}

/** How many PR rows the list shows, for a header count. */
export const prCount = (issues: Feed<IssuesAnswer>, prs: Feed<ReadonlyMap<string, PrAnswer>>) =>
  issues && issues !== 'failed' && issues.ok ? prRows(issues.issues, prs).length : 0;

/** The PR rows (or why there are none), the body of 대시보드's PR과 머지 card and tab. */
export function PrsList({ issues, prs }: { issues: Feed<IssuesAnswer>; prs: Feed<ReadonlyMap<string, PrAnswer>> }) {
  const rows = issues && issues !== 'failed' && issues.ok ? prRows(issues.issues, prs) : [];
  return issues === null ? (
    <EmptyState>불러오는 중이에요</EmptyState>
  ) : issues === 'failed' ? (
    <EmptyState>{issuesBlankReason('error')}</EmptyState>
  ) : !issues.ok ? (
    <EmptyState>{issuesBlankReason(issues.reason)}</EmptyState>
  ) : rows.length === 0 ? (
    <EmptyState>열린 이슈에 붙은 PR이 없어요.</EmptyState>
  ) : (
    <ul aria-label="PR" className="m-0 list-none divide-y p-0">
      {rows.map((r) => {
        const ci = r.ci ? CI[r.ci] : undefined;
        const body = (
          <>
            <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-muted-foreground tabular-nums">#{r.number}</span>
            <span className="min-w-0 flex-1 truncate" title={r.title}>{r.title}</span>
            {r.conflict && <span className="shrink-0"><StatusDot tone="bad">충돌</StatusDot></span>}
            {ci && <span className="shrink-0 max-[1400px]:hidden"><StatusDot tone={ci.tone}>{ci.label}</StatusDot></span>}
            {r.review && r.state === 'open' && <span className="shrink-0 text-muted-foreground">{REVIEW[r.review]}</span>}
            <span className="shrink-0"><StatusDot tone={PR_STATE[r.state].tone}>{PR_STATE[r.state].label}</StatusDot></span>
          </>
        );
        return (
          <li key={r.number} data-pr={r.number}>
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className={`${ROW} text-inherit no-underline hover:bg-accent/40 focus-visible:bg-accent focus-visible:outline-none`}>{body}</a>
            ) : (
              <div className={ROW}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
