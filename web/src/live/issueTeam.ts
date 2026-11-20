// Pure parts of the issue team panel (#925): who is on the issue, the review verdict, the branch → PR flow and the
// team's cost. Metadata only (names, roles, models, states, numbers). No React, so tests run without a browser.
import type { Session } from '../../../shared/dispatch/types.ts';
import { isOpen } from '../dispatch/lib/format.ts';
import type { ActiveIssue } from '../home/activeIssues.ts';
import type { IssuePr } from '../home/issueBoard.ts';
import type { Pr } from '../home/projectFeeds.ts';

const tokens = (s: Session) => s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite;

/** 관리자 first, then the 팀원, each group in the order the dashboard card lists them. */
export function teamOf(issue: Pick<ActiveIssue, 'leads' | 'members'>): Session[] {
  return [...issue.leads, ...issue.members];
}

export type Verdict = { key: 'clear' | 'must-fix' | 'waiting' | 'none'; label: string };

/** The review verdict of the issue's open PRs: any "changes requested" wins, all approved is clear. */
export function verdict(prs: readonly IssuePr[], answerOf: (branch: string) => Pr | null): Verdict {
  const open = prs.filter((p) => p.state === 'open');
  if (!open.length) return { key: 'none', label: '열린 PR이 없어요' };
  const reviews = open.map((p) => (p.branch ? answerOf(p.branch)?.review : undefined));
  if (reviews.includes('changes')) return { key: 'must-fix', label: '고칠 점 있음' };
  if (reviews.every((r) => r === 'approved')) return { key: 'clear', label: '고칠 점 없음' };
  return { key: 'waiting', label: '리뷰 기다리는 중' };
}

export type FlowItem = { branch: string; pr: IssuePr | null };

/** Branch → PR chips: every branch of the issue once, with its PR when it has one (closed PRs left out). */
export function flowOf(branches: readonly string[], prs: readonly IssuePr[]): FlowItem[] {
  const live = prs.filter((p) => p.state !== 'closed');
  const byBranch = new Map(live.flatMap((p) => (p.branch ? [[p.branch, p] as const] : [])));
  const items = branches.map((b) => ({ branch: b, pr: byBranch.get(b) ?? null }));
  const seen = new Set(branches);
  const loose = live.filter((p) => !p.branch || !seen.has(p.branch)).map((p) => ({ branch: p.branch ?? '', pr: p }));
  return [...items, ...loose];
}

export type ModelCost = { provider: string; model: string; modelLabel: string; sessions: number; tokens: number; cost: number | null };
export type TeamCost = { ms: number; tokens: number; cost: number | null; shared: number; byModel: ModelCost[] };

/**
 * Team totals: time, tokens, cost. A lead's whole session also covers other issues, so leads are counted only in
 * `shared` and left out of the sums (as in the issue tile). Per-model subtotals use the same sessions.
 */
export function teamCost(team: readonly Session[], now = Date.now()): TeamCost {
  const own = team.filter((s) => s.role !== 'lead');
  const models = new Map<string, ModelCost>();
  for (const s of own) {
    const key = `${s.provider}/${s.model}`;
    const m = models.get(key) ?? { provider: s.provider, model: s.model, modelLabel: s.modelLabel, sessions: 0, tokens: 0, cost: null };
    m.sessions++;
    m.tokens += tokens(s);
    if (s.cost != null) m.cost = (m.cost ?? 0) + s.cost;
    models.set(key, m);
  }
  const priced = own.some((s) => s.cost != null);
  return {
    shared: team.length - own.length,
    ms: own.reduce((a, s) => a + (s.startedAt ? Math.max(0, (isOpen(s) ? now : s.updatedAt) - s.startedAt) : 0), 0),
    tokens: own.reduce((a, s) => a + tokens(s), 0),
    cost: priced ? own.reduce((a, s) => a + (s.cost ?? 0), 0) : null,
    byModel: [...models.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.tokens - a.tokens),
  };
}
