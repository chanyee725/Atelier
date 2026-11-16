import { runCli as run, spawnCli } from "./cli.js";

// Login itself is delegated to each CLI: it opens the browser OAuth flow and keeps its own credentials.
// Dispatch never reads or stores tokens, keys, or account emails.
const CLI = {
  claude: { bin: "claude", login: ["auth", "login"], logout: ["auth", "logout"], store: "~/.claude" },
};

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
  catch (e) { Object.assign(state[id], { busy: false, error: e.message }); onChange(); return; }
  const scan = d => {
    const m = String(d).match(/https:\/\/\S+/);
    if (m && !state[id].url) { state[id].url = m[0]; onChange(); }
  };
  p.stdout.on("data", scan);
  p.stderr.on("data", scan);
  p.on("error", e => { Object.assign(state[id], { busy: false, error: e.message }); onChange(); });
  p.on("exit", code => {
    // A cancel ends the login on purpose: no error to show.
    const error = code === 0 || state[id].cancelled ? null : `로그인이 끝나지 않았어요 (code ${code})`;
    Object.assign(state[id], { busy: false, url: null, error, proc: null, cancelled: false });
    onDone(code === 0);
    onChange();
  });
  state[id].proc = p;
}

export function cancelLogin(id) {
  const s = state[id];
  if (!s?.busy || !s.proc) return;
  s.cancelled = true;
  s.proc.kill("SIGTERM");
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
