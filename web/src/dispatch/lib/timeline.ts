// 타임라인 card (#879, #928): which sessions it draws, grouped by team (a lead and the sessions under it). Pure: node --test loads it directly.
import { inScope, type Scope } from './folder.ts';
import type { Session, SessionState } from '../../../../shared/dispatch/types.ts';

export type Team<S> = { lead: S; members: S[] };
type Row = Pick<Session, 'id' | 'folder' | 'role' | 'parent' | 'startedAt'>;

/**
 * The sessions of one project (`projectId`: 전체 = undefined, 미분류 = null, else the folder path) grouped by team.
 * A session with no parent in view heads a team; every other session joins the team of its topmost ancestor in view
 * (a reviewer spawned by an implementer still sits under the lead). Teams run oldest lead first; members follow the
 * configured role order, then any other role, oldest first. `pending` (미분류 picked before the project list arrived)
 * shows nothing yet.
 */
export function timelineTeams<S extends Row>(
  sessions: readonly S[],
  roles: readonly { id: string }[],
  projectId: Scope,
  known: ReadonlySet<string>,
  pending = false,
): Team<S>[] {
  if (pending) return [];
  const mine = inScope(sessions, projectId, known);
  const byId = new Map(mine.map(s => [s.id, s]));
  const rootOf = (s: S) => {
    const seen = new Set<string>();
    let cur = s;
    while (cur.parent && byId.has(cur.parent) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent)!;
    }
    return cur;
  };
  const teams = new Map<string, Team<S>>();
  for (const s of mine) {
    const root = rootOf(s);
    let team = teams.get(root.id);
    if (!team) teams.set(root.id, (team = { lead: root, members: [] }));
    if (root !== s) team.members.push(s);
  }
  const rank = (role: string) => {
    const i = roles.findIndex(r => r.id === role);
    return i < 0 ? roles.length : i;
  };
  const out = [...teams.values()].sort((a, b) => a.lead.startedAt - b.lead.startedAt);
  for (const t of out) t.members.sort((a, b) => rank(a.role) - rank(b.role) || a.startedAt - b.startedAt);
  return out;
}

/** States that open a team by default: someone on it is doing or holding up work right now. */
const BUSY: ReadonlySet<SessionState> = new Set(['working', 'waiting', 'stuck']);
export const teamBusy = (states: readonly SessionState[]) => states.some(s => BUSY.has(s));

export type Span = { state: string; from: number; to: number };
/** Which state wins when team members overlap on the folded lead row: work first, then what needs a person. */
const RANK = ['working', 'waiting', 'stuck', 'failed', 'resting', 'done'];
const weight = (st: string) => {
  const i = RANK.indexOf(st);
  return i < 0 ? RANK.length : i;
};

/**
 * One row of spans for a folded team: at every moment the strongest state any member was in (working over
 * waiting over stuck over failed over resting over done), neighbours of the same state joined. Failure ticks
 * are the union of the members' ticks, sorted and deduplicated.
 */
export function mergeSpans(rows: readonly { spans: readonly Span[]; fails: readonly number[] }[]): { spans: Span[]; fails: number[] } {
  const cuts = [...new Set(rows.flatMap(r => r.spans.flatMap(p => [p.from, p.to])))].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    let best: string | null = null;
    for (const r of rows) {
      for (const p of r.spans) if (p.from <= from && p.to >= to && (best === null || weight(p.state) < weight(best))) best = p.state;
    }
    if (best === null) continue;
    const prev = spans[spans.length - 1];
    if (prev && prev.state === best && prev.to === from) prev.to = to;
    else spans.push({ state: best, from, to });
  }
  const fails = [...new Set(rows.flatMap(r => r.fails))].sort((a, b) => a - b);
  return { spans, fails };
}
