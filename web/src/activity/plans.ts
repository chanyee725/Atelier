// Plans that wait for 시작하기 in the 알림함 (E579, #786): GET /api/pipeline/waiting as the bell shows it. Pure (no
// React or DOM), so it runs under `node --test`. Metadata only: path, title, the lead's session name, since when.
import { fileStemOf } from '../../../shared/dispatch/agent-activity.ts';

export type WaitingPlan = { path: string; title: string | null; lead: string | null; since: number | null };

/** The server's answer, malformed entries dropped. */
export function parseWaiting(d: unknown): WaitingPlan[] {
  const list = (d as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p) => {
    if (!p || typeof p !== 'object' || typeof (p as WaitingPlan).path !== 'string') return [];
    const { path, title, lead, since } = p as WaitingPlan;
    return [{ path, title: typeof title === 'string' && title ? title : null, lead: typeof lead === 'string' && lead ? lead : null, since: typeof since === 'number' ? since : null }];
  });
}

/** Plans in `next` that were not waiting in `seen` (the ones that get a toast). */
export const newlyWaiting = (seen: ReadonlySet<string>, next: WaitingPlan[]) => next.filter((p) => !seen.has(p.path));

/** "Jae 팀 계획이 시작을 기다려요" (or without a lead). */
export const planWaitingText = (p: Pick<WaitingPlan, 'lead'>) => (p.lead ? `${p.lead} 팀 계획이 시작을 기다려요` : '계획이 시작을 기다려요');

/** The plan's name: its title, else the file name. */
export const planTitle = (p: Pick<WaitingPlan, 'path' | 'title'>) => p.title || fileStemOf(p.path) || p.path;

/** Where it lives: area/feature folders ("web/run"), '' at the top. */
export const planFolder = (path: string) => path.split('/').slice(0, -1).join('/');
