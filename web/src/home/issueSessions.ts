// Who worked on an issue (#747): one entry per session that touched it, metadata only (role, provider, model, effort,
// the account label it started under, times, tokens, cost). From GET /api/issues/:n/accounts (the server's ledger,
// sessions that already ended included); while that loads, or for a branch that names no issue, the live sessions on
// the PR's branch stand in.
import { useEffect, useState } from 'react';
import { isOpen, totalTok } from '../dispatch/lib/format.ts';
import { issueOfBranch } from './issueBoard.ts';
import { shownAccount, type AccountLabels } from '../accountLabels';
import type { IssueSession as ApiIssueSession } from '../../../shared/dispatch/accounts.js';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { IssueSession } from './issueTotals.ts';

export { fmtDuration, providersOf, totals, type IssueSession } from './issueTotals.ts';

export { issueOfBranch } from './issueBoard.ts';

/** The issue of a PR's branch: a session's own `issue` when the server set one, else the branch name. */
export const issueOf = (sessions: readonly Session[], branch: string) =>
  sessions.find((s) => s.branch === branch && s.issue)?.issue ?? issueOfBranch(branch);

/** The live sessions on one branch (the stand-in before the server's list arrives). */
export function fromSessions(sessions: readonly Session[], branch: string, labels: AccountLabels): IssueSession[] {
  return sessions
    .filter((s) => s.branch === branch)
    .map((s) => ({
      key: s.id,
      role: s.roleName || s.role,
      provider: s.provider,
      model: s.modelLabel || s.model,
      effort: s.effort,
      accountLabel: shownAccount(s.provider, s.accountLabel, labels),
      startedAt: s.startedAt,
      endedAt: isOpen(s) ? null : s.updatedAt,
      tokens: totalTok(s.usage),
      cost: s.cost,
      shared: false,
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function fromApi(list: readonly ApiIssueSession[]): IssueSession[] {
  return list.map((s) => ({
    key: s.sid,
    role: s.role ?? '세션',
    provider: s.provider ?? '',
    model: s.modelLabel || s.model || '모델 모름',
    effort: s.effort,
    accountLabel: shownAccount(s.provider ?? '', s.accountLabel, {}),
    startedAt: s.startedAt ?? 0,
    endedAt: s.endedAt,
    tokens: totalTok(s.tokens),
    cost: s.cost,
    shared: !!s.shared,
  }));
}

/**
 * The server's list for an issue (null until it answers, or when the issue is null or the request fails).
 * Asked again whenever `refresh` changes (the tile passes its open state and the sessions' last update).
 */
export function useIssueSessions(issue: number | null, refresh: unknown): IssueSession[] | null {
  const [list, setList] = useState<IssueSession[] | null>(null);
  useEffect(() => {
    if (issue == null) return setList(null);
    const ctl = new AbortController();
    // pr=0: the tile already knows its PR, so the server skips the gh lookups.
    fetch(`/api/issues/${issue}/accounts?pr=0`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions?: ApiIssueSession[] }>) : null))
      .then((d) => !ctl.signal.aborted && d && setList(fromApi(d.sessions ?? [])))
      .catch(() => {});
    return () => ctl.abort();
  }, [issue, refresh]);
  return list;
}
