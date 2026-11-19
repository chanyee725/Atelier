// The sessions that worked on one PR or issue (#747), under its dashboard tile: a native <details> whose summary
// line counts them with their provider marks and total cost, and opens to one entry per session (role, provider mark,
// model and effort, account label, time, tokens, cost). Metadata only.
import { ChevronRight } from 'lucide-react';
import { fmtK, fmtUsd, providerName } from '../dispatch/lib/format.ts';
import { ProviderIcon } from '../ProviderIcon';
import { fmtDuration, providersOf, totals, type IssueSession } from './issueSessions';

export function IssueSessionList({ sessions, now = Date.now() }: { sessions: readonly IssueSession[]; now?: number }) {
  if (!sessions.length) return null;
  const sum = totals(sessions, now);
  return (
    <details data-issue-sessions className="group/is border-t text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-b-md px-3 py-1.5 text-muted-foreground select-none group-open/is:rounded-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3 shrink-0 transition-transform duration-[120ms] group-open/is:rotate-90 motion-reduce:transition-none" />
        <span className="shrink-0">참여 세션 {sessions.length}</span>
        <span aria-hidden className="flex shrink-0 items-center gap-0.5">
          {providersOf(sessions).map((p) => (
            <ProviderIcon key={p} provider={p} className="size-3" />
          ))}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">{fmtUsd(sum.cost)}</span>
      </summary>
      <ul className="m-0 list-none divide-y border-t p-0">
        {sessions.map((s, i) => (
          <li key={`${s.startedAt}-${i}`} data-issue-session className="grid min-w-0 gap-0.5 px-3 py-1.5">
            {/* Who: role and account label, then cost. What and how long: model and effort, then time and tokens. */}
            <span className="flex min-w-0 items-center gap-1.5">
              <ProviderIcon provider={s.provider} className="size-3" />
              <span className="sr-only">{providerName(s.provider)} </span>
              <span className="shrink-0 text-foreground">{s.role}</span>
              {s.accountLabel && (
                <span className="min-w-0 truncate text-muted-foreground" title={`계정 ${s.accountLabel}`}>
                  <span aria-hidden>· </span>
                  <span className="sr-only">계정 </span>
                  {s.accountLabel}
                </span>
              )}
              <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">{fmtUsd(s.cost)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 pl-[18px] text-muted-foreground tabular-nums">
              <span className="min-w-0 truncate" title={`${s.model}${s.effort ? ` ${s.effort}` : ''}`}>
                {s.model}
                {s.effort && ` ${s.effort}`}
              </span>
              <span className="ml-auto shrink-0" title={s.endedAt == null ? '아직 작업 중' : undefined}>
                {fmtDuration((s.endedAt ?? now) - s.startedAt)}
                {s.endedAt == null && '째'}
              </span>
              <span aria-hidden>·</span>
              <span className="shrink-0">
                <span className="sr-only">토큰 </span>
                {fmtK(s.tokens)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 border-t px-3 py-1.5 text-muted-foreground tabular-nums">
        합계 {fmtDuration(sum.ms)} · 토큰 {fmtK(sum.tokens)}
      </p>
    </details>
  );
}
