---
name: atelier-plan
description: Write an Atelier plan — a document plus a step diagram that the user approves with 시작하기 before the team runs it. Use for "계획 세워줘", "단계별로 나눠서 돌려줘", or a lead that must plan before creating teammates. Not for a 1–3 file quickfix.
---

# Atelier plan

A plan is a `.dpx.json` file with a goal, steps and a diagram block; its `plan` field holds the steps (format: `docs/workspace-api.md` → "Pipeline `plan`" in the Atelier repo). One approval (시작하기) per plan; then the steps start in order.

## Steps

1. Split the work into steps. Each step has a title, a role, the files it touches and a done-when. Two steps never share a file. Order them with `after`.
   Done when: every step fits in one line and has a checkable done-when (for example `auth.test 통과`).
2. Write the plan. A lead calls the MCP tool `write_plan` with `goal`, `steps`, and `risks` when there are any. The document has no questions section: a plan is already settled. A question for the user goes to `POST /api/file/discussions?path=<file>` (headers `x-drawing: 1`, `x-drawing-session: $DRAWING_SESSION`; body in `docs/workspace-api.md` → "Questions in a document"); it shows as a card at the top of the plan. `write_plan` refuses `asks`. Pass `path: "<Area>/<feature>/계획.dpx.json"` (areas come from the project's code structure and are named exactly like the code folder, letter case included: `web`, `server`; check `GET /api/tree` first and reuse an existing area in whatever case it has; run `atelier-organize` first when the workspace has none). It writes the document and the step diagram there. Call it again without `path` to revise the same draft.
   Done when: the tool returns the file path.
3. Ask for approval. End the turn with the path and one line: "검토 후 시작하기를 눌러 주세요". `create_sessions` is refused until the user presses 시작하기.
   Done when: `GET /api/pipeline?path=<file>` shows the plan running.
4. Follow the run. Leave a one-line note on a step with `note_step` when something changes (a must-fix, a retry). Notes keep no transcript text.
   Done when: every step is done and the lead has reported the result.

A single-step plan of a small change may pass `autostart: true` and skip the approval.
