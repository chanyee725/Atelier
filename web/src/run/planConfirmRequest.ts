// 시작하기 from the dashboard (E579, #786): a 세션 요청 row opens the plan document and asks its PlanStrip to open the same
// confirm dialog as the strip's own 시작하기 (openPlanConfirm). One request at a time; the strip of that file takes it.
/** `a/b`, `a/b.dpx` and `a/b.dpx.json` are the same file. */
const stem = (p: string) => p.replace(/\.dpx(\.json)?$/i, '');
export const samePlan = (a: string, b: string) => stem(a) === stem(b);

/** A request not taken within this long is dropped, so it never opens the confirm later on its own (#803). */
export const REQUEST_MS = 15_000;

let wanted: { path: string; at: number } | null = null;
const subs = new Set<() => void>();

export function requestPlanConfirm(path: string, now = Date.now()) {
  wanted = { path, at: now };
  subs.forEach((f) => f());
}

/** True once for the path that was asked for, while it is fresh; the request is then used up. */
export function takePlanConfirm(path: string, now = Date.now()) {
  if (wanted && now - wanted.at > REQUEST_MS) wanted = null;
  if (wanted === null || !samePlan(wanted.path, path)) return false;
  wanted = null;
  return true;
}

export function onPlanConfirmRequest(fn: () => void) {
  subs.add(fn);
  return () => void subs.delete(fn);
}
