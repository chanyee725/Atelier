// Per-step model choice in the plan strip (#587): which model each step runs, and the PATCH /api/file/plan edit that
// changes it. Pure parts plus one request helper, outside React so tests drive them without a browser.
import type { FileSession } from '../fileSession';
import { fitPerm } from '../dispatch/lib/create.ts';
import type { Plan } from '../../../shared/dispatch/plan.ts';
import { resolvedStep } from '../../../shared/dispatch/plan.ts';
import type { Model, ProviderStatus, Role } from '../../../shared/dispatch/types.ts';

/** What the picker needs from GET /api/state. */
export type ModelCatalog = { models: Model[]; roles: Role[]; perms: string[]; providers: Record<string, ProviderStatus> };

export type StepModelRow = {
  id: string;
  role: string | null;
  roleName: string | null;
  /** The step's own model (or plan default); '' when it uses its role's. */
  model: string;
  /** The model it will run: its own, else its role's. */
  effective: string | null;
};

/** One row per step: its own model if set (step or plan defaults), else '' and the role's model as the effective one. */
export function stepModelRows(plan: Plan, cat: Pick<ModelCatalog, 'roles'>): StepModelRow[] {
  return plan.steps.map((s) => {
    const r = resolvedStep(plan, s);
    const role = r.role ? (cat.roles.find((x) => x.id === r.role) ?? null) : null;
    return { id: s.id, role: r.role ?? null, roleName: role?.name ?? r.role ?? null, model: r.model ?? '', effective: r.model || role?.model || null };
  });
}

/**
 * The `set` op for a new model ('' = back to the role's). An effort the new model does not offer is dropped, and a
 * mode its provider cannot run becomes the provider's first allowed one (the server would refuse the start otherwise).
 */
export function setModelOp(plan: Plan, stepId: string, model: string, cat: ModelCatalog) {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const r = resolvedStep(plan, step);
  const role = r.role ? cat.roles.find((x) => x.id === r.role) : undefined;
  const target = cat.models.find((m) => m.id === (model || role?.model));
  const patch: Record<string, string | null> = { model: model || null };
  if (r.effort && target && !target.efforts.includes(r.effort)) patch.effort = null;
  const perm = r.perm ?? role?.perm;
  if (perm && target) {
    const fitted = fitPerm(perm, target.provider, cat.perms);
    if (fitted !== perm) patch.perm = fitted;
  }
  return { op: 'set' as const, id: stepId, step: patch };
}

/** Shown when unsaved edits could not be saved first, so the server's plan is not the one on screen. */
export const SAVE_FIRST_MODEL = '저장이 안 돼서 모델을 바꾸지 못했어요. 잠시 뒤 다시 해 보세요.';

/**
 * Save first, then PATCH the plan against the saved revision. The server announces the change, so the open tab
 * reloads the new plan. Returns an error text, or null when it worked.
 */
export async function patchStepModel(
  session: Pick<FileSession, 'flush' | 'isDirty' | 'getState'>,
  path: string,
  stepId: string,
  model: string,
  cat: ModelCatalog,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  await session.flush();
  const st = session.getState();
  if (session.isDirty() || st.conflict || !st.file) return SAVE_FIRST_MODEL;
  const plan = st.file.plan;
  if (!plan) return '계획이 없어요.';
  const op = setModelOp(plan, stepId, model, cat);
  if (!op) return '그 단계가 없어요.';
  const res = await fetchFn(`/api/file/plan?path=${encodeURIComponent(path)}`, {
    method: 'PATCH',
    headers: { 'x-drawing': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ revision: st.file.revision, ops: [op] }),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 409) return '계획이 바뀌었어요. 다시 골라 주세요.';
  return body.error ?? `모델을 바꾸지 못했어요 (HTTP ${res.status})`;
}
