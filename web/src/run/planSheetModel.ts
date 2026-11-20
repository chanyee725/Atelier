// The plan sheet beside the 플랜 tab's diagram (#889, Plan.dc.html): the plan's title, its opening paragraph and one
// row per step (number, title, what it does, role, who or which model). Pure: node --test loads it directly.
import type { Plan } from '../../../shared/dispatch/plan.ts';
import { roleLabel, type RunStep } from './overlayModel.ts';

export interface SheetStep {
  id: string;
  n: number;
  title: string;
  /** The task's first non-empty line, shortened; null when the step has no task. */
  task: string | null;
  /** Korean role name, or null when neither the step nor the plan defaults name one. */
  role: string | null;
  /** The agents on it once it runs ("Yuki, Gem"), else the model it asks for, else null. */
  who: string | null;
}

export interface PlanSheet {
  /** First paragraph of the document (not a heading), shortened; null when there is none. */
  summary: string | null;
  steps: SheetStep[];
}

type Node = { type?: string; text?: string; content?: Node[] };

const textOf = (n: Node): string => (typeof n.text === 'string' ? n.text : (n.content ?? []).map(textOf).join(''));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Longest summary and task line, in characters; the rest is in the 문서 tab. */
export const SUMMARY_MAX = 240;
export const TASK_MAX = 120;

export function firstParagraph(document: unknown): string | null {
  const d = document as Node | null;
  if (!d || d.type !== 'doc') return null;
  for (const n of d.content ?? []) {
    if (n.type !== 'paragraph') continue;
    const t = textOf(n).replace(/\s+/g, ' ').trim();
    if (t) return clip(t, SUMMARY_MAX);
  }
  return null;
}

export function planSheet(plan: Plan, document: unknown, steps: readonly RunStep[] = [], labels: ReadonlyMap<string, string> = new Map()): PlanSheet {
  const run = new Map(steps.map((s) => [s.id, s]));
  return {
    summary: firstParagraph(document),
    steps: plan.steps.map((s, i) => {
      const r = run.get(s.id);
      const task = (s.task ?? plan.defaults?.task ?? '').split('\n').map((l) => l.trim()).find(Boolean);
      const role = s.role ?? plan.defaults?.role;
      const agents = (r?.agents ?? []).map((a) => a.name);
      const model = s.model ?? plan.defaults?.model;
      return {
        id: s.id,
        n: i + 1,
        title: r?.title ?? labels.get(s.node) ?? s.node,
        task: task ? clip(task, TASK_MAX) : null,
        role: role ? roleLabel(role) : null,
        who: agents.length ? agents.join(', ') : (model ?? null),
      };
    }),
  };
}
