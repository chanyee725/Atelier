// #831: a Gemini (agy) teammate's final answer becomes its `last` and reaches its lead as "[이름(역할) 보고]", run
// through the fake agy (test/fixtures/fake-cli/agy.mjs). agy's stream-json sends the answer as text_delta chunks
// (deltas, not the whole text); the result may carry no `response`, may be the last line without a trailing
// newline, or may be missing when agy exits.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const t = setup(lines);
  t.hub.startGemini(t.kid, "테스트 돌려줘");
  await until(() => t.sent.length && !t.hub.rt("K").proc);
  return t;
}

function setup(lines) {
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
  return { hub, kid, sent, bin };
}

const pause = ms => new Promise(r => setTimeout(r, ms));
const reports = sent => sent.filter(t => /^\[Wes\(테스터\) 보고/.test(t));

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

test("an interrupted agy turn sends only the [중단] note: no second report, no extra turn", async () => {
  const gate = path.join(mkdtempSync(path.join(tmpdir(), "gemini-gate-")), "never");
  dirs.push(path.dirname(gate));
  const { hub, kid, sent } = setup([delta("half "), { $waitFor: gate }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "half ");
  hub.interrupt("K");
  await until(() => !hub.rt("K").proc);
  await pause(200); // the process's close comes after its exit
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^\[Wes\(테스터\) 중단\]/);
  assert.equal(reports(sent).length, 0);
  assert.equal(kid.turns, 0);
});

test("after rotate() the old agy closing leaves the new turn running and reports nothing of its own", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gemini-gate-"));
  dirs.push(dir);
  const gate = path.join(dir, "go");
  const { hub, kid, sent, bin } = setup([delta("x "), { $waitFor: gate }, { event: "result", result: { status: "OK" } }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "x ");
  const old = hub.rt("K").proc;
  const oldClosed = new Promise(r => old.on("close", r));
  hub.rotate(kid, "next");
  await oldClosed;
  await until(() => bin.calls().filter(c => c.bin === "agy").length === 2);
  await pause(100);
  assert.deepEqual(sent, []);
  assert.equal(kid.status, "running");
  writeFileSync(gate, "");
  await until(() => sent.length && !hub.rt("K").proc);
  assert.equal(reports(sent).length, 1);
  assert.match(sent[0], /보고\]\nx $/, "only the new turn's text");
});

test("stopAll() (server shutdown) reports nothing for a running agy turn", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gemini-gate-"));
  dirs.push(dir);
  const { hub, kid, sent } = setup([delta("y "), { $waitFor: path.join(dir, "never") }]);
  hub.startGemini(kid, "go");
  await until(() => kid.last === "y ");
  const proc = hub.rt("K").proc;
  const closed = new Promise(r => proc.on("close", r));
  hub.stopAll();
  await closed;
  await pause(50);
  assert.deepEqual(sent, []);
  assert.equal(kid.turns, 0);
});

test("without text_delta, step_update.text is the answer so far: replaced, not appended", () => {
  const { hub, kid } = setup([]);
  hub.onGemini(kid, { event: "step_update", step_update: { step_type: "agent_response", text: "ab" } });
  hub.onGemini(kid, { event: "step_update", step_update: { step_type: "agent_response", text: "abc" } });
  assert.equal(kid.last, "abc");
});
