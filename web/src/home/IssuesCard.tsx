// 이슈 card of the project dashboard (#776, #784): open GitHub issues as the unit of work, one dense row per issue
// (Linear-like): number, the full title (cut at the panel edge), owner session initials, the open PR and a state chip.
// 작업 중 first, then PR 리뷰, then 열림; closed issues are not listed. Nothing is shown for an empty bit (no "맡은 세션
// 없음"). The row's chevron opens its details below: branches with ahead/behind, every PR (review, CI, conflicts) and
// the sessions' accounts. Branches no issue claims have their own dashboard card (이슈 없는 브랜치). Read-only. The
// number and title (#954) open the team panel when a team has the issue, else the chat dock's helper, which proposes
// a plan and starts it only on 시작하기. The GitHub button and PR links open GitHub in a new tab.
// #1025: the issues a team works on now come first as fuller blocks (ActiveLine: stage, lead, members, PRs, ETA) and
// are left out of the rows below, so each issue shows once; the dashboard has no second issue list.
import { useId, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, GitBranch, GitPullRequest } from 'lucide-react';
import { Button } from '../components/ui/button';
import { STATE, isOpen, stateOf } from '../dispatch/lib/format.ts';
import { useAccountLabels } from '../accountLabels';
import { cn } from '../lib/utils';
import { Card, EmptyState, StatusDot, TONE } from './dash';
import { RunningMark } from './ActiveDocsList';
import { PrIssueSessions } from './IssueSessionList';
import { ActiveLine } from './ActiveIssueLine';
import { useActiveIssueList } from './IssuePanel';
import { Pager, useBoxRows, usePaging } from './Pager';
import { openIssueTeam, useIssueTeamTarget } from '../live/issueStore';
import { askAboutIssue } from '../chat/lib/askIssue';
import { hasTeam } from './issueStart';
import { fromSessions } from './issueSessions';
import { ISSUE_STATE, initials, issueRows, issuesBlankReason, ownerSessions, type IssueRow, type IssuesAnswer } from './issueBoard';
import type { Branches, Feed, PrAnswer } from './projectFeeds';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask } from '../dispatch/types.ts';

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
  /** Board tasks, for the in-progress blocks' stage and ETA. */
  tasks?: readonly BoardTask[];
  /** The list's filter and sort; a change goes back to page 1 (#800). */
  filterKey?: string;
  /** Share of a filled dashboard column (#819): the card takes the rest of the column and pages to the rows that fit. */
  fill?: number;
};

/** Issues on one page (#793) when the card is as tall as its rows (stacked, or a dashboard that does not fill). */
export const ISSUES_PER_PAGE = 8;
/** One issue row with its divider, px (h-9 + 1px border). */
const ISSUE_ROW_PX = 37;

/** The head branches of open PRs, for the CI/review lookup (#686's /api/prs). */
export const openPrBranches = (answer: Feed<IssuesAnswer>) =>
  answer && answer !== 'failed' && answer.ok ? [...new Set(answer.issues.flatMap((i) => i.prs.flatMap((p) => (p.state === 'open' && p.branch ? [p.branch] : []))))] : [];

const NO_TASKS: readonly BoardTask[] = [];

export function IssuesCard({ issues, sessions, branches, prs, tasks = NO_TASKS, filterKey = '', fill }: Props) {
  const list = Array.isArray(sessions) ? sessions : [];
  const all = issues && issues !== 'failed' && issues.ok ? issueRows(issues.issues, list) : [];
  const { list: active } = useActiveIssueList({ issues, sessions, tasks, prs });
  const busy = new Set(active.map((x) => x.number));
  const rows = all.filter((r) => !busy.has(r.number));
  const box = useRef<HTMLDivElement | null>(null);
  const size = useBoxRows(box, { rowHeight: ISSUE_ROW_PX, min: 3, max: 60, fallback: ISSUES_PER_PAGE });
  const paged = usePaging(rows, size, filterKey);
  const shown = useIssueTeamTarget();
  return (
    <Card id="issues" title="이슈" count={all.length || undefined} flush fill={fill}>
      {issues === null ? (
        <EmptyState>GitHub에서 이슈를 찾는 중이에요</EmptyState>
      ) : issues === 'failed' ? (
        <EmptyState>{issuesBlankReason('error')}</EmptyState>
      ) : !issues.ok ? (
        <EmptyState>{issuesBlankReason(issues.reason)}</EmptyState>
      ) : all.length === 0 ? (
        <EmptyState>열린 이슈가 없어요.</EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <ul aria-label="진행 중인 이슈" data-active-issues className="m-0 shrink-0 list-none p-0 *:border-t">
              {active.map((x) => (
                <ActiveLine key={x.number} issue={x} now={Date.now()} open={shown === x.number} />
              ))}
            </ul>
          )}
          {/* Filled: this box takes the card's spare height, so the pager below sits on the card's bottom edge. */}
          <div ref={box} data-issues-box className={cn(fill !== undefined && '@min-[880px]:min-h-0 @min-[880px]:flex-1 @min-[880px]:overflow-y-auto')}>
            <ul aria-label="열린 이슈" className="m-0 list-none p-0 *:border-t">
              {paged.shown.map((r) => (
                <IssueLine key={r.number} row={r} sessions={list} branches={branches} prs={prs} panelOpen={shown === r.number} />
              ))}
            </ul>
          </div>
          <Pager page={paged.page} count={paged.count} onPage={paged.setPage} label="이슈 페이지" className="shrink-0" />
        </>
      )}
    </Card>
  );
}

