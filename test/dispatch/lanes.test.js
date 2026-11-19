// Work lanes (#768): quickfix skips the plan gate and the reviewer; past runs give an ETA hint. No CLI starts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { resolveProfile } from "../../server/dispatch/mode-profiles.js";
import { etaHint, lanePlanArgs, laneItems, recordRunTime } from "../../server/dispatch/lanes.js";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const MODELS = staticModels();

async function makeHub() {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-768-lanes-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  hub.isConnected = p => p === "claude";
  hub.start = () => {};
  hub.resolveProfile = async (mode, role, o = {}) => resolveProfile({ mode, role, models: MODELS, isConnected: hub.isConnected, perm: o.perm });
  return hub;
}

test("laneItems: quickfix refuses reviewer and tester, defaults to the quickfix mode; unknown lane is a 400", () => {
  assert.deepEqual(laneItems([{ role: "impl" }], undefined), [{ role: "impl" }]);
  assert.deepEqual(laneItems([{ role: "impl" }], "quickfix"), [{ role: "impl", lane: "quickfix", mode: "quickfix" }]);
  assert.deepEqual(laneItems([{ role: "impl", mode: "impl" }], "quickfix"), [{ role: "impl", mode: "impl", lane: "quickfix" }]);
  assert.deepEqual(laneItems([{ role: "review" }], "normal"), [{ role: "review", lane: "normal" }]);
  assert.throws(() => laneItems([{ role: "impl" }, { role: "review" }], "quickfix"), e => e.status === 400);
  assert.throws(() => laneItems([{ role: "impl" }], "fast"), e => e.status === 400);
});

test("laneItems: quickfix is exactly one impl, design or docs session", () => {
  for (const role of ["impl", "design", "docs"]) assert.equal(laneItems([{ role }], "quickfix")[0].lane, "quickfix");
  assert.equal(laneItems([{ role: "impl", n: 1 }], "quickfix").length, 1);
  for (const role of ["lead", "review", "test"]) assert.throws(() => laneItems([{ role }], "quickfix"), e => e.status === 400, role);
  assert.throws(() => laneItems([{ role: "impl", n: 2 }], "quickfix"), e => e.status === 400 && /세션 하나/.test(e.message));
  assert.throws(() => laneItems([{ role: "impl" }, { role: "docs" }], "quickfix"), e => e.status === 400 && /2개/.test(e.message));
  assert.throws(() => lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "impl", n: 2 }], lane: "quickfix" }), e => e.status === 400);
  assert.throws(() => lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "lead" }], lane: "quickfix" }), e => e.status === 400);
});

test("lanePlanArgs: quickfix is one step that autostarts in the quickfix mode; lane never reaches the plan", () => {
  assert.deepEqual(lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "impl" }], lane: "normal" }), { goal: "g", steps: [{ title: "a", role: "impl" }] });
  assert.deepEqual(lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "impl" }], lane: "quickfix" }),
    { goal: "g", autostart: true, steps: [{ mode: "quickfix", title: "a", role: "impl" }] });
  assert.throws(() => lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "impl" }, { title: "b", role: "impl" }], lane: "quickfix" }), /단계 하나/);
  assert.throws(() => lanePlanArgs({ goal: "g", steps: [{ title: "a", role: "review" }], lane: "quickfix" }), /세션 하나/);
});

test("create: a quickfix passes a waiting plan gate and runs Opus 5.5; normal is still gated", async () => {
  const hub = await makeHub();
  const [lead] = await hub.create({ items: [{ role: "lead" }], commonPrompt: "hi", worktree: false });
  hub.createGate = () => "계획 승인 전이에요";
  await assert.rejects(hub.create({ items: [{ role: "impl" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "normal" }), /계획 승인 전/);
  const [q] = await hub.create({ items: [{ role: "impl" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "quickfix" });
  assert.equal(q.lane, "quickfix");
  assert.equal(q.mode, "quickfix");
  assert.equal(q.model, "claude-opus-5-5");
  await assert.rejects(hub.create({ items: [{ role: "review" }], commonPrompt: "x", worktree: false, parent: lead.id, lane: "quickfix" }), e => e.status === 400);
});

test("run times: merged tasks feed a per-lane median; capped; none yet is null", async () => {
  assert.equal(etaHint([], "quickfix"), null);
  let list = [];
  for (const m of [6, 9, 7]) list = recordRunTime(list, { lane: "quickfix", minutes: m });
  list = recordRunTime(list, { lane: "normal", minutes: 40 });
  assert.deepEqual(etaHint(list, "quickfix"), { lane: "quickfix", runs: 3, median: 7, max: 9 });
  assert.deepEqual(etaHint(list), { lane: "normal", runs: 1, median: 40, max: 40 });
  for (let i = 0; i < 100; i++) list = recordRunTime(list, { lane: "normal", minutes: 1 });
  assert.equal(list.length, 60);

  const hub = await makeHub();
  const [lead] = await hub.create({ items: [{ role: "lead" }], commonPrompt: "hi", worktree: false });
  const t = await hub.setTask(lead.id, { title: "토스트 위치", lane: "quickfix" });
  assert.equal(t.lane, "quickfix");
  t.mergeCheck = null;
  // Closed without a commit (abandoned): not a run.
  await hub.setTask(lead.id, { id: t.id, stage: "done" });
  assert.equal(hub.etaHint("quickfix"), null);
});

test("agent prompts call the tool Atelier, carry the lanes and the lead merge, and drop emphasis", async () => {
  const { ROLES: roles, SPAWN_PROMPT, CHILD_PROMPT, DRAWING_WRITE_NOTE } = await import("../../server/dispatch/roles.js");
  const all = [SPAWN_PROMPT, CHILD_PROMPT, DRAWING_WRITE_NOTE, ...roles.map(r => r.prompt)].join("\n");
  assert.doesNotMatch(all, /Dispatch|Drawing|IMPORTANT|NEVER|반드시/);
  assert.match(SPAWN_PROMPT, /아틀리에\(Atelier\)/);
  for (const lane of ["quickfix", "normal", "risky"]) assert.match(SPAWN_PROMPT, new RegExp(`- ${lane}:`));
  assert.match(SPAWN_PROMPT, /gh pr merge <번호> --merge/);
  assert.match(SPAWN_PROMPT, /git merge --ff-only origin\/develop/);
  assert.match(SPAWN_PROMPT, /normal·risky에서만 modern-web-guidance/);
  assert.doesNotMatch(SPAWN_PROMPT, /20분/);
  // Areas (#782): no fixed list, taken from the project, reused; plans at <영역>/<기능>/계획.dpx.json.
  assert.match(SPAWN_PROMPT, /\[영역\]/);
  assert.match(SPAWN_PROMPT, /<영역>\/<기능>\/계획\.dpx\.json/);
  assert.match(SPAWN_PROMPT, /고정 목록이 아니다/);
  assert.match(SPAWN_PROMPT, /이미 있는 영역을 다시 쓴다/);
  assert.doesNotMatch(all, /pipelines/);
  for (const p of [SPAWN_PROMPT, CHILD_PROMPT]) {
    assert.match(p, /전체 e2e는 돌리지 않는다/);
    assert.match(p, /실제 실행 출력/);
    assert.match(p, /\[개인정보\]/);
  }
});
