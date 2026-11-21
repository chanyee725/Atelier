---
name: atelier-run
description: Control an Atelier plan's run — check whether a plan waits for 시작하기, start it once the user approves, stop, resume, reopen or dismiss it, duplicate a finished plan, leave a note on a running step, and read past run records. Use for "계획 시작해", "실행 멈춰", "이어서 해", "계획 다시 열어", "어떤 계획이 기다려", "실행 기록 보여줘". Writing the plan itself is atelier-plan.
---

# Atelier run

`<plugin-root>` is two levels above this file's folder. Calls go through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]`. `<file>` is a workspace path such as `server/refund/계획.dpx.json` (the extension may be left out). States: `plan` (waits for 시작하기) → `running` → `paused` / `done`.

## Steps

1. Find the plan. Waiting ones: `api.sh GET /api/pipeline/waiting` → `plans[]` (`path`, `title`, `lead`, …). One file: `api.sh GET '/api/pipeline?path=<file>'` → `state`, `revision`, `lead`, `blockers`, `changes`, `sessions`, `limits`.
   Done when: you know the file, its `state` and `revision`, and any `blockers`.
2. Start = the user's one approval. Show the goal, the steps and `changes`, and ask. Only after a clear yes for that revision: `api.sh POST /api/pipeline/start '{"path":"<file>","revision":<revision>}'`. Optional `overrides`: `{ "<stepId>": { model?, effort?, perm?, n? } }` for this run only. 409 `계획이 바뀌었어요` means the file moved on: read it again and ask again. `blockers` (provider, limit) must be cleared first.
   Done when: the reply has `state: "running"` and a `runId`.
3. Stop and go on.
   - Stop: `POST /api/pipeline/stop '{"path":"<file>"}'` (interrupts the team, state `paused`).
   - Resume: `POST /api/pipeline/resume '{"path":"<file>"}'` (refused with `blockers` while a limit holds).
   - Reopen to edit the plan: `POST /api/pipeline/reopen '{"path":"<file>"}'` (paused only; finished steps carry over to the next start).
   - Dismiss a waiting plan whose lead is gone: `POST /api/pipeline/dismiss '{"path":"<file>"}'`.
   - Run a finished plan again: `POST /api/pipeline/duplicate '{"path":"<file>"}'` → `{ path }` of a fresh draft; it needs its own start.
   Done when: `GET /api/pipeline?path=<file>` shows the new state.
4. Note on a running step (a lead's one line, what the `note_step` tool calls): `POST /api/pipeline/note '{"lead":"<lead-id>","step":"<step-id>","text":"..."}'`.
   Done when: the reply has no `error`.
5. Past runs. Files running now: `GET /api/runs/active`. Runs of one file: `GET '/api/runs?path=<file>'` → `runs[]`; one run: `GET '/api/runs/run?path=<file>&id=<runId>'` (step states, times, model, tokens, cost, branch, commit, PR; no transcripts).
   Done when: the user has the summary they asked for.

## Rules

- Never start a plan on your own judgment, and one start per approved revision. The lead merges reviewed PRs afterwards without a second approval.
- Stop is safe to retry; reopen and dismiss change what the user sees, so say what you did.
