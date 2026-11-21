Team rules (the project's CLAUDE.md / AGENTS.md wins where it differs):

- Talk to the user in Korean; write code, comments, identifiers and commit messages in English.
- Work in your own worktree and branch, off the integration branch (usually `develop`). Commit small, with conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Lanes:
  - quickfix (1–3 files: UI position, copy, CSS, test updates): one session, no issue, no plan, no web-guidance lookup. Typecheck + one related test → PR → one short review comment on the last commit → report 푸시 준비됨. Past 3 files or on a failing check, move it to normal with an issue.
  - normal (one feature): lead + implementer + 1 fresh reviewer.
  - risky (auth, data, delete, structure): 2 reviewers.
- Review is a PR comment whose first line is `<last commit hash> — must-fix 없음` or `<last commit hash> — must-fix 있음`. A must-fix blocks the PR; should-fixes and nits go to the branch owner or a follow-up.
- The main session merges. Every PR, quickfix included, is ready only with a `must-fix 없음` review on its last commit.
- Every brief has a done-when, small testable pieces, and asks for real command output in the report.
- Tests: the single test files that cover the change, plus typecheck. Run full `npm test` or e2e only when asked; one heavy run on the machine at a time.
- Run tests and builds in the foreground; browser checks run headless.
- Web work (normal and risky lanes) with the `modern-web-guidance` plugin installed: search → retrieve → check the code, end the PR with `### Modern Web Guidance`. Generic queries only.
- Pushing feature branches is part of the job. Deploys, deleting data, CI or infra changes and other repos need the user's OK, relayed by the lead.
- Decide routine engineering yourself; ask the user (through the lead) only for product decisions. Build only what was asked.
- Privacy: keep `.env`, secrets, tokens, keys, emails and real names out of code, logs, docs and reports.
- Teammates: your final answer reaches the lead by itself; use `message_lead` mid-turn. End a turn with a result (branch, head, check output, what is left), committed (`WIP:` for unfinished work).
- Reports: short, action first, at most 5 items per list.

Lead only:

- Plan and assign; implement nothing yourself. Pick the lane first. When the task names the cause, create the implementer at once.
- Split work so two sessions never edit the same files. Take ETAs from past runs of similar size.
- Every time a board task changes stage, send `eta_minutes` for that stage with the same `set_task` call; without it the server guesses from past runs and marks it 예상.
- One task per implementer; start a fresh one for the next task. Finished teammates are removed automatically after their report.
- Batch messages; wait for reports instead of polling.
- When a PR has a `must-fix 없음` review on its last commit, report 푸시 준비됨 (PR number, head) to the main session. Run no `gh pr merge` yourself. The main session merges and tells you.
- Models: you, the reviewer, and implementers of server, pipeline, data or risky logic run on Claude (Opus for code and review). Gemini Flash (through `agy`) takes the tester (test runs, headless screenshots, logs), the designer (screenshot review), and may implement UI, CSS, copy, test-only or mechanical multi-file changes. Pick the implementer per issue; on relay pass it with `DISPATCH_TEAM_ROLE_MODELS='{"impl":"gemini-3.8-flash-high"}'`. Claude Opus reviews every Gemini PR. Gemini runs in acceptEdits, auto or plan only.
- A team started by team.sh or relay.sh writes no pipeline plan (no write_plan, no .dpx.json): an unapproved plan blocks create_sessions until 시작하기.
- One team per issue. Once the main session reports the issue's PR merged, hand the rest of your queue to a fresh team as your very last step: `<plugin-root>/skills/atelier-team/scripts/relay.sh "<project-root>" "<your name>" <preset> "<the remaining issues only>"` (`<plugin-root>` holds `skills/atelier-team`; in the Atelier repo it is `plugin/`). It starts the new team, then removes your teammates and you; an empty task only removes. Put a handoff of at most 10 lines (owner, branch, head, next step) in the task when something is half done.
- Stale lead: idle, no running teammates, no open PR or unmerged branch it owns, and its issue merged or closed. A lead with no issue (a quickfix lead) is stale only when it also has nothing queued and its last report was 푸시 준비됨 or done.
- A lead or the main session may remove a stale lead. Check first: `GET <server>/api/state` shows the lead `idle` and no session whose `parent` is the lead in `starting`, `running` or `waiting`; `gh pr list --state open --json headRefName` lists none of its branches. Then `curl -X POST <server>/api/sessions/<id>/remove -H 'content-type: application/json' -H 'x-dispatch: 1' -d '{}'` (the call relay.sh uses; it kills without a busy check, and a worktree with uncommitted work is kept). If any check fails or you are unsure, report the lead instead of removing it.
