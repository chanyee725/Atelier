// Who worked on an issue (#747): one entry per session that touched it, metadata only (role, provider, model, effort,
// the account label it started under, times, tokens, cost). From GET /api/issues/:n/accounts (the server's ledger,
// sessions that already ended included); while that loads, or for a branch that names no issue, the live sessions on
// the PR's branch stand in.
import { useEffect, useState } from 'react';
import { isOpen, totalTok } from '../dispatch/lib/format.ts';
import { shownAccount, type AccountLabels } from '../accountLabels';
import type { IssueSession as ApiIssueSession } from '../../../shared/dispatch/accounts.js';
import type { Session } from '../../../shared/dispatch/types.ts';

/** One entry as the tile shows it. */
export type IssueSession = {
  key: string;
  role: string;
  provider: string;
  model: string;
  effort: string | null;
  /** The user's label for that provider connection; null when unset (never an email or account id). */
  accountLabel: string | null;
  startedAt: number;
  /** null while the session still runs. */
  endedAt: number | null;
  tokens: number;
  cost: number | null;
};

type WithIssue = Session & { accountLabel?: string | null; issue?: number | null };

/**
 * The issue a branch works on: `feat/747-x`, `fix/issue-12`, `gh-9`; a lead's `dispatch/…` branch names none.
 * Mirrors issueOfBranch in server/dispatch/ledger.js.
 */
export function issueOfBranch(branch: string | null | undefined): number | null {
  if (!branch || branch.startsWith('dispatch/')) return null;
  const m = branch.match(/(?:^|\/)(?:issue-|gh-)?(\d{1,7})(?:[-_]|$)/i);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** The issue of a PR's branch: a session's own `issue` when the server set one, else the branch name. */
export const issueOf = (sessions: readonly Session[], branch: string) =>
  (sessions as readonly WithIssue[]).find((s) => s.branch === branch && s.issue)?.issue ?? issueOfBranch(branch);

/** The live sessions on one branch (the stand-in before the server's list arrives). */
export function fromSessions(sessions: readonly Session[], branch: string, labels: AccountLabels): IssueSession[] {
  return (sessions as readonly WithIssue[])
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

/** Sum of time and tokens; cost null when no session reports one. */
export function totals(list: readonly IssueSession[], now = Date.now()) {
  return {
    ms: list.reduce((a, s) => a + (s.startedAt ? Math.max(0, (s.endedAt ?? now) - s.startedAt) : 0), 0),
    tokens: list.reduce((a, s) => a + s.tokens, 0),
    cost: list.some((s) => s.cost != null) ? list.reduce((a, s) => a + (s.cost ?? 0), 0) : null,
  };
}

/** "45분", "1시간 5분", "2일 3시간"; under a minute is "1분 미만". */
export function fmtDuration(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return '1분 미만';
  if (m >= 1440) return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${m}분`;
}

/** Distinct providers in first-seen order, for the marks on the summary line. */
export const providersOf = (list: readonly IssueSession[]) => [...new Set(list.map((s) => s.provider).filter(Boolean))];
