// Pure data for the dashboard's PR과 머지 card (#793), and the `/` find shortcut test. Metadata only:
// PR numbers and states the server already returns.
import type { ApiIssue } from './issueBoard';
import type { Feed, PrAnswer } from './projectFeeds';

export type PrRow = { number: number; state: 'open' | 'closed' | 'merged'; branch?: string; url?: string; issue: number; title: string; ci?: string; review?: string; conflict?: boolean };

const PR_ORDER = { open: 0, merged: 1, closed: 2 } as const;

/** Every PR linked to an open issue, once: open ones first, then merged, then closed; newest number first inside. */
export function prRows(issues: readonly ApiIssue[], prs: Feed<ReadonlyMap<string, PrAnswer>>): PrRow[] {
  const seen = new Map<number, PrRow>();
  for (const i of issues)
    for (const p of i.prs) {
      if (seen.has(p.number)) continue;
      const live = p.branch && prs && prs !== 'failed' ? prs.get(p.branch) : undefined;
      const extra = live?.ok && live.pr.number === p.number ? { ci: live.pr.ci, review: live.pr.review, conflict: live.pr.conflict } : {};
      seen.set(p.number, { number: p.number, state: p.state, branch: p.branch, url: p.url, issue: i.number, title: i.title, ...extra });
    }
  return [...seen.values()].sort((a, b) => PR_ORDER[a.state] - PR_ORDER[b.state] || b.number - a.number);
}

/**
 * Whether a keydown should open the file finder: a plain `/` (no Ctrl, Cmd or Alt, not mid-IME) outside text fields,
 * editors, menus and dialogs, so typing a slash anywhere you write still types a slash.
 */
export function isFindKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'target'>): boolean {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const t = e.target as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null;
  if (!t || typeof t.closest !== 'function') return true;
  return !(t.isContentEditable || t.closest('input, textarea, select, [contenteditable], .ProseMirror, .cm-editor, dialog, [role=dialog], [role=menu]'));
}
