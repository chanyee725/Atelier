// Session ledger (issue #747): which sessions, models and accounts worked on which GitHub issue.
// Kept in <project>/.atelier/state.json under `ledger`, so it outlives removed sessions (auto-remove drops the
// session itself). Metadata only: role, provider, model, effort, the account *label* as it was when the session
// started, times, token counts, cost, branch names and issue numbers. Never transcripts, prompts, answers,
// emails or account ids. Strings are short tokens (pickSession's rule in server/runs/record.js).
import { accountsSummary, checkAccountLabel } from "../../shared/dispatch/accounts.js";

export const LEDGER_MAX = 2000;
const BRANCHES_MAX = 6;
const TOKEN_KEYS = ["input", "output", "cacheRead", "cacheWrite"];
const SHORT = /^[A-Za-z0-9._:/+-]{1,120}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const short = v => (typeof v === "string" && SHORT.test(v) && !EMAIL.test(v) ? v : null);
const num = v => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
// A label is checked when it is saved; checked again here with the same rule (shared/dispatch/accounts.js).
const label = v => { const r = checkAccountLabel(v); return r.ok ? r.value : null; };

/** A positive issue number (1..9_999_999) from a number or a "#747"/"747" string, else null. */
export function issueNumber(v) {
  const n = typeof v === "string" ? Number(v.replace(/^#/, "")) : v;
  return Number.isInteger(n) && n > 0 && n < 1e7 ? n : null;
}

/** The issue a branch names (`feat/747-accounts`, `fix/747`, `747-x`), else null. Dispatch's own branches never do. */
export function issueOfBranch(branch) {
  if (typeof branch !== "string" || branch.startsWith("dispatch/")) return null;
  const m = branch.match(/(?:^|\/)(?:issue-|gh-)?(\d{1,7})(?:[-_]|$)/i);
  return m ? issueNumber(Number(m[1])) : null;
}

export class Ledger {
  /** `store` is the dispatch Store; entries live in store.data.ledger. */
  constructor(store) {
    this.store = store;
  }

  get entries() {
    return (this.store.data.ledger ||= {});
  }

  /** Records or updates a session (a hub session object or its public copy). Returns the entry. */
  sync(s) {
    if (!s?.id) return null;
    const all = this.entries;
    const e = (all[s.id] ||= { sid: s.id, issues: [], branches: [] });
    e.parent = short(s.parent) ?? e.parent ?? null;
    e.role = short(s.role) ?? e.role ?? null;
    e.provider = short(s.provider) ?? e.provider ?? null;
    e.model = short(s.model) ?? e.model ?? null;
    e.modelLabel = (typeof s.modelLabel === "string" && s.modelLabel.length <= 80 ? s.modelLabel : null) ?? e.modelLabel ?? null;
    e.effort = short(s.effort) ?? e.effort ?? null;
    // The label is a snapshot from session start: set once, never rewritten by a later rename.
    if (!("accountLabel" in e)) e.accountLabel = label(s.accountLabel);
    e.startedAt = num(s.startedAt) ?? e.startedAt ?? null;
    if (s.status === "done") e.endedAt ??= num(s.updatedAt) ?? Date.now();
    else if (s.status === "running" || s.status === "starting") e.endedAt = null;
    else e.endedAt ??= null;
    e.tokens = Object.fromEntries(TOKEN_KEYS.map(k => [k, num(s.usage?.[k]) ?? 0]));
    e.cost = num(s.cost) ?? e.cost ?? null;
    this.addBranch(e, s.branch);
    this.addIssue(e, issueNumber(s.issue));
    this.trim();
    return e;
  }

  addBranch(e, branch) {
    const b = short(branch);
    if (!b || b === "HEAD") return;
    e.branch = b;
    if (!e.branches.includes(b)) {
      e.branches.push(b);
      if (e.branches.length > BRANCHES_MAX) e.branches.shift();
    }
    this.addIssue(e, issueOfBranch(b));
  }

  addIssue(e, n) {
    if (n && !e.issues.includes(n)) e.issues.push(n);
  }

  /** The branch a session is on now (read from its folder after a turn): remembered with the issue it names. */
  noteBranch(sid, branch) {
    const e = this.entries[sid];
    if (!e) return false;
    const before = `${e.branch}|${e.issues.join(",")}`;
    this.addBranch(e, branch);
    return before !== `${e.branch}|${e.issues.join(",")}`;
  }

  /** A removed session ends now unless it ended before. */
  end(sid, at = Date.now()) {
    const e = this.entries[sid];
    if (e && e.endedAt == null) e.endedAt = at;
  }

  /** Drops the oldest entries past LEDGER_MAX. */
  trim(max = LEDGER_MAX) {
    const all = this.entries;
    const ids = Object.keys(all);
    if (ids.length <= max) return;
    ids.sort((a, b) => (all[a].startedAt ?? 0) - (all[b].startedAt ?? 0));
    for (const id of ids.slice(0, ids.length - max)) delete all[id];
  }

  /**
   * The sessions that worked on an issue: entries naming it (by an explicit issue or a branch), plus their leads.
   * A lead's numbers are its whole session (it may have led other issues too).
   */
  forIssue(n) {
    const all = this.entries;
    const hit = Object.values(all).filter(e => e.issues.includes(n));
    const ids = new Set(hit.map(e => e.sid));
    for (const e of hit) if (e.parent && all[e.parent] && !ids.has(e.parent)) { ids.add(e.parent); hit.push(all[e.parent]); }
    return hit.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  }
}

/** The public shape of one entry for GET /api/issues/:n/accounts. `pr` comes from the PR lookup (null if unknown). */
export function issueSession(e, pr = null) {
  return {
    sid: e.sid, role: e.role ?? null, provider: e.provider ?? null, model: e.model ?? null, modelLabel: e.modelLabel ?? null,
    effort: e.effort ?? null, accountLabel: e.accountLabel ?? null, startedAt: e.startedAt ?? null, endedAt: e.endedAt ?? null,
    tokens: { ...Object.fromEntries(TOKEN_KEYS.map(k => [k, e.tokens?.[k] ?? 0])) }, cost: e.cost ?? null,
    branch: e.branch ?? null, pr,
  };
}

/**
 * `{ issue, sessions, summary }` for one issue. `prOf(branch)` answers like pr-status (`{ ok, pr: { number } }`);
 * it is asked once per distinct branch, at most `maxBranches` of them, and a failure leaves `pr` null.
 */
export async function issueAccounts(ledger, n, { prOf = null, maxBranches = 8 } = {}) {
  const entries = ledger.forIssue(n);
  const prs = new Map();
  if (prOf) {
    // Only branches that name this issue: a lead's own dispatch/ branch has no PR of its own.
    const branches = [...new Set(entries.map(e => e.branch).filter(b => issueOfBranch(b) === n))].slice(0, maxBranches);
    await Promise.all(branches.map(async b => {
      try {
        const r = await prOf(b);
        if (r?.ok && Number.isInteger(r.pr?.number)) prs.set(b, r.pr.number);
      } catch { /* unknown PR */ }
    }));
  }
  const sessions = entries.map(e => issueSession(e, prs.get(e.branch) ?? null));
  return { issue: n, sessions, summary: accountsSummary(sessions) };
}
