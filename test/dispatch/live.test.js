import { test } from "node:test";
import assert from "node:assert/strict";
import { Hub } from "../../server/dispatch/hub.js";
import { commandHead, LIVE_FILES, LIVE_RECENT, LiveTracker, liveOf, shownPath } from "../../server/dispatch/live.js";

const CWD = "/tmp/ws/wt";

test("liveOf: Claude read, edit and shell calls", () => {
  assert.deepEqual(liveOf("Read", JSON.stringify({ file_path: `${CWD}/src/a.ts` }), CWD), { label: "코드 읽기", file: "src/a.ts", mode: "read" });
  assert.deepEqual(liveOf("Edit", JSON.stringify({ file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" }), CWD), { label: "파일 수정", file: "src/a.ts", mode: "edit" });
  assert.deepEqual(liveOf("Bash", JSON.stringify({ command: "npm test -- --grep secret" }), CWD), { label: "단위 테스트", cmd: "npm test" });
});

test("liveOf: clipped JSON still yields the file", () => {
  const text = JSON.stringify({ file_path: `${CWD}/web/big.tsx`, content: "x".repeat(2000) }).slice(0, 600) + "…";
  assert.equal(liveOf("Write", text, CWD).file, "web/big.tsx");
});

test("liveOf: Codex shell and file_change, Gemini tools, MCP", () => {
  assert.deepEqual(liveOf("shell", "git commit -m 'msg with words'", CWD), { label: "커밋", cmd: "git commit" });
  const e = liveOf("edit", `update ${CWD}/a.js\nadd ${CWD}/b.js`, CWD);
  assert.deepEqual([e.file, e.files, e.mode], ["a.js", ["a.js", "b.js"], "edit"]);
  assert.deepEqual(liveOf("read_file", JSON.stringify({ absolute_path: `${CWD}/x.md` }), CWD), { label: "코드 읽기", file: "x.md", mode: "read" });
  assert.deepEqual(liveOf("replace", JSON.stringify({ file_path: `${CWD}/x.md` }), CWD), { label: "파일 수정", file: "x.md", mode: "edit" });
  assert.equal(liveOf("run_shell_command", JSON.stringify({ command: "npx vitest run" }), CWD).label, "단위 테스트");
  assert.deepEqual(liveOf("mcp__plugin_playwright_playwright__browser_snapshot", "{}", CWD), { label: "화면 확인" });
});

test("shownPath: outside the session folder keeps only the last two parts", () => {
  assert.equal(shownPath("/home/someone/.config/app/settings.json", CWD), "…/app/settings.json");
  assert.equal(shownPath("./src/a.ts", CWD), "src/a.ts");
  assert.equal(shownPath("", CWD), null);
});

test("commandHead: program and subcommand only, never arguments or env assignments", () => {
  assert.equal(commandHead("TOKEN=abc123 curl -H 'Authorization: x' http://127.0.0.1"), "curl");
  assert.equal(commandHead("git -C /x merge --no-ff b"), "git");
  assert.equal(commandHead("/usr/bin/node script.js"), "node");
  assert.equal(commandHead("gh pr create --title t"), "gh pr");
  assert.equal(commandHead("$(evil)"), null);
});

function tracker(throttleMs = 500) {
  let t = 1000;
  const events = [];
  const tr = new LiveTracker({ emit: ev => events.push(ev), throttleMs, now: () => t });
  return { tr, events, advance: ms => { t += ms; } };
}

test("tracker: first change is sent at once, later ones are coalesced into one delta", async () => {
  const { tr, events } = tracker(30);
  const s = { id: "a", cwd: CWD };
  tr.note(s, { kind: "tool", name: "Read", text: JSON.stringify({ file_path: `${CWD}/a.ts` }), at: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].tool.target, "a.ts");
  tr.note(s, { kind: "tool", name: "Read", text: JSON.stringify({ file_path: `${CWD}/b.ts` }), at: 2 });
  tr.note(s, { kind: "tool", name: "Edit", text: JSON.stringify({ file_path: `${CWD}/a.ts` }), at: 3, callId: "c1" });
  tr.note(s, { kind: "tool_result", text: "boom", error: true, callId: "c1" });
  assert.equal(events.length, 1);
  await new Promise(r => setTimeout(r, 1)); // timers use the fake clock's gap, which has not moved: still pending
  tr.flush("a");
  assert.equal(events.length, 2);
  const d = events[1];
  assert.deepEqual(d.recent.map(x => [x.n, x.target, !!x.error]), [[2, "b.ts", false], [3, "a.ts", true]]);
  assert.deepEqual(d.files.map(f => [f.path, f.mode, f.count]).sort(), [["a.ts", "edit", 2], ["b.ts", "read", 1]]);
  assert.equal(d.tool.label, "파일 수정");
  tr.flush("a");
  assert.equal(events.length, 2, "nothing changed, nothing sent");
  tr.drop("a");
});

test("tracker: idle clears the running tool; snapshot is capped", () => {
  const { tr, events } = tracker(0);
  const s = { id: "a", cwd: CWD };
  for (let i = 0; i < LIVE_FILES + 10; i++) tr.note(s, { kind: "tool", name: "Read", text: JSON.stringify({ file_path: `${CWD}/f${i}.ts` }), at: i });
  tr.note(s, { kind: "tool", name: "Edit", text: JSON.stringify({ file_path: `${CWD}/f0.ts` }) });
  const snap = tr.snapshot("a");
  assert.equal(snap.recent.length, LIVE_RECENT);
  assert.equal(snap.files.length, LIVE_FILES);
  assert.equal(snap.files[0].path, "f0.ts");
  assert.equal(snap.files[0].mode, "edit");
  tr.idle("a");
  assert.equal(events.at(-1).tool, null);
  assert.equal(tr.snapshot("a").tool, null);
  assert.deepEqual(tr.snapshot("zzz"), { tool: null, recent: [], files: [] });
});

// A Hub stand-in with just what push(), touch() and remove-like paths reach for.
function fakeHub(s) {
  const events = [];
  const hub = Object.assign(Object.create(Hub.prototype), {
    live: new Map(), store: { data: { sessions: { [s.id]: s } }, save() {} },
    liveView: new LiveTracker({ emit: ev => events.push(ev), throttleMs: 0 }),
    emit() {},
  });
  return { hub, events };
}

test("hub: live events carry no transcript text, tool output or secrets", () => {
  const s = { id: "a", cwd: CWD, status: "running", parent: null, updatedAt: 0 };
  const { hub, events } = fakeHub(s);
  hub.push(s, { kind: "assistant", text: "private reasoning text" });
  hub.push(s, { kind: "tool", name: "Bash", text: JSON.stringify({ command: "curl -H 'Authorization: Bearer sk-ant-abcdefghijklmnop' http://127.0.0.1" }), callId: "c" });
  hub.push(s, { kind: "tool_result", text: "secret output", error: true, callId: "c" });
  hub.push(s, { kind: "tool", name: "Write", text: JSON.stringify({ file_path: `${CWD}/notes.md`, content: "private file body" }) });
  const all = JSON.stringify([events, hub.liveState("a")]);
  for (const bad of ["private reasoning", "secret output", "sk-ant", "Bearer", "private file body", "/tmp/ws"]) assert.ok(!all.includes(bad), bad);
  assert.deepEqual(hub.liveState("a").recent.map(x => x.target), ["curl", "notes.md"]);
  assert.equal(hub.liveState("a").recent[0].error, true);
  hub.touch(s, { status: "idle" });
  assert.equal(hub.liveState("a").tool, null);
});
