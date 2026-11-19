import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLiveBranches, prPhase } from "../../server/dispatch/live-branches.js";
import { worktreeDirty } from "../../server/dispatch/git.js";

test("prPhase turns a PR answer into one word", () => {
  assert.equal(prPhase(null), null);
  assert.equal(prPhase({ state: "merged", ci: "none" }), "merged");
  assert.equal(prPhase({ state: "closed", ci: "none" }), "closed");
  assert.equal(prPhase({ state: "open", ci: "none", draft: true, conflict: true }), "draft");
  assert.equal(prPhase({ state: "open", ci: "success", conflict: true }), "conflict");
  assert.equal(prPhase({ state: "open", ci: "success", mergeable: true }), "mergeable");
  assert.equal(prPhase({ state: "open", ci: "pending", mergeable: true }), "review");
  assert.equal(prPhase({ state: "open", ci: "none", mergeable: true, review: "changes" }), "review");
  assert.equal(prPhase({ state: "open", ci: "none" }), "review");
});

test("one row per session branch: worktree's current branch, ahead/behind, subject, dirty, PR", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "live-branches-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  try {
    g("init", "-q", "-b", "develop");
    g("config", "user.name", "Test"); g("config", "user.email", "test@example.invalid");
    writeFileSync(path.join(dir, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "init");
    const wt = path.join(dir, ".dispatch", "wt", "impl-1");
    g("worktree", "add", "-q", wt, "-b", "dispatch/impl-1");
    const w = (...a) => execFileSync("git", ["-C", wt, ...a], { encoding: "utf8" }).trim();
    // The session switched to an issue branch inside its worktree and committed twice.
    w("checkout", "-qb", "feat/42-thing");
    writeFileSync(path.join(wt, "b.txt"), "b\n"); w("add", "."); w("commit", "-qm", "first");
    writeFileSync(path.join(wt, "c.txt"), "c\n"); w("add", "."); w("commit", "-qm", "feat: second");
    writeFileSync(path.join(wt, "d.txt"), "uncommitted\n");
    // develop moved on by one commit.
    writeFileSync(path.join(dir, "e.txt"), "e\n"); g("add", "e.txt"); g("commit", "-qm", "dev");

    const sessions = [
      { id: "s1", name: "Ada", role: "impl", roleName: "구현자", status: "running", worktree: true, cwd: wt, branch: "dispatch/impl-1", updatedAt: 2 },
      { id: "s2", name: "Lead", role: "lead", roleName: "관리자", status: "idle", worktree: false, cwd: dir, branch: "develop", updatedAt: 1 },
      { id: "s3", name: "Gone", role: "impl", roleName: "구현자", status: "done", worktree: true, cwd: path.join(dir, "missing"), branch: "dispatch/gone", updatedAt: 0 },
    ];
    const asked = [];
    const prStatus = async b => { asked.push(b); return { ok: true, pr: { number: 7, state: "open", ci: "none", draft: true } }; };
    const live = createLiveBranches({ root: dir, sessions: () => sessions, prStatus });
    const out = await live();
    assert.equal(out.base, "develop");
    assert.equal(out.pr, "on");
    assert.equal(out.rows.length, 1, "develop and a deleted branch get no row");
    const [r] = out.rows;
    assert.equal(r.branch, "feat/42-thing");
    assert.equal(r.issue, 42);
    assert.deepEqual([r.ahead, r.behind], [2, 1]);
    assert.equal(r.subject, "feat: second");
    assert.equal(r.dirty, true);
    assert.equal(typeof r.lastAt, "number");
    assert.deepEqual(r.pr, { number: 7, phase: "draft" });
    assert.deepEqual(r.sessions.map(s => s.id), ["s1"]);
    assert.deepEqual(asked, ["feat/42-thing"]);

    // gh off: the rows stay, without PRs.
    const off = createLiveBranches({ root: dir, sessions: () => sessions, prStatus: async () => ({ ok: false, reason: "disabled" }) });
    const o = await off();
    assert.equal(o.pr, "disabled");
    assert.equal(o.rows[0].pr, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("worktreeDirty reads without rewriting the index (no optional locks)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "live-branches-lock-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  try {
    g("init", "-q", "-b", "develop");
    g("config", "user.name", "Test"); g("config", "user.email", "test@example.invalid");
    writeFileSync(path.join(dir, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "init");
    // Same content, older mtime: a plain `git status` would refresh the stat info and rewrite the index.
    const old = new Date(Date.now() - 3600_000);
    utimesSync(path.join(dir, "a.txt"), old, old);
    const before = readFileSync(path.join(dir, ".git", "index"));
    assert.equal(await worktreeDirty(dir), false);
    assert.deepEqual(readFileSync(path.join(dir, ".git", "index")), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
