// 이슈 card of the project dashboard (#776): open GitHub issues as the unit of work. Each tile is one issue (number,
// title, its state, the sessions on it, its PR with review and CI); its branches with ahead/behind against the
// integration branch and the sessions' accounts open below it as native <details>. Open session branches that no issue
// claims are listed at the end, so no work drops out of view. Read-only; links open GitHub in a new tab.
import { ChevronRight, CircleDot, GitBranch, GitPullRequest } from 'lucide-react';
import { STATE, stateOf } from '../dispatch/lib/format.ts';
import { useAccountLabels } from '../accountLabels';
import { Card, CardGrid, CardTile, EmptyState, StatusDot } from './dash';
import { PrIssueSessions } from './IssueSessionList';
import { fromSessions } from './issueSessions';
import { ISSUE_STATE, issueRows, issuesBlankReason, looseBranches, type IssueRow, type IssuesAnswer } from './issueBoard';
import type { Branches, Feed, PrAnswer } from './projectFeeds';
import type { Session } from '../../../shared/dispatch/types.ts';

const CI: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' } | null> = {
  success: { label: 'CI 통과', tone: 'ok' },
  failure: { label: 'CI 실패', tone: 'bad' },
  pending: { label: 'CI 진행 중', tone: 'warn' },
  none: null,
};
const REVIEW: Record<string, string> = { approved: '승인됨', changes: '수정 요청', required: '리뷰 대기' };
const PR_STATE: Record<string, string> = { open: '열림', merged: '머지됨', closed: '닫힘' };

type Props = {
  issues: Feed<IssuesAnswer>;
  sessions: Feed<Session[]>;
  branches: Feed<Branches>;
  /** CI, review and conflicts of the open PRs' branches. */
  prs: Feed<ReadonlyMap<string, PrAnswer>>;
};

/** The head branches of open PRs, for the CI/review lookup (#686's /api/prs). */
export const openPrBranches = (answer: Feed<IssuesAnswer>) =>
  answer && answer !== 'failed' && answer.ok ? [...new Set(answer.issues.flatMap((i) => i.prs.flatMap((p) => (p.state === 'open' && p.branch ? [p.branch] : []))))] : [];

export function IssuesCard({ issues, sessions, branches, prs }: Props) {
  const list = Array.isArray(sessions) ? sessions : [];
  const rows = issues && issues !== 'failed' && issues.ok ? issueRows(issues.issues, list) : [];
  const loose = looseBranches(rows, list);
  const working = rows.filter((r) => r.state !== 'open').length;
  return (
    <Card id="issues" grow={5} title="이슈" count={rows.length || undefined} hint={rows.length ? `열린 이슈, 작업 중 ${working}개` : undefined} flush>
      {issues === null ? (
        <EmptyState>GitHub에서 이슈를 찾는 중이에요</EmptyState>
      ) : issues === 'failed' ? (
        <EmptyState>{issuesBlankReason('error')}</EmptyState>
      ) : !issues.ok ? (
        <EmptyState>{issuesBlankReason(issues.reason)}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>열린 이슈가 없어요.</EmptyState>
      ) : (
        <CardGrid label="열린 이슈">
          {rows.map((r) => (
            <IssueTile key={r.number} row={r} sessions={list} branches={branches} prs={prs} />
          ))}
        </CardGrid>
      )}
      {loose.length > 0 && <LooseBranches names={loose} sessions={list} branches={branches} />}
    </Card>
  );
}

