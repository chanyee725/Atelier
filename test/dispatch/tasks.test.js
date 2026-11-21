import { test } from "node:test";
import assert from "node:assert/strict";
import { enterStage } from "../../server/dispatch/tasks.js";

const M = 60_000;

test("enterStage records stage and time only", () => {
  const t = { stage: "plan", createdAt: 0, stageAt: 0, stages: [{ stage: "plan", at: 0 }] };
  enterStage(t, "impl", 5 * M);
  enterStage(t, "test", 20 * M);
  assert.equal(t.stage, "test");
  assert.equal(t.stageAt, 20 * M);
  assert.deepEqual(t.stages, [{ stage: "plan", at: 0 }, { stage: "impl", at: 5 * M }, { stage: "test", at: 20 * M }]);
  assert.deepEqual(Object.keys(t.stages[1]).sort(), ["at", "stage"]);
});

test("enterStage seeds history for tasks saved before it existed", () => {
  const t = { stage: "impl", createdAt: 0, stageAt: 3 * M };
  enterStage(t, "review", 10 * M);
  assert.deepEqual(t.stages, [{ stage: "impl", at: 3 * M }, { stage: "review", at: 10 * M }]);
});

test("history is capped", () => {
  const t = { stage: "plan", stageAt: 0, stages: [] };
  for (let i = 0; i < 100; i++) enterStage(t, i % 2 ? "impl" : "review", i);
  assert.equal(t.stages.length, 40);
});

import { defaultStageEta, stageMedianMinutes } from "../../server/dispatch/tasks.js";

const done = (...spans) => {
  // spans: [stage, minutes] pairs, then done
  let at = 0;
  const stages = spans.map(([stage, m]) => { const h = { stage, at }; at += m * M; return h; });
  stages.push({ stage: "done", at });
  return { stage: "done", stages };
};

test("stageMedianMinutes: median of the stage across finished tasks, revisits summed", () => {
  const tasks = [
    done(["plan", 2], ["impl", 10], ["review", 4]),
    done(["plan", 1], ["impl", 30], ["review", 2], ["impl", 10]),
    done(["plan", 3], ["impl", 20]),
    { stage: "impl", stages: [{ stage: "impl", at: 0 }] }, // open: ignored
  ];
  assert.equal(stageMedianMinutes(tasks, "impl"), 20);
  assert.equal(stageMedianMinutes(tasks, "review"), 3);
  assert.equal(stageMedianMinutes(tasks, "test"), null);
  assert.equal(stageMedianMinutes([], "impl"), null);
});

test("defaultStageEta: fills from history, keeps an explicit eta without history, clears a stale estimate", () => {
  const hist = [done(["review", 12])];
  const t = { stage: "review", etaAt: null };
  defaultStageEta(t, hist, 100 * M);
  assert.equal(t.etaAt, 112 * M);
  assert.equal(t.etaEstimated, true);
  const explicit = { stage: "test", etaAt: 500 * M, etaEstimated: false };
  defaultStageEta(explicit, hist, 100 * M);
  assert.equal(explicit.etaAt, 500 * M);
  t.stage = "test";
  defaultStageEta(t, hist, 120 * M);
  assert.equal(t.etaAt, null);
  assert.equal(t.etaEstimated, false);
  const blocked = { stage: "blocked", etaAt: null };
  defaultStageEta(blocked, hist, 0);
  assert.equal(blocked.etaAt, null);
});

import { Hub } from "../../server/dispatch/hub.js";

test("setTask: a stage entered without eta_minutes gets the stage median; an explicit eta wins", async () => {
  const lead = { id: "lead", name: "Faye", status: "idle", parent: null };
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(),
    store: { data: { sessions: { lead }, settings: {}, tasks: { old: { id: "old", lead: "lead", title: "old", ...done(["plan", 4], ["impl", 15], ["review", 6]) } } }, save() {} },
  });
  hub.emit = () => true;
  hub.taskStuckOf = () => null;
  const t0 = Date.now();
  const t = await hub.setTask("lead", { title: "new" });
  assert.equal(t.etaEstimated, true);
  assert.ok(Math.abs(t.etaAt - (t0 + 4 * M)) < 5_000);
  await hub.setTask("lead", { id: t.id, stage: "review" });
  assert.ok(Math.abs(t.etaAt - (t0 + 6 * M)) < 5_000);
  await hub.setTask("lead", { id: t.id, stage: "impl", eta_minutes: 40 });
  assert.equal(t.etaEstimated, false);
  assert.ok(Math.abs(t.etaAt - (t0 + 40 * M)) < 5_000);
  await hub.setTask("lead", { id: t.id, stage: "test" }); // no history for test: the explicit eta stays
  assert.ok(Math.abs(t.etaAt - (t0 + 40 * M)) < 5_000);
});
