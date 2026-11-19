// 타임라인 card (#879): which sessions it draws and in which role lanes. Pure: node --test loads it directly.
import { inScope, type Scope } from './folder.ts';
import type { Session } from '../../../../shared/dispatch/types.ts';

export type Lane<S> = { id: string; name: string; sessions: S[] };
type Row = Pick<Session, 'id' | 'folder' | 'role' | 'roleName' | 'startedAt'>;

/**
 * The sessions of one project (`projectId`: 전체 = undefined, 미분류 = null, else the folder path) grouped by role:
 * the configured roles in their order, then any role only a session still carries. Empty lanes drop out and each
 * lane runs oldest first. `pending` (미분류 picked before the project list arrived) shows nothing yet.
 */
export function timelineLanes<S extends Row>(
  sessions: readonly S[],
  roles: readonly { id: string; name: string }[],
  projectId: Scope,
  known: ReadonlySet<string>,
  pending = false,
): Lane<S>[] {
  if (pending) return [];
  const mine = inScope(sessions, projectId, known);
  const lanes: Lane<S>[] = roles.map(r => ({ id: r.id, name: r.name, sessions: [] }));
  for (const s of mine) {
    let lane = lanes.find(l => l.id === s.role);
    if (!lane) lanes.push((lane = { id: s.role, name: s.roleName || s.role, sessions: [] }));
    lane.sessions.push(s);
  }
  for (const l of lanes) l.sessions.sort((a, b) => a.startedAt - b.startedAt);
  return lanes.filter(l => l.sessions.length > 0);
}
