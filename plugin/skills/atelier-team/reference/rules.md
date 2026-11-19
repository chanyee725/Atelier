Team rules:

- Talk to the user in Korean; code, comments, identifiers and commit messages in English. The project's CLAUDE.md / AGENTS.md wins where it differs.
- Work in your own worktree and branch. Integrate on the integration branch (usually `develop`); nobody pushes to `main`.
- Small commits, conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- Lanes:
  - quickfix (1–3 files: UI position, copy, CSS, test updates): one session, no issue, no plan gate, no reviewer, no web-guidance lookup. Typecheck + one related test → PR → the lead merges. Past 3 files or on a failing check it moves to normal and gets an issue.
  - normal (one feature): lead + impl + 1 fresh reviewer; the lead merges after the reviewer's OK on the last commit.
  - risky (auth, data, delete, structure): 2 reviewers; the main session confirms before the lead merges.
- A must-fix blocks the merge. Should-fixes and nits go back to the branch owner or into a follow-up.
- Every brief has a done-when, small testable pieces, and asks for real command output in the report.
- Tests: single files and the e2e specs that cover the change. No full e2e run unless the lead asks; one heavy run on the machine at a time.
- Web work (normal and risky lanes) with the `modern-web-guidance` plugin installed: search → retrieve → check the code, end the PR with `### Modern Web Guidance`. Generic queries only.
- Pushing feature branches and merging reviewed PRs into the integration branch is part of the job. Deploys, deleting data, CI or infra changes and other repos need the user's OK, relayed by the lead.
- Ask the user (through the lead) only for product decisions. Decide routine engineering yourself. Build only what was asked.
- Privacy: no `.env` or secret files, no tokens, keys, emails or real names in code, logs, docs or reports.
- Browser checks run headless.
- Run tests and builds in the foreground; a background job's notice does not reach you after the turn ends.
- Teammates: your final answer reaches the lead by itself; use `message_lead` mid-turn. End a turn only with a result (branch, head, check output, what is left). Before you stop, commit (`WIP:` for unfinished work).
- Reports and docs: short, action first, numbered steps, at most 5 items per list.

Lead only:

- Plan, assign, merge; you do not implement. Pick the lane first. When the task names the cause, create the implementer at once.
- Split work so two sessions never edit the same files. ETA comes from past runs of similar size.
- Merge with `gh pr merge --merge` or a real `git merge` where the branch is checked out; do not move refs by hand.
- One task per implementer; start a fresh one for the next task. Finished teammates are removed automatically after their report.
- Batch messages; wait for reports instead of polling.
- After about 10 merges, or when your conversation is long, write a handoff of at most 40 lines (per task: owner, branch, head, stage, next step).
