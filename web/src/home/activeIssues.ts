// 진행 중인 이슈 (#898): the issues a team works on right now, one summary each for the dashboard card. Built from data
// the dashboard already has: the issue rows (GET /api/issues joined with the project's sessions, issueBoard.ts), all
// project sessions (to find a teammate's lead), the task board (GET /api/state `tasks`: stage and ETA) and the open
// PRs' review answer (GET /api/prs). An issue is in progress while a session on it is open or a PR on it is open;
// everything else stays only in the 이슈 card. Pure functions only, so tests run without a browser.
import { isOpen } from '../dispatch/lib/format.ts';
import { PROGRESS_STAGES, etaLine } from '../dispatch/lib/board.ts';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask, TaskStage } from '../dispatch/types.ts';
import type { IssueRow } from './issueBoard.ts';

export type ActiveStage = 'impl' | 'review' | 'merge' | 'merged';
/** Stage chips use the task board's stage colours (STAGE_BG): 구현 blue, 리뷰 amber, 머지 대기·머지됨 purple. */
export const ACTIVE_STAGE: Record<ActiveStage, { label: string; dot: string }> = {
  impl: { label: '구현', dot: 'bg-[var(--role-impl)]' },
  review: { label: '리뷰', dot: 'bg-[var(--role-review)]' },
  merge: { label: '머지 대기', dot: 'bg-merged' },
  merged: { label: '머지됨', dot: 'bg-merged' },
};
const RANK: Record<ActiveStage, number> = { impl: 0, review: 1, merge: 2, merged: 3 };

/** A board task's stage as an issue stage; null for finished or blocked tasks (they set no stage). */
export function taskStage(stage: TaskStage): ActiveStage | null {
  if (stage === 'plan' || stage === 'impl') return 'impl';
  if (stage === 'review' || stage === 'test') return 'review';
  if (stage === 'merge') return 'merge';
  return null;
}

export type ActiveIssue = {
  number: number;
  title: string;
  url?: string;
  stage: ActiveStage;
  /** Open lead sessions (관리자) on the issue: a lead on its branch, or the parent of a teammate on it. */
  leads: Session[];
  /** Open non-lead sessions (팀원) on the issue. */
  members: Session[];
  openPrs: number;
  mergedPrs: number;
  /** PRs merged out of all its PRs (closed unmerged ones left out); only when the issue is split into 2 or more PRs. */
  progress: { merged: number; total: number } | null;
  /** When the last open task on it should end (the board's ETA); null when no task has one. */
  etaAt: number | null;
  /** That ETA is the server's guess from finished tasks (#1028), shown as 약 N분 남음(예상). */
  etaEstimated: boolean;
  /** Step on 계획 → 구현 → 리뷰 → 테스트 → 머지 (#1028); null once merged. */
  boardStage: TaskStage | null;
};

const isLead = (s: Session) => s.role === 'lead';

/** The board tasks of one issue: owned by one of its sessions (by id or name), or titled with `#<n>`. */
export function issueTasks(n: number, sessions: readonly Session[], tasks: readonly BoardTask[]): BoardTask[] {
  const owners = new Set(sessions.flatMap((s) => [s.id, s.name]));
  const tag = new RegExp(`#${n}(?!\\d)`);
  return tasks.filter((t) => (t.owner != null && owners.has(t.owner)) || tag.test(t.title));
}

/**
 * The issue's stage: the least advanced piece still moving (an unapproved open PR is 리뷰, an approved one 머지 대기,
 * an open task its board stage, an open working session without an open PR on its branch 구현). With nothing moving,
 * 머지됨 when a PR merged, else 구현.
 */
export function activeStage(row: IssueRow, tasks: readonly BoardTask[], approved: (branch: string) => boolean): ActiveStage {
  const moving: ActiveStage[] = [];
  const openBranches = new Set<string>();
  for (const p of row.prs) {
    if (p.state !== 'open') continue;
    if (p.branch) openBranches.add(p.branch);
    moving.push(p.branch && approved(p.branch) ? 'merge' : 'review');
  }
  for (const t of tasks) {
    const st = taskStage(t.stage);
    if (st) moving.push(st);
  }
  if (row.sessions.some((s) => isOpen(s) && !isLead(s) && !(s.branch && openBranches.has(s.branch)))) moving.push('impl');
  if (moving.length) return moving.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
  return row.prs.some((p) => p.state === 'merged') ? 'merged' : 'impl';
}

const DEFAULT_STEP: Record<ActiveStage, TaskStage | null> = { impl: 'impl', review: 'review', merge: 'merge', merged: null };
const stepRank = (s: TaskStage) => PROGRESS_STAGES.findIndex((x) => x.id === s);

/**
 * The issue's step for the progress display (#1028): the least advanced open task stage inside its issue stage
 * (계획 vs 구현, 리뷰 vs 테스트), else the issue stage itself, so it shows without any board task.
 */
export function boardStage(stage: ActiveStage, tasks: readonly BoardTask[]): TaskStage | null {
  const inside = tasks.map((t) => t.stage).filter((st) => taskStage(st) === stage && stepRank(st) >= 0);
  if (inside.length) return inside.reduce((a, b) => (stepRank(b) < stepRank(a) ? b : a));
  return DEFAULT_STEP[stage];
}

/** The in-progress issues: earlier stages first (the work that still needs hands on top), newest number first inside. */
export function activeIssues(
  rows: readonly IssueRow[],
  all: readonly Session[],
  tasks: readonly BoardTask[],
  approved: (branch: string) => boolean = () => false,
): ActiveIssue[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  const out: ActiveIssue[] = [];
  for (const r of rows) {
    const open = r.sessions.filter(isOpen);
    const openPrs = r.prs.filter((p) => p.state === 'open').length;
    if (!open.length && !openPrs) continue;
    const members = open.filter((s) => !isLead(s));
    const leads = new Map(open.filter(isLead).map((s) => [s.id, s]));
    for (const m of members) {
      const p = m.parent ? byId.get(m.parent) : undefined;
      if (p && isLead(p) && isOpen(p)) leads.set(p.id, p);
    }
    const mine = issueTasks(r.number, [...open, ...leads.values()], tasks);
    const mergedPrs = r.prs.filter((p) => p.state === 'merged').length;
    const total = openPrs + mergedPrs;
    const timed = mine.filter((t) => t.stage !== 'done' && t.etaAt != null);
    const last = timed.reduce<BoardTask | null>((a, t) => (!a || t.etaAt! > a.etaAt! ? t : a), null);
    const stage = activeStage(r, mine, approved);
    out.push({
      number: r.number,
      title: r.title,
      url: r.url,
      stage,
      leads: [...leads.values()],
      members,
      openPrs,
      mergedPrs,
      progress: total >= 2 ? { merged: mergedPrs, total } : null,
      etaAt: last?.etaAt ?? null,
      etaEstimated: !!last?.etaEstimated,
      boardStage: boardStage(stage, mine),
    });
  }
  return out.sort((a, b) => RANK[a.stage] - RANK[b.stage] || b.number - a.number);
}

/** The ETA line of an issue (the board's wording); null without an ETA. */
export const issueEta = (etaAt: number | null, now: number, etaEstimated = false) => etaLine({ stage: 'impl', etaAt, etaEstimated }, now);
