// E505a: the app's agent features run claude-fable-5-2 only (docs/design/fable-only-projects.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FABLE_ID, staticModels, loadModels } from "../../server/dispatch/models.js";
import { ROLES } from "../../server/dispatch/roles.js";
import { AGENT_CLIS, ALLOWED } from "../../server/dispatch/cli.js";
import { effectiveRoles, patchTeam } from "../../server/dispatch/settings.js";

test("the model list is Fable 5.2 only, with its 200000-token context window", async () => {
  for (const list of [staticModels(), await loadModels()]) {
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "claude-fable-5-2");
    assert.equal(list[0].provider, "claude");
    assert.equal(list[0].contextWindow, 200000);
  }
  assert.equal(FABLE_ID, "claude-fable-5-2");
});

test("every role defaults to Fable 5.2, and only claude, git and gh may run", () => {
  assert.ok(ROLES.length > 0);
  for (const r of ROLES) assert.equal(r.model, FABLE_ID, r.id);
  assert.deepEqual(AGENT_CLIS, ["claude"]);
  assert.deepEqual([...ALLOWED].sort(), ["claude", "gh", "git"]);
});

test("roleModels naming another model are ignored; patchTeam refuses them", () => {
  const models = staticModels();
  const store = { data: { settings: { team: { roleModels: { impl: "claude-haiku-5-5", review: FABLE_ID } } } }, save() {} };
  for (const r of effectiveRoles(ROLES, store, models)) assert.equal(r.model, FABLE_ID, r.id);
  assert.throws(() => patchTeam(store, { roleModels: { impl: "gpt-x" } }, { roles: ROLES, models }), e => e.status === 400);
});