function IssueTile({ row: r, sessions, branches, prs }: { row: IssueRow; sessions: Session[]; branches: Feed<Branches>; prs: Feed<ReadonlyMap<string, PrAnswer>> }) {
  const labels = useAccountLabels();
  const st = ISSUE_STATE[r.state];
  const pr = r.prs[0];
  const detail = pr?.state === 'open' && pr.branch && prs && prs !== 'failed' ? prs.get(pr.branch) : undefined;
  const live = detail?.ok ? detail.pr : null;
  const ci = live ? CI[live.ci] : null;
  const who = r.sessions.slice(0, 2).map((s) => `${s.name} · ${STATE[stateOf(s)].label}`);
  const fallback = r.sessions.flatMap((s) => (s.branch ? fromSessions(sessions, s.branch, labels).filter((x) => x.key === s.id) : []));
  const version = Math.floor(Math.max(0, ...r.sessions.map((s) => s.updatedAt ?? 0)) / 60_000);
  return (
    <CardTile
      data={`issue-${r.number}`}
      href={r.url}
      icon={<CircleDot />}
      title={
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-muted-foreground tabular-nums">#{r.number}</span>
          <span className="min-w-0 truncate" title={r.title}>{r.title || '제목 없음'}</span>
        </span>
      }
      sub={who.length ? `${who.join(', ')}${r.sessions.length > 2 ? ` 외 ${r.sessions.length - 2}` : ''}` : '맡은 세션 없음'}
      meta={
        <>
          <StatusDot tone={st.tone} pulse={r.state === 'progress'}>{st.label}</StatusDot>
          {pr && (
            <span className="inline-flex items-center gap-1">
              <GitPullRequest aria-hidden className="size-3" />
              <span className="font-mono">#{pr.number}</span>
              {pr.state !== 'open' && <span>{PR_STATE[pr.state]}</span>}
            </span>
          )}
          {live?.review && <span>{REVIEW[live.review]}</span>}
          {ci && <StatusDot tone={ci.tone}>{ci.label}</StatusDot>}
          {live?.conflict && <StatusDot tone="bad">충돌</StatusDot>}
        </>
      }
      footer={
        <>
          {(r.branches.length > 0 || r.prs.length > 1) && <IssueDetails row={r} branches={branches} />}
          <PrIssueSessions issue={r.number} fallback={fallback} version={version} />
        </>
      }
    />
  );
}

/** Ahead/behind against the base, with a full sentence for screen readers. */
function AheadBehind({ branch, branches }: { branch: string; branches: Feed<Branches> }) {
  if (!branches || branches === 'failed') return <span>{branches === null ? '…' : ''}</span>;
  const tip = branches.tips.get(branch);
  if (!tip) return null;
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-2 font-mono tabular-nums">
      <span className="sr-only">{`${branches.base}보다 커밋 ${tip.ahead}개 앞, ${tip.behind}개 뒤`}</span>
      <span aria-hidden className={tip.ahead > 0 ? 'text-foreground' : undefined}>↑{tip.ahead}</span>
      <span aria-hidden className={tip.behind > 0 ? 'text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]' : undefined}>↓{tip.behind}</span>
    </span>
  );
}

const SUMMARY =
  'flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-muted-foreground select-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden';
const Chevron = () => <ChevronRight aria-hidden className="size-3 shrink-0 transition-transform duration-[120ms] group-open/d:rotate-90 motion-reduce:transition-none" />;

/** The issue's branches (with ahead/behind) and every PR on it, behind one disclosure. */
function IssueDetails({ row: r, branches }: { row: IssueRow; branches: Feed<Branches> }) {
  return (
    <details data-issue-branches className="group/d border-t text-xs">
      <summary className={SUMMARY}>
        <Chevron />
        <span>브랜치 {r.branches.length}</span>
        {r.prs.length > 1 && <span>· PR {r.prs.length}</span>}
      </summary>
      <ul className="m-0 list-none divide-y border-t p-0">
        {r.branches.map((b) => (
          <li key={b} data-branch={b} className="flex min-w-0 items-center gap-1.5 px-3 py-1.5">
            <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-mono" title={b}>{b}</span>
            <AheadBehind branch={b} branches={branches} />
          </li>
        ))}
        {r.prs.map((p) => (
          <li key={p.number} className="flex min-w-0 items-center gap-1.5 px-3 py-1.5">
            <GitPullRequest aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-foreground hover:underline">#{p.number}</a>
            ) : (
              <span className="font-mono">#{p.number}</span>
            )}
            <span className="text-muted-foreground">{PR_STATE[p.state]}</span>
            {p.branch && <span className="ml-auto min-w-0 truncate font-mono text-muted-foreground">{p.branch}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Open session branches no issue claims, so work without an issue still shows. */
function LooseBranches({ names, sessions, branches }: { names: string[]; sessions: Session[]; branches: Feed<Branches> }) {
  return (
    <details data-loose-branches className="group/d border-t text-xs">
      <summary className={SUMMARY}>
        <Chevron />
        <span>이슈 없는 브랜치 {names.length}</span>
      </summary>
      <ul className="m-0 list-none divide-y border-t p-0">
        {names.map((b) => {
          const s = sessions.find((x) => x.branch === b);
          return (
            <li key={b} data-branch={b} className="flex min-w-0 items-center gap-1.5 px-3 py-1.5">
              <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-mono" title={b}>{b}</span>
              {s && <span className="min-w-0 truncate text-muted-foreground">{s.name}</span>}
              <AheadBehind branch={b} branches={branches} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}
