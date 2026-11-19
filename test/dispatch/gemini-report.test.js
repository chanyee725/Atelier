// #831: a Gemini (agy) teammate's final answer becomes its `last` and reaches its lead as "[이름(역할) 보고]", run
// through the fake agy (test/fixtures/fake-cli/agy.mjs). agy's stream-json sends the answer as text_delta chunks
// (deltas, not the whole text); the result may carry no `response`, may be the last line without a trailing
// newline, or may be missing when agy exits.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hub } from "../../server/dispatch/hub.js";
import { fakeCliBin, fakeSpawner, until } from "../fixtures/fake-cli/index.mjs";

const MODELS = [
  { id: "claude-fable-5-2", provider: "claude", efforts: ["low"], contextWindow: 200000 },
  { id: "gemini-fake-flash", provider: "gemini", efforts: ["low"], contextWindow: 1000000 },
];
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const delta = text => ({ event: "step_update", step_update: { step_type: "agent_response", text_delta: text, usage: { input_tokens: 1, output_tokens: 1 } } });

async function run(lines) {
  const bin = fakeCliBin({ scenarios: { agy: lines } });
  dirs.push(bin.dir);
  const root = mkdtempSync(path.join(tmpdir(), "gemini-report-"));
  dirs.push(root);
  const store = { data: { seq: 0, sessions: {}, tasks: {}, tickets: {}, settings: { guard: { enabled: false } } }, save() {}, addDaily() {} };
  const hub = new Hub({ root, store, models: MODELS, roles: [], port: 0, limits: Object.assign(new EventEmitter(), { claude: {} }), spawnCli: fakeSpawner(bin) });
  after(() => hub.stopAll());
  const usage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const sent = [];
  store.data.sessions.L = { id: "L", name: "Dex", roleName: "관리자", role: "lead", provider: "claude", model: "claude-fable-5-2", status: "idle", usage: usage(), turns: 1, canSpawn: true };
  hub.rt("L").proc = { stdin: { write: l => sent.push(JSON.parse(l).message.content) }, kill() {} };
  const kid = store.data.sessions.K = { id: "K", name: "Wes", roleName: "테스터", role: "test", parent: "L", provider: "gemini", model: "gemini-fake-flash",
    perm: "auto", cwd: root, status: "idle", usage: usage(), turns: 0, last: "" };
  hub.startGemini(kid, "테스트 돌려줘");
  await until(() => sent.length && !hub.rt("K").proc);
  return { kid, sent };
}

test("text_delta chunks add up to the answer, and a result without response still reports it", async () => {
  const { kid, sent } = await run([
    { event: "init", conversation_id: "c1" },
    delta("테스트 "), delta("통과했어요"),
    { event: "result", result: { status: "OK" } },
  ]);
  assert.equal(kid.last, "테스트 통과했어요");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n테스트 통과했어요/);
  assert.equal(kid.status, "idle");
});

test("a turn that ends without a result event still reports what agy said", async () => {
  const { kid, sent } = await run([{ event: "init", conversation_id: "c2" }, delta("끝났어요")]);
  assert.equal(kid.last, "끝났어요");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n끝났어요/);
});

test("a result on the last line without a trailing newline is read", async () => {
  const { kid, sent } = await run([
    { event: "init", conversation_id: "c3" },
    { $raw: JSON.stringify({ event: "result", result: { status: "OK", response: "최종 답변" } }) },
  ]);
  assert.equal(kid.last, "최종 답변");
  assert.match(sent[0], /^\[Wes\(테스터\) 보고\]\n최종 답변/);
});

test("one report per turn when deltas and a result both arrive", async () => {
  const { sent } = await run([delta("a"), delta("b"), { event: "result", result: { status: "OK", response: "ab" } }]);
  assert.equal(sent.filter(t => t.includes("보고]")).length, 1);
  assert.match(sent[0], /\nab/);
});
