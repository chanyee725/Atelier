// Live branch view (#792): the wire shape of GET /api/branches/live and pure helpers for the 브랜치 tab and the
// dashboard widget. No browser APIs here, so tests run under node.

export type PrPhase = 'draft' | 'review' | 'mergeable' | 'conflict' | 'merged' | 'closed';
export type BranchSession = { id: string; name: string; role: string; roleName: string; color: string | null; folder: string | null; open: boolean };
export type BranchRow = {
  branch: string;
  sessions: BranchSession[];
  issue: number | null;
  ahead: number;
  behind: number;
  /** Tip commit time (ms), null when git did not say. */
  lastAt: number | null;
  subject: string;
  /** Uncommitted work in an open session's worktree; null when no open worktree or git could not tell. */
  dirty: boolean | null;
  merged: boolean;
  pr: { number: number; phase: PrPhase; url?: string } | null;
};
/** `pr`: "on", or why PRs are missing ("disabled", "gh-missing", "not-logged-in"). */
export type LiveBranches = { base: string | null; pr: string; rows: BranchRow[] };

export const PR_PHASE: Record<PrPhase, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  draft: { label: '초안', tone: 'idle' },
  review: { label: '리뷰 중', tone: 'warn' },
  mergeable: { label: '병합 가능', tone: 'ok' },
  conflict: { label: '충돌', tone: 'bad' },
  merged: { label: '병합됨', tone: 'idle' },
  closed: { label: '닫힘', tone: 'idle' },
};

/** Why the PR column is empty, in a short line; null when PRs are tracked. */
export function prOffText(reason: string): string | null {
  if (reason === 'on') return null;
  if (reason === 'disabled') return 'PR 추적이 꺼져 있어서 PR 상태는 보이지 않아요.';
  if (reason === 'gh-missing') return 'gh를 찾지 못해서 PR 상태는 보이지 않아요.';
  if (reason === 'not-logged-in') return 'gh에 로그인하지 않아서 PR 상태는 보이지 않아요.';
  return null;
}

/**
 * Rows to show: those with a session in `keep` (null keeps all), live work first (open session, not merged), then by
 * last commit, newest first. Merged rows stay, last, so the UI can fade them.
 */
export function shownRows(rows: readonly BranchRow[], keep: ((s: BranchSession) => boolean) | null = null): BranchRow[] {
  const live = (r: BranchRow) => Number(!r.merged) * 2 + Number(r.sessions.some((s) => s.open));
  return rows
    .filter((r) => !keep || r.sessions.some(keep))
    .sort((a, b) => live(b) - live(a) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

/** "3↑ 1↓" text for screen readers and titles. */
export const aheadBehindText = (r: Pick<BranchRow, 'ahead' | 'behind'>, base: string | null) =>
  `${base ?? '기준 브랜치'}보다 ${r.ahead}개 앞서고 ${r.behind}개 뒤처져 있어요`;
