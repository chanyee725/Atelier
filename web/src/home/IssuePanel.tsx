// The dashboard's one issue panel (#954): an issue row a team works on (진행 중인 이슈 or 이슈 card) opens its team
// panel (#925) here. Any other issue row goes to the chat dock instead (askAboutIssue), so nothing starts from a panel.
// Kept mounted for the 160ms slide-out after closing (#942). Reads the dashboard's feeds; no request of its own.
import { useMemo } from 'react';
import { IssueTeamPanel } from '../live/IssueTeamPanel';
import { useIssueTeamTarget } from '../live/issueStore';
import { usePanelExit } from '../live/usePanelExit';
import { activeIssues } from './activeIssues';
import { issueRows, type IssuesAnswer } from './issueBoard';
import type { Feed, PrAnswer } from './projectFeeds';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask } from '../dispatch/types.ts';

export type IssueFeeds = {
  issues: Feed<IssuesAnswer>;
  sessions: Feed<Session[]>;
  tasks: readonly BoardTask[];
  prs: Feed<ReadonlyMap<string, PrAnswer>>;
};

/** Issue rows, the in-progress ones, and the PR answer per branch, from the dashboard's feeds. */
export function useActiveIssueList({ issues, sessions, tasks, prs }: IssueFeeds) {
  const rows = useMemo(() => (issues && issues !== 'failed' && issues.ok && Array.isArray(sessions) ? issueRows(issues.issues, sessions) : []), [issues, sessions]);
  const list = useMemo(() => {
    if (!rows.length || !Array.isArray(sessions)) return [];
    const approved = (b: string) => {
      const a = prs && prs !== 'failed' ? prs.get(b) : undefined;
      return !!a?.ok && a.pr.review === 'approved';
    };
    return activeIssues(rows, sessions, tasks, approved);
  }, [rows, sessions, tasks, prs]);
  const answerOf = (b: string) => {
    const a = prs && prs !== 'failed' ? prs.get(b) : undefined;
    return a?.ok ? a.pr : null;
  };
  return { rows, list, answerOf };
}

export function IssuePanel({ now = Date.now(), ...feeds }: IssueFeeds & { now?: number }) {
  const { rows, list, answerOf } = useActiveIssueList(feeds);
  const open = useIssueTeamTarget();
  const exit = usePanelExit(open);
  if (exit.shown == null) return null;
  const row = rows.find((r) => r.number === exit.shown);
  const active = row && list.find((x) => x.number === row.number);
  if (!row || !active) return null;
  return <IssueTeamPanel key={`team-${row.number}`} issue={active} row={row} tasks={feeds.tasks} answerOf={answerOf} now={now} closing={exit.closing} />;
}
