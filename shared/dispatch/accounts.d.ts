export type AccountKey = 'claude' | 'openai' | 'gemini';
export type AccountLabels = Partial<Record<AccountKey, string>>;

export const ACCOUNT_KEYS: AccountKey[];
export const ACCOUNT_LABEL_MAX: number;
export function accountKey(provider: string | null | undefined): AccountKey | null;
export function defaultAccountLabel(provider: string | null | undefined): string | null;
export function checkAccountLabel(v: unknown): { ok: true; value: string | null } | { ok: false; error: string };
export function cleanAccountLabels(raw: unknown): AccountLabels;
export function accountLabelOf(labels: AccountLabels | null | undefined, provider: string | null | undefined): string | null;

/** One session that worked on an issue (metadata only). */
export interface IssueSession {
  sid: string;
  role: string | null;
  provider: string | null;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
  accountLabel: string | null;
  startedAt: number | null;
  endedAt: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number | null;
  branch: string | null;
  pr: number | null;
  /** Whole-session numbers that also cover other issues (a lead, or a session on several issues): not in the issue's totals. */
  shared: boolean;
}

export function accountsSummary(sessions: Array<Partial<IssueSession>>): string;
