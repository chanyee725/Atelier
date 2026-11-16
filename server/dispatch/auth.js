import { runCli as run, spawnCli } from "./cli.js";

// Login itself is delegated to each CLI: it opens the browser OAuth flow and keeps its own credentials.
// Dispatch never reads or stores tokens, keys, or account emails.
const CLI = {
  claude: { bin: "claude", login: ["auth", "login"], logout: ["auth", "logout"], store: "~/.claude" },
};

const START_FAILED = "로그인을 시작하지 못했어요. 다시 눌러 주세요";

const state = {
  claude: { busy: false, url: null, error: null },
};

async function version(bin) {
  try { return (await run(bin, ["--version"], { timeout: 10000 })).stdout.trim().split("\n")[0]; } catch { return null; }
}

async function claudeStatus() {
  try {
    const { stdout } = await run("claude", ["auth", "status"], { timeout: 15000 });
    const s = JSON.parse(stdout);
    const method = !s.loggedIn ? null
      : s.authMethod === "claude.ai" ? "구독 계정 (claude.ai)"
      : s.apiKeySource || s.authMethod === "console" ? "API 키 / Console" : String(s.authMethod);
    return { connected: !!s.loggedIn, method };
  } catch {
    return { connected: false, method: null };
  }
}

export async function providerStatus() {
  const [cv, cs] = await Promise.all([version("claude"), claudeStatus()]);
  return {
    claude: { name: "Claude", installed: !!cv, cli: cv, ...cs, ...state.claude, store: CLI.claude.store,
              run: "claude -p --output-format stream-json", keySupported: false },
  };
}

// onDone(ok) fires once the CLI login process exits.
export function login(id, onChange, onDone = () => {}) {
  const cli = CLI[id];
  if (!cli || state[id].busy) return;
  Object.assign(state[id], { busy: true, url: null, error: null, cancelled: false });
  onChange();
  let p;
  try { p = spawnCli(cli.bin, cli.login, { stdio: ["ignore", "pipe", "pipe"] }); }
  catch { Object.assign(state[id], { busy: false, error: START_FAILED, proc: null }); onChange(); return; }
  const scan = d => {
    const m = String(d).match(/https:\/\/\S+/);
    if (m && !state[id].url) { state[id].url = m[0]; onChange(); }
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  // A spawn failure (no exit follows) ends the login too; the raw message stays out of the UI.
  p.on("error", () => {
    if (state[id].proc !== p) return;
    Object.assign(state[id], { busy: false, url: null, error: START_FAILED, proc: null, cancelled: false });
    onChange();
  });
  p.on("exit", code => {
    if (state[id].proc !== p) return;
    // A cancel ends the login on purpose: no error to show, and never a connect (even if it raced to 0).
    const { cancelled } = state[id];
    const error = code === 0 || cancelled ? null : code == null ? "로그인이 끝나지 않았어요" : `로그인이 끝나지 않았어요 (code ${code})`;
    Object.assign(state[id], { busy: false, url: null, error, proc: null, cancelled: false });
    onDone(code === 0 && !cancelled);
    onChange();
  });
  state[id].proc = p;
}

/**
 * Stops a running login: SIGTERM, then SIGKILL after `killAfterMs` for a CLI that ignores it.
 * Resolves once the login process has exited (at once when none is running).
 */
export function cancelLogin(id, killAfterMs = 3000) {
  const s = state[id];
  const p = s?.proc;
  if (!s?.busy || !p) return Promise.resolve();
  s.cancelled = true;
  return new Promise(resolve => {
    if (p.exitCode !== null || p.signalCode !== null) return resolve();
    const timer = setTimeout(() => p.kill("SIGKILL"), killAfterMs);
    p.once("exit", () => { clearTimeout(timer); resolve(); });
    p.kill("SIGTERM");
  });
}

export async function logout(id) {
  if (!CLI[id]) return;
  await run(CLI[id].bin, CLI[id].logout, { timeout: 15000 }).catch(() => {});
}

// Strip the child-process handle and the cancel flag before sending state to the browser.
export function publicStatus(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) { const { proc, cancelled, ...rest } = v; out[k] = rest; }
  return out;
}
