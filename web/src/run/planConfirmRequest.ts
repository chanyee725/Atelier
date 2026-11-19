// 시작하기 from the 알림함 (E579, #786): the bell opens the plan document and asks its PlanStrip to open the same
// confirm dialog as the strip's own 시작하기 (openPlanConfirm). One request at a time; the strip of that file takes it.
/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
const stem = (p: string) => p.replace(/\.dpx(\.json)?$/i, '');
export const samePlan = (a: string, b: string) => stem(a) === stem(b);

let wanted: string | null = null;
const subs = new Set<() => void>();

export function requestPlanConfirm(path: string) {
  wanted = path;
  subs.forEach((f) => f());
}

/** True once for the path that was asked for; the request is then used up. */
export function takePlanConfirm(path: string) {
  if (wanted === null || !samePlan(wanted, path)) return false;
  wanted = null;
  return true;
}

export function onPlanConfirmRequest(fn: () => void) {
  subs.add(fn);
  return () => void subs.delete(fn);
}
