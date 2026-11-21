// Plans that wait for 시작하기 (E579, #786): GET /api/pipeline/waiting as the page shows it. Pure (no
// React or DOM), so it runs under `node --test`. Metadata only: path, title, the lead's session name, since when.
import { fileStemOf } from '../../../shared/dispatch/agent-activity.ts';

export type WaitingPlan = {
  path: string;
  title: string | null;
  lead: string | null;
  since: number | null;
  /** The revision 시작하기 approves (#836); null from an older server. */
  revision: number | null;
  /** Why it cannot start now (the server's words); empty when it can. */
  blockers: string[];
  /** The lead session that wrote it is gone: it cannot start, only be cleared (정리). */
  leadGone: boolean;
};

/** The server's answer, malformed entries dropped. */
export function parseWaiting(d: unknown): WaitingPlan[] {
  const list = (d as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p) => {
    if (!p || typeof p !== 'object' || typeof (p as WaitingPlan).path !== 'string') return [];
    const { path, title, lead, since, revision, blockers, leadGone } = p as WaitingPlan;
    return [{
      path,
      title: typeof title === 'string' && title ? title : null,
      lead: typeof lead === 'string' && lead ? lead : null,
      since: typeof since === 'number' ? since : null,
      revision: typeof revision === 'number' ? revision : null,
      blockers: Array.isArray(blockers) ? blockers.filter((b): b is string => typeof b === 'string' && b !== '') : [],
      leadGone: leadGone === true,
    }];
  });
}

/** Plans in `next` that were not waiting in `seen` (the ones that get a toast). */
export const newlyWaiting = (seen: ReadonlySet<string>, next: WaitingPlan[]) => next.filter((p) => !seen.has(p.path));

/** "Jae 팀 계획이 시작을 기다려요" (or without a lead). */
export const planWaitingText = (p: Pick<WaitingPlan, 'lead'>) => (p.lead ? `${p.lead} 팀 계획이 시작을 기다려요` : '계획이 시작을 기다려요');

/** The plan's name: its title, else the file name. */
export const planTitle = (p: Pick<WaitingPlan, 'path' | 'title'>) => p.title || fileStemOf(p.path) || p.path;
