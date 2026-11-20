// The sessions that worked on one PR or issue (#747), under its dashboard tile: a native <details> whose summary
// line counts them with their provider marks and total cost, and opens to one entry per session (role, provider mark,
// model and effort, account label, time, tokens, cost). A lead's whole-session numbers are marked 공유 and left out
// of the totals, since they also count under the other issues it led (#756). Metadata only.
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { fmtK, fmtUsd, providerName } from '../dispatch/lib/format.ts';
import { ProviderIcon } from '../ProviderIcon';
import { fmtDuration, providersOf, totals, useIssueSessions, type IssueSession } from './issueSessions';

/**
 * The PR tile's list: the server's list for `issue` (asked again when the list opens or `version` changes), else
 * `fallback` (the live sessions on the PR's branch).
 */
export function PrIssueSessions({ issue, fallback, version }: { issue: number | null; fallback: readonly IssueSession[]; version: number }) {
  const [open, setOpen] = useState(false);
  const fetched = useIssueSessions(issue, `${open}-${version}`);
  const list = fetched?.length ? fetched : fallback;
  return <IssueSessionList sessions={list} issue={issue} onToggle={setOpen} />;
}

const ROLE: Record<string, string> = { lead: '관리자', impl: '구현자', review: '리뷰어', test: '테스터', design: '디자이너', docs: '문서화', merge: '병합자' };

export function IssueSessionList({ sessions, issue = null, onToggle, now = Date.now() }: { sessions: readonly IssueSession[]; issue?: number | null; onToggle?: (open: boolean) => void; now?: number }) {
  if (!sessions.length) return null;
  const sum = totals(sessions, now);
  return (
    <details data-issue-sessions data-issue={issue ?? undefined} className="group/is text-xs" onToggle={(e) => onToggle?.(e.currentTarget.open)}>
      <summary className="-mx-1.5 flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground select-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3 shrink-0 transition-transform duration-[120ms] group-open/is:rotate-90 motion-reduce:transition-none" />
        <span className="shrink-0 font-medium text-foreground">세션 {sessions.length}</span>
        <span aria-hidden className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          {providersOf(sessions).map((p) => (
            <ProviderIcon key={p} provider={p} className="size-3" />
          ))}
        </span>
        <span className="ml-auto shrink-0 pl-1 text-[13px] font-semibold text-foreground tabular-nums">{fmtUsd(sum.cost)}</span>
      </summary>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
        {sessions.map((s) => (
          <li key={s.key} data-issue-session className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/50 px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <ProviderIcon provider={s.provider} className="size-3 shrink-0" />
              <span className="sr-only">{providerName(s.provider)} </span>
              <span className="shrink-0 font-medium text-foreground">{ROLE[s.role] ?? s.role}</span>
              {s.shared && (
                <span data-issue-shared className="shrink-0 rounded-full bg-background px-1.5 text-[10px] leading-4 text-muted-foreground" title="다른 이슈와 함께 쓴 세션이라 합계에서 빼요">
                  공유
                </span>
              )}
              <span className="ml-auto shrink-0 text-foreground tabular-nums">{fmtUsd(s.cost)}</span>
            </span>
            <span className="min-w-0 truncate text-muted-foreground" title={`${s.model}${s.effort ? ` ${s.effort}` : ''}${s.accountLabel ? ` · 계정 ${s.accountLabel}` : ''}`}>
              {s.model}
              {s.effort && ` · ${s.effort}`}
            </span>
            <span className="text-muted-foreground tabular-nums">
              <span title={s.endedAt == null ? '아직 작업 중' : undefined}>
                {s.startedAt ? `${fmtDuration((s.endedAt ?? now) - s.startedAt)}${s.endedAt == null ? '째' : ''}` : '—'}
              </span>
              {' · 토큰 '}
              {fmtK(s.tokens)}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2 text-muted-foreground tabular-nums">
        합계 {fmtDuration(sum.ms)} · 토큰 {fmtK(sum.tokens)}
        {sum.shared > 0 && ` · 공유 ${sum.shared}개 빼고`}
      </p>
    </details>
  );
}
