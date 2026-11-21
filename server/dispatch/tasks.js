/**
 * Stage history of a board task: `stages` is a list of { stage, at } — metadata only, no
 * transcript text. The UI (TaskBoard) turns it into time per stage (mini bars) and "테스트 단계 12분째".
 */
const MAX_STAGES = 40;

/** Moves `t` to `stage` at `at`, recording the entry. Older tasks without history get a seed entry. */
export function enterStage(t, stage, at = Date.now()) {
  if (!Array.isArray(t.stages)) t.stages = t.stage ? [{ stage: t.stage, at: t.stageAt ?? t.createdAt ?? at }] : [];
  t.stage = stage;
  t.stageAt = at;
  t.stages.push({ stage, at });
  if (t.stages.length > MAX_STAGES) t.stages.splice(0, t.stages.length - MAX_STAGES);
  return t;
}

/** Stages a task works through; the ETA default and the 3/5 step count use these (#1028). */
export const WORK_STAGES = ["plan", "impl", "review", "test", "merge"];

/**
 * Median minutes finished tasks spent in `stage` (#1028), from their `stages` history: a stage visited twice counts
 * as one sum per task. Only tasks closed with a confirmed merge count, and a stage passed in under a minute (moved
 * on in the same turn) is left out. Null without any such task.
 */
export function stageMedianMinutes(tasks, stage) {
  const mins = [];
  for (const t of tasks) {
    if (t?.stage !== "done" || t.mergeCheck?.ok !== true || !Array.isArray(t.stages)) continue;
    let ms = 0, seen = false;
    t.stages.forEach((h, i) => {
      const next = t.stages[i + 1];
      if (h.stage !== stage || !next) return;
      seen = true;
      ms += Math.max(0, next.at - h.at);
    });
    if (seen && ms >= 60_000) mins.push(ms / 60_000);
  }
  if (!mins.length) return null;
  mins.sort((a, b) => a - b);
  const mid = mins.length >> 1;
  return mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
}

/**
 * The ETA a task gets when it enters `t.stage` without an `eta_minutes` (#1028): now plus the stage's median from
 * `tasks`, marked `etaEstimated`. Without history an earlier explicit ETA stays and a stale estimate clears.
 */
export function defaultStageEta(t, tasks, now = Date.now()) {
  if (!WORK_STAGES.includes(t.stage)) return t;
  const m = stageMedianMinutes(tasks, t.stage);
  if (m != null) {
    t.etaAt = now + Math.max(1, Math.round(m)) * 60_000;
    t.etaSetAt = now;
    t.etaEstimated = true;
  } else if (t.etaEstimated) {
    t.etaAt = null;
    t.etaSetAt = null;
    t.etaEstimated = false;
  }
  return t;
}
