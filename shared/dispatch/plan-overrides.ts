// Per-step overrides the start confirm passes to POST /api/pipeline/start (#972): the person's last word on model,
// effort, permission and head count for one run, without editing the plan file (so the revision they approve is the
// one on disk). Pure, shared by the server (validates and applies) and the web (estimates the sessions it will start).
import { MAX_PLAN_N, MAX_PLAN_NAME, PLAN_PERMS, type Plan, type PlanPerm } from './plan.ts';

export interface StepOverride {
  model?: string;
  effort?: string;
  perm?: PlanPerm;
  /** Sessions the step starts (e.g. 2 reviewers for a risky step). */
  n?: number;
}
export type StepOverrides = Record<string, StepOverride>;

const OVERRIDE_KEYS = ['model', 'effort', 'perm', 'n'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The plan with the overrides laid over its steps, or the first problem in words (a bad shape, an unknown step). */
export function applyStepOverrides(plan: Plan, overrides: unknown): { plan: Plan } | { error: string } {
  if (overrides === undefined || overrides === null) return { plan };
  if (!isObj(overrides)) return { error: 'overrides must be an object keyed by step id' };
  const ids = new Set(plan.steps.map((s) => s.id));
  const clean: StepOverrides = {};
  for (const [id, raw] of Object.entries(overrides)) {
    if (!ids.has(id)) return { error: `단계 ${id.slice(0, 40)}은 계획에 없어요` };
    if (!isObj(raw)) return { error: `overrides.${id} must be an object` };
    const o: StepOverride = {};
    for (const k of Object.keys(raw)) if (!(OVERRIDE_KEYS as readonly string[]).includes(k)) return { error: `overrides.${id}.${k} is not allowed` };
    for (const k of ['model', 'effort'] as const) {
      const v = raw[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length < 1 || v.length > MAX_PLAN_NAME) return { error: `overrides.${id}.${k} must be a string of 1-${MAX_PLAN_NAME} characters` };
      o[k] = v;
    }
    if (raw.perm !== undefined) {
      if (!(PLAN_PERMS as readonly unknown[]).includes(raw.perm)) return { error: `overrides.${id}.perm must be one of ${PLAN_PERMS.join(', ')}` };
      o.perm = raw.perm as PlanPerm;
    }
    if (raw.n !== undefined) {
      if (!Number.isInteger(raw.n) || (raw.n as number) < 1 || (raw.n as number) > MAX_PLAN_N) return { error: `overrides.${id}.n must be an integer 1-${MAX_PLAN_N}` };
      o.n = raw.n as number;
    }
    clean[id] = o;
  }
  return { plan: { ...plan, steps: plan.steps.map((s) => (clean[s.id] ? { ...s, ...clean[s.id] } : s)) } };
}
