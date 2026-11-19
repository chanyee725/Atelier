// Side cards of the card dashboard (#793): 사용량, 브랜치, PR과 머지. Each is a compact card with one
// dense row per item; long lists scroll inside their card so the page keeps one screen (#800). Read-only, metadata only.
import { ArrowRight, GitBranch, GitPullRequest } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Meter } from '../dispatch/parts';
import { pct, until } from '../dispatch/lib/format.ts';
import { boardHash, plainClick } from '../projectNav';
import { Card, EmptyState, StatusDot } from './dash';
import { useUsage } from '../lib/usage';
import { relativeTime } from './model';
import { BRANCH_STATE, branchRows, prRows } from './dashboardRows';
import { issuesBlankReason, type IssuesAnswer } from './issueBoard';
import type { Branches, Feed, PrAnswer } from './projectFeeds';

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

/** Usage of each connected provider: one meter per window (Claude 5시간 / 주간 …), with when it resets. */
export function UsageCard({ onBoard }: { onBoard: (folder: string, tab?: 'usage') => void }) {
  const groups = useUsage();
  return (
    <Card id="usage" title="사용량" actions={<BoardTabLink tab="usage" label="자세히" onBoard={onBoard} />}>
      {groups === null ? (
        <p className="m-0 text-sm text-muted-foreground">불러오는 중이에요</p>
      ) : groups === 'failed' ? (
        <p className="m-0 text-sm text-muted-foreground">사용량을 불러오지 못했어요.</p>
      ) : groups.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">연결된 모델이 없어요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {groups.flatMap((g) =>
            g.windows.length > 0
              ? g.windows.map((w) => (
                  <li key={`${g.id}:${w.label}`} data-usage={g.id} className="grid grid-cols-[minmax(0,9rem)_1fr_2.75rem] items-center gap-x-3 text-xs">
                    <span className="truncate">
                      {g.name} <span className="text-muted-foreground">{w.label}</span>
                    </span>
                    <Meter value={w.used} label={`${g.name} ${w.label} ${pct(w.used)}`} />
                    <span className="text-right tabular-nums">{pct(w.used)}</span>
                    {w.reset ? <span className="col-start-2 col-end-4 text-muted-foreground">{until(w.reset)} 뒤 초기화</span> : null}
                  </li>
                ))
              : [
                  <li key={g.id} data-usage={g.id} className="flex items-center gap-2 text-xs">
                    <span>{g.name}</span>
                    <span className="text-muted-foreground">{g.reached == null ? '아직 정보가 없어요' : g.reached ? `한도에 닿았어요${g.reset ? ` · ${until(g.reset)} 뒤 풀려요` : ''}` : '한도 안이에요'}</span>
                  </li>,
                ],
          )}
        </ul>
      )}
    </Card>
  );
}

/** Work branches no open issue claims (#793), against the integration branch: ahead/behind, state, last commit. */
export function BranchesCard({ branches, claimed, grow }: { branches: Feed<Branches>; claimed: ReadonlySet<string>; grow?: number }) {
  const rows = branchRows(branches, claimed);
  const base = branches && branches !== 'failed' ? branches.base : null;
  return (
    <Card id="branches" grow={grow} scroll className={grow === undefined ? 'max-h-80' : undefined} title="이슈 없는 브랜치" count={rows.length || undefined} hint={base ? `${base} 기준` : undefined} flush>
      {branches === null ? (
        <EmptyState>불러오는 중이에요</EmptyState>
      ) : branches === 'failed' ? (
        <EmptyState>브랜치를 불러오지 못했어요.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>이슈 없이 작업 중인 브랜치가 없어요.</EmptyState>
      ) : (
        <ul role="list" aria-label="이슈 없는 브랜치" className="m-0 list-none divide-y p-0">
          {rows.map((t) => {
            const st = t.state ? BRANCH_STATE[t.state] : null;
            return (
              <li key={t.branch} data-branch={t.branch} className={ROW}>
                <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono" title={t.branch}>{t.branch}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums" title={`앞선 커밋 ${t.ahead}개, 뒤처진 커밋 ${t.behind}개`}>
                  <span aria-hidden>↑{t.ahead} ↓{t.behind}</span>
                  <span className="sr-only">앞선 커밋 {t.ahead}개, 뒤처진 커밋 {t.behind}개</span>
                </span>
                {st && <span className="shrink-0"><StatusDot tone={st.tone}>{st.label}</StatusDot></span>}
                {t.lastAt ? <span className="w-14 shrink-0 text-right text-muted-foreground">{relativeTime(t.lastAt)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
