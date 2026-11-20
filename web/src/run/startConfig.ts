// The recommended team for a plan's 시작하기 confirm (#972): one row per step with role, model, effort, permission,
// head count and a rough time, prefilled from the plan and the house rules (implementers on Opus, reviewers on
// Sonnet, two reviewers on a risky step), fitted to the providers that are connected. The person changes rows; what
// differs from the plan file goes to POST /api/pipeline/start as `overrides`. Pure, so tests need no browser.
import type { Plan } from '../../../shared/dispatch/plan.ts';
import { PLAN_PERMS, resolvedStep } from '../../../shared/dispatch/plan.ts';
import type { StepOverrides } from '../../../shared/dispatch/plan-overrides.ts';
import { fitPerm } from '../dispatch/lib/create.ts';
import type { ModelCatalog } from './stepModels.ts';

export const IMPL_MODEL = 'claude-opus-5-5';
export const REVIEW_MODEL = 'claude-sonnet-5-5';

export type StartRow = {
  id: string;
  /** The diagram label or the step id. */
  title: string;
  role: string;
  roleName: string;
  model: string;
  /** '' = the model's own default. */
  effort: string;
  perm: string;
  n: number;
  /** Rough minutes one session of this step takes. */
  minutes: number;
  risky: boolean;
};

/** A step that touches sign-in, money, secrets, data shape or deletion: its review gets a second pair of eyes. */
const RISKY = /인증|로그인|권한|결제|삭제|데이터|마이그|보안|비밀|토큰|auth|login|permission|payment|delete|migrat|secret|token|schema|drop\b/i;
export const isRiskyText = (...parts: (string | undefined)[]) => RISKY.test(parts.filter(Boolean).join(' '));

/** Rough minutes per role, at one session; the confirm labels it as an estimate. */
const ROLE_MINUTES: Record<string, number> = { impl: 15, review: 6, test: 8, design: 8, docs: 6, lead: 5 };
export const stepMinutes = (role: string) => ROLE_MINUTES[role] ?? 10;

/** The model a role is recommended to run, else the first model of a connected provider. */
export function recommendModel(role: string, roleModel: string | null, cat: ModelCatalog): string {
  const want = role === 'impl' ? IMPL_MODEL : role === 'review' ? REVIEW_MODEL : roleModel;
  const usable = (id: string | null | undefined) => {
    const m = cat.models.find((x) => x.id === id);
    return m && cat.providers[m.provider]?.connected ? m.id : null;
  };
  return usable(want) ?? usable(roleModel) ?? cat.models.find((m) => cat.providers[m.provider]?.connected)?.id ?? want ?? '';
}

const permOptions = (provider: string | undefined, cat: ModelCatalog) => cat.perms.filter((p) => (PLAN_PERMS as readonly string[]).includes(p)).filter((p) => fitPerm(p, provider, cat.perms) === p);

const LOOSENESS: Record<string, number> = { plan: 0, manual: 1, acceptEdits: 2, auto: 3 };

/** Keep a perm the model's provider can run; else the closest one that is not looser (a session never runs looser than chosen). */
export function fitRowPerm(perm: string, model: string, cat: ModelCatalog): string {
  const ok = permOptions(cat.models.find((m) => m.id === model)?.provider, cat);
  if (ok.includes(perm)) return perm;
  const rank = (p: string) => LOOSENESS[p] ?? 0;
  const stricter = ok.filter((p) => rank(p) <= rank(perm)).sort((x, y) => rank(y) - rank(x))[0];
  return stricter ?? [...ok].sort((x, y) => rank(x) - rank(y))[0] ?? perm;
}
export const permChoices = (model: string, cat: ModelCatalog) => permOptions(cat.models.find((m) => m.id === model)?.provider, cat);

/** An effort the model does not offer falls back to its default. */
export const fitEffort = (effort: string, model: string, cat: ModelCatalog) => {
  const m = cat.models.find((x) => x.id === model);
  return !effort || !m || m.efforts.includes(effort) ? effort : '';
};

export function startRows(plan: Plan, cat: ModelCatalog, labels: ReadonlyMap<string, string> = new Map()): StartRow[] {
  const textOf = (id: string) => {
    const s = plan.steps.find((x) => x.id === id);
    return s ? [s.id, s.task, labels.get(s.node)].filter(Boolean).join(' ') : '';
  };
  return plan.steps.map((raw) => {
    const s = resolvedStep(plan, raw);
    const role = s.role ? cat.roles.find((r) => r.id === s.role) : undefined;
    const roleId = s.role ?? '';
    // A review step is risky when a step it follows is (or, with no explicit order, when it is itself).
    const risky = isRiskyText(textOf(s.id), ...(s.after ?? []).map(textOf));
    // The plan's own choice stays; the house rules fill what it left open.
    const model = s.model && cat.models.some((m) => m.id === s.model && cat.providers[m.provider]?.connected) ? s.model : recommendModel(roleId, role?.model ?? null, cat);
    const wantPerm = s.perm ?? role?.perm ?? 'acceptEdits';
    const n = s.n ?? (roleId === 'review' && risky ? 2 : 1);
    return {
      id: s.id,
      title: labels.get(raw.node) ?? s.id,
      role: roleId,
      roleName: role?.name ?? roleId,
      model,
      effort: fitEffort(s.effort ?? '', model, cat),
      perm: fitRowPerm(wantPerm, model, cat),
      n,
      minutes: stepMinutes(roleId),
      risky,
    };
  });
}

/** What the person's rows change against the plan file; empty when the rows are the plan as written. */
export function toOverrides(plan: Plan, rows: readonly StartRow[], cat: ModelCatalog): StepOverrides {
  const out: StepOverrides = {};
  for (const row of rows) {
    const raw = plan.steps.find((s) => s.id === row.id);
    if (!raw) continue;
    const s = resolvedStep(plan, raw);
    const role = s.role ? cat.roles.find((r) => r.id === s.role) : undefined;
    const o: StepOverrides[string] = {};
    if (row.model && row.model !== (s.model || role?.model)) o.model = row.model;
    if (row.effort !== (s.effort ?? '') && row.effort) o.effort = row.effort;
    if (row.perm && row.perm !== (s.perm ?? role?.perm)) o.perm = row.perm as (typeof PLAN_PERMS)[number];
    if (row.n !== (s.n ?? 1)) o.n = row.n;
    if (Object.keys(o).length) out[row.id] = o;
  }
  return out;
}

export const sessionCount = (rows: readonly StartRow[]) => rows.reduce((a, r) => a + r.n, 0);

/** How many of the sessions run on Claude, whose 5-hour limit the bar speaks for. */
export const claudeSessions = (rows: readonly StartRow[], cat: Pick<ModelCatalog, 'models'>) =>
  rows.reduce((a, r) => a + ((cat.models.find((m) => m.id === r.model)?.provider ?? 'claude') === 'claude' ? r.n : 0), 0);