/** The live review/CI/conflict answer for an open PR, when the lookup has one. */
function liveOf(pr: IssueRow['prs'][number] | undefined, prs: Feed<ReadonlyMap<string, PrAnswer>>) {
  const detail = pr?.state === 'open' && pr.branch && prs && prs !== 'failed' ? prs.get(pr.branch) : undefined;
  return detail?.ok ? detail.pr : null;
}

/** 열림 / 작업 중 / PR 리뷰 chip; a fixed width so the chips line up down the list. */
function StateChip({ row }: { row: IssueRow }) {
  const st = ISSUE_STATE[row.state];
  return (
    <span data-issue-state={row.state} className="inline-flex h-6 w-[5.25rem] shrink-0 items-center justify-center gap-1.5 rounded-full bg-foreground/6 px-2.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE[st.tone], row.state === 'progress' && 'motion-safe:animate-pulse')} />
      <span className="truncate">{st.label}</span>
    </span>
  );
}

/** Up to three initials of the sessions open on the issue, overlapping like avatars. */
function Owners({ sessions }: { sessions: Session[] }) {
  if (!sessions.length) return null;
  const shown = sessions.slice(0, 3);
  const names = sessions.map((s) => `${s.name} · ${STATE[stateOf(s)].label}`).join(', ');
  return (
    <span data-issue-owners className="flex shrink-0 items-center" title={names}>
      <span className="sr-only">맡은 세션 {names}</span>
      {shown.map((s) => (
        <span key={s.id} aria-hidden className="-ml-1 grid size-5 place-items-center rounded-full bg-muted text-2xs font-semibold text-foreground ring-2 ring-card first:ml-0">
          {initials(s.name)}
        </span>
      ))}
      {sessions.length > 3 && <span aria-hidden className="ml-1 text-2xs text-muted-foreground tabular-nums">+{sessions.length - 3}</span>}
    </span>
  );
}

