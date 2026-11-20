// What the plan diagram's 시작하기 (#972) needs to know about the file's plan gate. PlanStrip owns the status and the
// confirm dialog; it publishes here, and the diagram block's head button reads it and asks for the same confirm
// (requestPlanConfirm). Keyed by file path so a leftover value never shows on another file.
import { useSyncExternalStore } from 'react';
import { requestPlanConfirm, samePlan } from './planConfirmRequest.ts';

export type PlanGate = {
  path: string;
  /** The plan's diagram block id: only that block gets the button. */
  block: string;
  /** Every reason 시작하기 cannot run now, in words; empty when it can. */
  blockers: string[];
  busy: boolean;
  /** The last start problem (save refused, request failed). */
  error: string | null;
};

let gate: PlanGate | null = null;
const subs = new Set<() => void>();

const same = (a: PlanGate | null, b: PlanGate | null) =>
  a === b || (!!a && !!b && a.path === b.path && a.block === b.block && a.busy === b.busy && a.error === b.error && a.blockers.join('\n') === b.blockers.join('\n'));

export const getPlanGate = () => gate;

export function setPlanGate(next: PlanGate | null) {
  if (same(gate, next)) return;
  gate = next;
  subs.forEach((f) => f());
}

/** Clear only our own value, so a strip unmounting after another file's strip mounted does not wipe it. */
export function clearPlanGate(path: string) {
  if (gate && samePlan(gate.path, path)) setPlanGate(null);
}

/** The gate of `path`'s plan when `blockId` is its plan diagram, else null (no button). */
export function gateFor(g: PlanGate | null, path: string, blockId: string): PlanGate | null {
  return g && samePlan(g.path, path) && g.block === blockId ? g : null;
}

export function usePlanGate(path: string, blockId: string): PlanGate | null {
  const g = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    getPlanGate,
  );
  return gateFor(g, path, blockId);
}

export function askPlanStart(path: string) {
  requestPlanConfirm(path);
}
