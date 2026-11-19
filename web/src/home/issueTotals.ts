// Pure parts of the issue session list (#747, #756): the entry type and the sums under a tile, kept free of React and
// the API so tests run without a browser.

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
  /** Whole-session numbers that also cover other issues (a lead): shown with 공유, left out of the totals. */
  shared: boolean;
};

/**
 * Sum of time and tokens over the issue's own sessions; cost null when none reports one. Shared sessions (a lead's
 * whole session, also counted under its other issues) are left out and only counted in `shared`.
 */
export function totals(all: readonly IssueSession[], now = Date.now()) {
  const list = all.filter((s) => !s.shared);
  return {
    shared: all.length - list.length,
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
