// Team creation uses the harness profile of the mode (#748): create_sessions, plan steps and run records.
// No CLI starts: hub.start is replaced, so nothing is spawned.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { Store } from "../../server/dispatch/dispatch-store.js";
import { SharedLimits } from "../../server/dispatch/limits.js";
import { staticModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { MODE_IDS, resolveProfile } from "../../server/dispatch/mode-profiles.js";
import { pickSession } from "../../server/runs/record.js";
import { PLAN_MODES, planProblem, resolvedStep } from "../../shared/dispatch/plan.ts";
import { writePlanProblem } from "../../shared/dispatch/plan-write.ts";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const MODELS = [...staticModels(), { id: "gpt-a", label: "GPT A", provider: "openai", efforts: ["low", "high"], contextWindow: 272000 }];

async function makeHub(connected, stored = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "drawing-748-apply-"));
  dirs.push(root);
  const store = new Store(root);
  await store.load();
  const hub = new Hub({ root, store, models: MODELS, roles: ROLES, port: 0, limits: new SharedLimits(path.join(root, "limits.json")) });
  hub.isConnected = p => connected.includes(p);
  hub.refreshCodex = async () => {};
  hub.start = () => {};
  hub.resolveProfile = async (mode, role, o = {}) => resolveProfile({ mode, role, stored, models: MODELS, isConnected: hub.isConnected, perm: o.perm });
  return { root, store, hub };
}

const make = (hub, items, extra = {}) => hub.create({ items, commonPrompt: "hi", worktree: false, ...extra });

test("a mode picks the profile's model, effort and perm; no mode keeps the role default", async () => {
  const { hub } = await makeHub(["claude", "openai"]);
  const [plain] = await make(hub, [{ role: "docs" }]);
  assert.equal(plain.model, "claude-haiku-5-5");
  assert.equal(plain.mode, undefined);
  const [research] = await make(hub, [{ role: "impl" }], { mode: "research" });
  assert.equal(research.provider, "openai");
  assert.equal(research.model, "gpt-a");
  assert.equal(research.mode, "research");
  const [quick] = await make(hub, [{ role: "impl", mode: "quickfix" }]);
  assert.equal(quick.model, "claude-opus-5-5");
  assert.equal(quick.effort, null);
  // Review cross-checks the implementer (Opus in impl mode).
  const [rev] = await make(hub, [{ role: "review", mode: "impl" }]);
  assert.equal(rev.model, "gpt-a");
});

test("a plan step's own model, effort and perm win over the mode's profile", async () => {
  const { hub } = await makeHub(["claude", "openai"]);
  const [s] = await make(hub, [{ role: "impl", mode: "research", model: "claude-opus-5-5", perm: "plan" }]);
  assert.equal(s.model, "claude-opus-5-5");
  assert.equal(s.perm, "plan");
  assert.equal(s.mode, "research");
  const [e] = await make(hub, [{ role: "impl", mode: "quickfix", effort: "high" }]);
  assert.equal(e.model, "claude-opus-5-5");
  assert.equal(e.effort, "high");
  // An item perm Codex cannot run skips Codex in the profile and falls back, with a note, instead of a 400.
  const [ae] = await make(hub, [{ role: "impl", mode: "research", perm: "acceptEdits" }]);
  assert.deepEqual([ae.provider, ae.model, ae.perm], ["claude", "claude-opus-5-5", "acceptEdits"]);
  assert.match(ae.profileNote, /OpenAI Codex는 acceptEdits 모드를 쓸 수 없음/);
  // An explicit Codex model with a perm it cannot run is still refused, never run looser.
  await assert.rejects(make(hub, [{ role: "impl", model: "gpt-a", perm: "acceptEdits" }]), e2 => e2.status === 400);
});

test("an unconnected provider falls back with a note on the session, in its transcript and in the run record", async () => {
  const { hub } = await makeHub(["claude"]);
  const [s] = await make(hub, [{ role: "impl" }], { mode: "research" });
  assert.equal(s.model, "claude-opus-5-5");
  assert.match(s.profileNote, /OpenAI Codex 연결 안 됨/);
  assert.ok(hub.transcript(s.id).some(m => m.kind === "system" && /^모드 프로필: /.test(m.text)));
  const rec = pickSession({ sid: s.id, name: s.name, provider: s.provider, model: s.model, mode: s.mode, profileNote: s.profileNote, prompt: "secret" });
  assert.equal(rec.mode, "research");
  assert.equal(rec.profileNote, s.profileNote);
  assert.equal("prompt" in rec, false);
  assert.equal(pickSession({ profileNote: "x".repeat(250) }).profileNote.length, 200);
  assert.equal(pickSession({ profileNote: "a\nb\u0007c" }).profileNote, "a b c");
  assert.equal(pickSession({ profileNote: "mail a@b.co" }).profileNote, undefined);
  assert.equal(pickSession({ profileNote: " " }).profileNote, undefined);
});

test("a user cell from drawing.json is used; an unknown mode is ignored", async () => {
  const stored = { cells: { docs: { docs: { provider: "claude", model: "claude-fable-5-2", effort: "high", perm: "acceptEdits" } } } };
  const { hub, root } = await makeHub(["claude"], stored);
  const [s] = await make(hub, [{ role: "docs", mode: "docs" }]);
  assert.deepEqual([s.model, s.effort, s.perm, s.profileNote], ["claude-fable-5-2", "high", "acceptEdits", undefined]);
  const [u] = await make(hub, [{ role: "docs", mode: "party" }]);
  assert.equal(u.model, "claude-haiku-5-5");
  assert.equal(u.mode, undefined);
  await hub.store.flush();
  const disk = readFileSync(path.join(root, ".dispatch", "state.json"), "utf8");
  assert.match(disk, /"mode": ?"docs"/);
});

test("plan steps carry a mode: shared list matches the server's, write_plan checks it, defaults pass it on", () => {
  assert.deepEqual([...PLAN_MODES], MODE_IDS);
  const base = { goal: "g", steps: [{ title: "a", role: "impl", mode: "research" }] };
  assert.equal(writePlanProblem(base), null);
  assert.match(writePlanProblem({ ...base, steps: [{ title: "a", role: "impl", mode: "party" }] }), /mode/);
  const plan = { v: 1, block: "b", defaults: { mode: "docs" }, steps: [{ id: "s1", node: "s1", role: "docs" }] };
  assert.equal(planProblem(plan), null);
  assert.equal(resolvedStep(plan, plan.steps[0]).mode, "docs");
  assert.match(planProblem({ ...plan, defaults: { mode: "party" } }), /defaults\.mode must be one of/);
  assert.match(planProblem({ ...plan, steps: [{ id: "s1", node: "s1", role: "docs", mode: "party" }] }), /steps\[0\]\.mode must be one of/);
});

// The mode list lives in the tool schema only; the lead prompt no longer repeats it (#766 prompt audit).
test("the lead's MCP tools list the six modes", () => {
  const src = readFileSync(new URL("../../server/dispatch/mcp.js", import.meta.url), "utf8");
  for (const id of MODE_IDS) assert.match(src, new RegExp(`id: "${id}"`));
});