function IssueLine({ row: r, sessions, branches, prs, panelOpen }: { row: IssueRow; sessions: Session[]; branches: Feed<Branches>; prs: Feed<ReadonlyMap<string, PrAnswer>>; panelOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const owners = ownerSessions(r);
  const pr = r.prs.find((p) => p.state === 'open');
  const live = liveOf(pr, prs);
  const alarm = live && (live.conflict || live.ci === 'failure');
  const hasDetail = r.branches.length > 0 || r.prs.length > 0 || r.sessions.length > 0;
  const team = hasTeam(r);
  const title = (
    <>
      <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{r.number}</span>
      <span className="min-w-0 truncate" title={r.title}>{r.title || '제목 없음'}</span>
    </>
  );
  return (
    // data-origin + aria-current (#942): the row that opened the issue panel keeps a ring while it is open.
    <li data-row={`issue-${r.number}`} data-origin aria-current={panelOpen || undefined} className="min-w-0">
      <div className="flex h-9 min-w-0 items-center gap-2 pr-3 pl-1.5 text-sm hover:bg-accent/40">
        {hasDetail ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpen((v) => !v)}
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ChevronRight aria-hidden className={cn('size-3.5 transition-transform duration-[120ms] motion-reduce:transition-none', open && 'rotate-90')} />
            <span className="sr-only">#{r.number} 자세히 보기</span>
          </button>
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <button
          type="button"
          aria-expanded={team ? panelOpen : undefined}
          aria-label={team ? `#${r.number} 팀 패널 열기` : `#${r.number} 채팅으로 물어보기`}
          data-issue-open={r.number}
          onClick={(e) => (team ? openIssueTeam(r.number, e.currentTarget) : askAboutIssue({ number: r.number, title: r.title, state: ISSUE_STATE[r.state].label, url: r.url }))}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {title}
        </button>
        {(r.sessions.some(isOpen) || r.prs.some((p) => p.state === 'open')) && <RunningMark />}
        <Owners sessions={owners} />
        {pr && (
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-issue-pr={pr.number}
            title={alarm ? (live.conflict ? '충돌' : 'CI 실패') : undefined}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs text-muted-foreground no-underline hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <GitPullRequest aria-hidden className="size-3" />
            <span className="font-mono tabular-nums">#{pr.number}</span>
            {alarm && (
              <>
                <span aria-hidden className={cn('size-1.5 rounded-full', TONE.bad)} />
                <span className="sr-only">{live.conflict ? '충돌' : 'CI 실패'}</span>
              </>
            )}
          </a>
        )}
        <StateChip row={r} />
        {r.url ? (
          <Button asChild size="icon-sm" variant="ghost" className="-mr-1.5 size-6 shrink-0 text-muted-foreground">
            <a href={r.url} target="_blank" rel="noreferrer" aria-label={`#${r.number} GitHub에서 열기`} title="GitHub에서 열기" data-issue-github={r.number}>
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </Button>
        ) : (
          <span aria-hidden className="-mr-1.5 size-6 shrink-0" />
        )}
      </div>
      {open && (
        <div id={panel} className="border-t bg-muted/30">
          <IssueDetails row={r} sessions={sessions} branches={branches} prs={prs} />
        </div>
      )}
    </li>
  );
}

/** Ahead/behind against the base, with a full sentence for screen readers. */
function AheadBehind({ branch, branches }: { branch: string; branches: Feed<Branches> }) {
  if (!branches || branches === 'failed') return <span>{branches === null ? '…' : ''}</span>;
  const tip = branches.tips.get(branch);
  if (!tip) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 pl-0.5 text-muted-foreground tabular-nums">
      <span className="sr-only">{`${branches.base}보다 커밋 ${tip.ahead}개 앞, ${tip.behind}개 뒤`}</span>
      <span aria-hidden className={tip.ahead > 0 ? 'text-foreground' : undefined}>↑{tip.ahead}</span>
      <span aria-hidden className={tip.behind > 0 ? 'text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]' : undefined}>↓{tip.behind}</span>
    </span>
  );
}


/** The issue's work under its row (2026-11-20 tidy): one inset panel with the branch → PR flow as chips, then its sessions. */
function IssueDetails({ row: r, sessions, branches, prs }: { row: IssueRow; sessions: Session[]; branches: Feed<Branches>; prs: Feed<ReadonlyMap<string, PrAnswer>> }) {
  const labels = useAccountLabels();
  const fallback = r.sessions.flatMap((s) => (s.branch ? fromSessions(sessions, s.branch, labels).filter((x) => x.key === s.id) : []));
  const version = Math.floor(Math.max(0, ...r.sessions.map((s) => s.updatedAt ?? 0)) / 60_000);
  const chip = 'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1';
  return (
    <div data-issue-details className="py-2 pr-3 pl-8 text-xs">
      <div className="flex flex-col gap-2.5 rounded-card bg-background p-3 shadow-[0_0_0_1px_var(--border)]">
        {(r.branches.length > 0 || r.prs.length > 0) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {r.branches.map((b) => (
              <span key={b} data-branch={b} className={chip} title={b}>
                <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-foreground">{b}</span>
                <AheadBehind branch={b} branches={branches} />
              </span>
            ))}
            {r.branches.length > 0 && r.prs.length > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
            {r.prs.map((p) => {
              const live = liveOf(p, prs);
              const ci = live ? CI[live.ci] : null;
              const body = (
                <>
                  <GitPullRequest aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-foreground tabular-nums">#{p.number}</span>
                  <span className={p.state === 'merged' ? 'text-merged' : 'text-muted-foreground'}>{PR_STATE[p.state]}</span>
                  {live?.review && <span className="text-muted-foreground">· {REVIEW[live.review]}</span>}
                  {ci && <StatusDot tone={ci.tone}>{ci.label}</StatusDot>}
                  {live?.conflict && <StatusDot tone="bad">충돌</StatusDot>}
                </>
              );
              return p.url ? (
                <a key={p.number} href={p.url} target="_blank" rel="noreferrer" className={cn(chip, 'no-underline hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none')}>{body}</a>
              ) : (
                <span key={p.number} className={chip}>{body}</span>
              );
            })}
          </div>
        )}
        <PrIssueSessions issue={r.number} fallback={fallback} version={version} />
      </div>
    </div>
  );
}

