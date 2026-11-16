// Shared body of the fake agent CLIs (claude.mjs; gh.mjs has its own). A fake:
// - appends { bin, args, cwd } as one JSON line to $FAKE_CLI_LOG (so a test can prove the fake ran);
// - answers the status commands the server uses (--version, auth status, login status);
// - for a session turn, prints the JSON lines of $FAKE_CLI_SCENARIO (a JSON-lines file) or a short
//   default reply in that CLI's stream format, then exits with $FAKE_CLI_EXIT (default 0).
//   $FAKE_CLI_SCENARIO_<BIN> (e.g. FAKE_CLI_SCENARIO_CLAUDE) takes over for that one CLI.
//   Two scenario lines are actions, not output: { "$sleep": ms } waits, { "$write": { file, text } } writes
//   `text` to the absolute path `file` (a test's scratch folder), like an agent editing a file.
// - with $FAKE_CLI_AUTH (a state file path) fakes `auth status|login|logout`: status reads the file,
//   login prints a fake URL, waits $FAKE_CLI_LOGIN_MS (default 300) and writes the file, or exits with
//   $FAKE_CLI_LOGIN_EXIT without logging in; logout removes the file. Without it, status says logged in.
//   With $FAKE_CLI_LOGIN_IGNORE_TERM the login ignores SIGTERM (only SIGKILL stops it).
// It never talks to the network and never reads credentials.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT = {
  claude: [
    { type: "system", subtype: "init", session_id: "fake-claude-session" },
    { type: "assistant", message: { id: "fake-msg-1", content: [{ type: "text", text: "fake reply" }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: "result", subtype: "success", total_cost_usd: 0.001 },
  ],
};

const STATUS = {
  claude: { "auth status": JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) },
};

function scenario(bin) {
  const file = process.env[`FAKE_CLI_SCENARIO_${bin.toUpperCase()}`] || process.env.FAKE_CLI_SCENARIO;
  if (!file) return DEFAULT[bin];
  return readFileSync(file, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

async function emit(lines) {
  for (const l of lines) {
    if (l.$sleep) await new Promise(r => setTimeout(r, l.$sleep));
    else if (l.$write) writeFileSync(l.$write.file, l.$write.text);
    else process.stdout.write(JSON.stringify(l) + "\n");
  }
}
const finish = () => process.exit(Number(process.env.FAKE_CLI_EXIT || 0));

function fakeAuth(file, sub) {
  if (sub === "status") {
    const loggedIn = existsSync(file);
    process.stdout.write(JSON.stringify(loggedIn ? { loggedIn, authMethod: "claude.ai" } : { loggedIn }) + "\n");
    return process.exit(0);
  }
  if (sub === "logout") { rmSync(file, { force: true }); return process.exit(0); }
  if (sub === "login") {
    if (process.env.FAKE_CLI_LOGIN_IGNORE_TERM) process.on("SIGTERM", () => {});
    process.stdout.write("Open this URL to log in: https://login.example.invalid/oauth?fake=1\n");
    setTimeout(() => {
      if (process.env.FAKE_CLI_LOGIN_EXIT) return process.exit(Number(process.env.FAKE_CLI_LOGIN_EXIT));
      writeFileSync(file, "fake\n");
      process.exit(0);
    }, Number(process.env.FAKE_CLI_LOGIN_MS || 300));
    return;
  }
  process.exit(1);
}

export function run(bin) {
  const args = process.argv.slice(2);
  if (process.env.FAKE_CLI_LOG) appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ bin, args, cwd: process.cwd() }) + "\n");
  if (args[0] === "--version") { process.stdout.write(`${bin} 0.0.0-fake\n`); return finish(); }
  const cmd = args.slice(0, 2).join(" ");
  const auth = process.env.FAKE_CLI_AUTH;
  if (auth && bin === "claude" && args[0] === "auth") return fakeAuth(auth, args[1]);
  const status = STATUS[bin]?.[cmd];
  if (status !== undefined) { process.stdout.write(status + "\n"); return finish(); }

  // claude -p --input-format stream-json: one turn per user line on stdin, alive until stdin ends.
  // Turns are played one after another, so a scenario's $sleep holds back the next turn's lines too.
  let first = true;
  let turns = Promise.resolve();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type !== "user") return;
    const lines = first ? scenario(bin) : DEFAULT.claude.slice(1);
    first = false;
    turns = turns.then(() => emit(lines));
  });
  rl.on("close", () => turns.then(finish));
}
