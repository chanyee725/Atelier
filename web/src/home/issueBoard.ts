// GitHub issues as the unit of work on the project dashboard (#776). The server lists open issues with the PRs on
// them (GET /api/issues, read-only through gh); this module joins them with the project's sessions and gives each
// issue one state: 열림 → 진행 중 (a session works on it) → PR (an open PR) → 머지됨 (merged into the integration branch,
// the issue still open). Branches are a detail of an issue. Pure functions only, so tests run without a browser.
import { isOpen } from '../dispatch/lib/format.ts';
import type { Session } from '../../../shared/dispatch/types.ts';

export type IssuePr = { number: number; state: 'open' | 'closed' | 'merged'; url?: string; branch?: string };
export type ApiIssue = { number: number; title: string; url?: string; prs: IssuePr[] };
export type IssuesAnswer = { ok: true; issues: ApiIssue[] } | { ok: false; reason: string };

export type IssueState = 'open' | 'progress' | 'pr' | 'merged';
export const ISSUE_STATE: Record<IssueState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  open: { label: '열림', tone: 'idle' },
  progress: { label: '진행 중', tone: 'ok' },
  pr: { label: 'PR', tone: 'warn' },
  merged: { label: '머지됨', tone: 'ok' },
};

export type IssueRow = ApiIssue & {
  state: IssueState;
  /** Sessions on the issue, open ones first. */
  sessions: Session[];
  /** Branches of its sessions and PRs, without repeats. */
  branches: string[];
};

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

type WithIssue = Session & { issue?: number | null };

/** The state of one issue from its PRs and whether a session is open on it. */
export function issueState(prs: readonly IssuePr[], working: boolean): IssueState {
  if (prs.some((p) => p.state === 'open')) return 'pr';
  if (prs.some((p) => p.state === 'merged')) return 'merged';
  return working ? 'progress' : 'open';
}

const ORDER: Record<IssueState, number> = { pr: 0, progress: 1, merged: 2, open: 3 };

/**
 * Joins the server's issues with the project's sessions. A session belongs to an issue when the server set its
 * `issue`, its branch names the issue, or its branch is the head branch of one of the issue's PRs. Rows with work on
 * them come first (PR, 진행 중, 머지됨, then untouched), newest number first inside each.
 */
export function issueRows(issues: readonly ApiIssue[], sessions: readonly Session[]): IssueRow[] {
  const rows = issues.map((i) => {
    const prBranches = new Set(i.prs.flatMap((p) => (p.branch ? [p.branch] : [])));
    const mine = (sessions as readonly WithIssue[])
      .filter((s) => s.issue === i.number || issueOfBranch(s.branch) === i.number || (!!s.branch && prBranches.has(s.branch)))
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const branches = [...new Set([...mine.flatMap((s) => (s.branch ? [s.branch] : [])), ...prBranches])];
    return { ...i, sessions: mine, branches, state: issueState(i.prs, mine.some(isOpen)) };
  });
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.number - a.number);
}

/** Open session branches that no listed issue claims (still shown, under the list). */
export function looseBranches(rows: readonly IssueRow[], sessions: readonly Session[]): string[] {
  const claimed = new Set(rows.flatMap((r) => r.branches));
  return [...new Set(sessions.filter((s) => isOpen(s) && s.branch && !claimed.has(s.branch)).map((s) => s.branch!))];
}

/** Why the list is empty or missing, in one sentence. */
export function issuesBlankReason(reason: string): string {
  if (reason === 'gh-missing') return 'gh를 찾지 못해서 이슈를 볼 수 없어요.';
  if (reason === 'not-logged-in') return 'gh에 로그인하면 이슈가 여기에 보여요.';
  if (reason === 'disabled') return 'PR·CI 추적이 꺼져 있어요. 세션 보드 위쪽 스위치로 켤 수 있어요.';
  if (reason === 'timeout') return 'GitHub가 늦게 답해서 이슈를 못 가져왔어요. 잠시 뒤 다시 시도해요.';
  return '이슈를 불러오지 못했어요.';
}
