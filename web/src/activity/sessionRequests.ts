// 세션 요청 (#880): what agent sessions asked a person for, as one list for the dashboard card — plans waiting for
// 시작하기, permission prompts, questions (a prompt for the CLI's AskUserQuestion tool) and sessions the server marks as
// waiting for a person. Built from waitingPlans, permissionAsksStore and the sessions list (no new server API). Pure (no React or DOM), so it runs under `node --test`. Metadata only: session names,
// provider ids, tool names, plan titles, times.
import type { Session } from '../../../shared/dispatch/types.ts';
import type { PermissionAsk } from './approvals.ts';
import { planTitle, type WaitingPlan } from './plans.ts';
import type { QuestionItem, QuestionOption } from '../dispatch/lib/question.ts';

export type RequestKind = 'plan' | 'permission' | 'question' | 'waiting';

export const REQUEST_LABEL: Record<RequestKind, string> = {
  plan: '계획 승인',
  permission: '권한 요청',
  question: '질문',
  waiting: '사람 기다림',
};

/** Where a click goes, where a click goes: a plan's 시작하기 confirm, or the session on the board. */
export type RequestTarget = { plan: string } | { session: string };

export interface SessionRequest {
  key: string;
  kind: RequestKind;
  /** The session's own name; null for a plan whose lead is unknown. */
  session: string | null;
  provider: string | null;
  /** One line: what it asks for. */
  text: string;
  /** Since when it waits (ms); null when unknown. */
  at: number | null;
  target: RequestTarget;
}

type SessionLike = Pick<Session, 'id' | 'name' | 'provider' | 'pending'> & Partial<Pick<Session, 'state' | 'stateSince' | 'updatedAt' | 'attention'>>;

/** Tools whose prompt is a question to the person, not a permission to run something. */
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ask_user', 'askUserQuestion']);

export const isQuestionTool = (tool: string): boolean => QUESTION_TOOLS.has(tool);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * AskUserQuestion's input (`{ questions: [{ question, header, options: [{ label, description }], multiSelect }] }`)
 * as the tabbed card's questions (#1052), or null when it has none. "(추천)"/"(Recommended)" in a label marks it.
 */
export function askUserQuestionItems(input: unknown): QuestionItem[] | null {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return null;
  const items: QuestionItem[] = [];
  for (const q of qs) {
    const question = str((q as { question?: unknown })?.question);
    if (!question) continue;
    const options: QuestionOption[] = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const raw = typeof o === 'string' ? o.trim() : str(o?.label);
      if (!raw) continue;
      const recommended = /[(（]\s*(추천|recommended)\s*[)）]/i.test(raw);
      const opt: QuestionOption = { label: raw };
      const reason = typeof o === 'string' ? '' : str(o?.description);
      if (reason) opt.reason = reason;
      if (recommended) opt.recommended = true;
      options.push(opt);
    }
    const item: QuestionItem = { question, options, multiSelect: q.multiSelect === true };
    const header = str(q.header);
    if (header) item.header = header;
    items.push(item);
  }
  return items.length ? items : null;
}

const one = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Every open request, newest first. `sessions` (null while unknown) gives each row its provider mark and adds the
 * sessions waiting for a person that have no prompt open and no plan waiting; with a list, prompts of sessions not in
 * it (another project's) are left out. `folder` ('' = all) keeps the plans inside that project folder.
 */
export function sessionRequests(plans: readonly WaitingPlan[], asks: readonly PermissionAsk[], sessions: readonly SessionLike[] | null, folder = ''): SessionRequest[] {
  const byId = new Map((sessions ?? []).map((s) => [s.id, s]));
  const byName = new Map((sessions ?? []).map((s) => [s.name, s]));
  const out: SessionRequest[] = [];
  const mine = folder ? plans.filter((p) => p.path.startsWith(`${folder}/`)) : plans;
  for (const p of mine) {
    out.push({
      key: `plan:${p.path}`,
      kind: 'plan',
      session: p.lead,
      provider: (p.lead && byName.get(p.lead)?.provider) || null,
      text: `‘${one(planTitle(p), 60)}’ 계획을 승인해 주세요`,
      at: p.since,
      target: { plan: p.path },
    });
  }
  for (const a of asks) {
    if (sessions && !byId.has(a.sessionId)) continue;
    const question = QUESTION_TOOLS.has(a.tool);
    out.push({
      key: `ask:${a.requestId}`,
      kind: question ? 'question' : 'permission',
      session: a.session,
      provider: byId.get(a.sessionId)?.provider || null,
      text: question ? (a.description ? one(a.description) : '질문에 답해 주세요') : `${a.tool} 실행을 허용할까요?`,
      at: a.since,
      target: { session: a.sessionId },
    });
  }
  const leads = new Set(mine.map((p) => p.lead).filter(Boolean));
  const asked = new Set(asks.map((a) => a.sessionId));
  for (const s of sessions ?? []) {
    if (s.state !== 'waiting' || asked.has(s.id) || s.pending?.length || leads.has(s.name)) continue;
    out.push({
      key: `waiting:${s.id}`,
      kind: 'waiting',
      session: s.name,
      provider: s.provider || null,
      text: s.attention?.reason ? one(s.attention.reason) : '답을 기다려요',
      at: s.stateSince ?? s.updatedAt ?? null,
      target: { session: s.id },
    });
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || (a.key < b.key ? -1 : 1));
}
