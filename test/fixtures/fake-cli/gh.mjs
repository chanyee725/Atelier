// Fake `gh` for tests: answers `gh pr view --json ... -- <branch>` (branch = last argument) from FAKE_GH_SCENARIO (JSON file:
// { "<branch>": { json } | { "error": "stderr text", "exit": 1 } }); logs calls to FAKE_CLI_LOG.
// `gh issue list` and `gh pr list` answer from the keys "issue list" and "pr list" (a JSON array, or an error entry).
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ bin: "gh", args, cwd: process.cwd() }) + "\n");
if (process.env.FAKE_GH_SLOW) await new Promise(r => setTimeout(r, Number(process.env.FAKE_GH_SLOW)));
const sc = process.env.FAKE_GH_SCENARIO ? JSON.parse(readFileSync(process.env.FAKE_GH_SCENARIO, "utf8")) : {};
const list = args[1] === "list" ? `${args[0]} list` : null;
const branch = list ?? args.at(-1);
const hit = sc[branch];
if (!hit && list) { process.stdout.write("[]"); process.exit(0); }
if (!hit) { process.stderr.write(`no pull requests found for branch "${branch}"\n`); process.exit(1); }
if (hit.error) { process.stderr.write(hit.error + "\n"); process.exit(hit.exit ?? 1); }
process.stdout.write(JSON.stringify(hit));
