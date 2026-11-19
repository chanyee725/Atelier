// What waits for a person's approval (#836), for the dashboard's 승인 대기 card and the sidebar 대시보드 count: plans
// waiting for 시작하기 and open permission prompts of sessions. Pure (no React or DOM), so it runs under `node --test`.
// Metadata only: the tool's name and the session's name, never the tool input.
import type { Session } from '../../../shared/dispatch/types.ts';
import type { WaitingPlan } from './plans.ts';

export type PermissionAsk = { sessionId: string; session: string; requestId: string; tool: string; since: number | null };

/** Open permission prompts, oldest first. */
export function permissionAsks(sessions: readonly Session[]): PermissionAsk[] {
  const out: PermissionAsk[] = [];
  for (const s of sessions) {
    for (const p of s.pending ?? []) {
      if (!p?.requestId) continue;
      out.push({ sessionId: s.id, session: s.name, requestId: p.requestId, tool: p.tool || '도구', since: s.stateSince ?? s.updatedAt ?? null });
    }
  }
  return out.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
}

/** What a plan row offers: 시작하기, 정리 (lead gone), or nothing (blocked otherwise; the blocker says why). */
export function planAction(p: Pick<WaitingPlan, 'leadGone' | 'blockers' | 'revision'>): 'start' | 'dismiss' | null {
  if (p.leadGone) return 'dismiss';
  if (p.blockers.length || p.revision === null) return null;
  return 'start';
}

/** The sidebar 대시보드 count. */
export const approvalCount = (plans: readonly unknown[], asks: readonly unknown[]) => plans.length + asks.length;
