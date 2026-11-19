// Pure data for the dashboard's 브랜치 and PR과 머지 cards (#793), and the `/` find shortcut test. Metadata only:
// branch names, commit counts, PR numbers and states the server already returns.
import type { ApiIssue } from './issueBoard';
import type { BranchTip, Branches, Feed, PrAnswer } from './projectFeeds';

export const BRANCH_STATE: Record<NonNullable<BranchTip['state']>, { label: string; tone: 'ok' | 'warn' | 'idle' | 'merged' }> = {
  open: { label: '작업 중', tone: 'warn' },
  merged: { label: '머지됨', tone: 'merged' },
  empty: { label: '커밋 없음', tone: 'idle' },
};

/**
 * Work branches (not the integration branch): live sessions' first, then the newest commit first. Branches in
 * `claimed` (those an open issue already lists) are left out, so the dashboard card shows only work without an issue.
 */
export function branchRows(branches: Feed<Branches>, claimed: ReadonlySet<string> = new Set()): BranchTip[] {
  if (!branches || branches === 'failed') return [];
  return [...branches.tips.values()]
    .filter((t) => !t.base && !claimed.has(t.branch))
    .sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.branch.localeCompare(b.branch));
}

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
