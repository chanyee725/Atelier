// Who worked on an issue (#747): one entry per session that touched it, metadata only (role, provider, model, effort,
// the user's account label, times, tokens, cost, branch, PR). The shape matches the server's per-issue summary; until
// that endpoint is wired, the PR card builds the same list from the project's live sessions on the PR's branch.
import { isOpen, totalTok } from '../dispatch/lib/format.ts';
import type { AccountLabels } from '../accountLabels';
import type { Session } from '../../../shared/dispatch/types.ts';

export type IssueSession = {
  role: string;
  provider: string;
  model: string;
  effort: string | null;
  /** The label the user set for that provider connection; never an email or account id. */
  accountLabel: string | null;
  startedAt: number;
  /** null while the session still runs. */
  endedAt: number | null;
  tokens: number;
  cost: number | null;
  branch: string | null;
  pr: number | null;
};

export type IssueSessions = { issue: number | null; sessions: IssueSession[] };

/** The sessions on one branch, as issue entries (the fallback before the server summary). */
export function fromSessions(sessions: readonly Session[], branch: string, labels: AccountLabels, pr: number | null = null): IssueSession[] {
  return sessions
    .filter((s) => s.branch === branch)
    .map((s) => ({
      role: s.roleName || s.role,
      provider: s.provider,
      model: s.modelLabel || s.model,
      effort: s.effort,
      accountLabel: (s as Session & { accountLabel?: string | null }).accountLabel ?? labels[s.provider] ?? null,
      startedAt: s.startedAt,
      endedAt: isOpen(s) ? null : s.updatedAt,
      tokens: totalTok(s.usage),
      cost: s.cost,
      branch: s.branch,
      pr,
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** Sum of time, tokens and cost; cost null when no session reports one. */
export function totals(list: readonly IssueSession[], now = Date.now()) {
  return {
    ms: list.reduce((a, s) => a + Math.max(0, (s.endedAt ?? now) - s.startedAt), 0),
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

/** Distinct providers in first-seen order, for the stacked marks on the summary line. */
export const providersOf = (list: readonly IssueSession[]) => [...new Set(list.map((s) => s.provider))];
