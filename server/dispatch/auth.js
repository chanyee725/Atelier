import { runCli as run, spawnCli } from "./cli.js";

// Providers as standalone Dispatch has them (issue #587): Claude (claude), OpenAI Codex (codex) and
// Gemini (agy, the Antigravity CLI). Login itself is delegated to each CLI: it opens the browser OAuth
// flow and keeps its own credentials. Drawing never reads or stores tokens, keys, or account emails.
const CLI = {
  gemini: { bin: "agy", login: ["install"], logout: null, store: "~/.gemini/antigravity-cli" },
  claude: { bin: "claude", login: ["auth", "login"], logout: ["auth", "logout"], store: "~/.claude" },
  openai: { bin: "codex", login: ["login"], logout: ["logout"], store: "~/.codex" },
};
export const PROVIDER_IDS = Object.keys(CLI);

const state = Object.fromEntries(PROVIDER_IDS.map(id => [id, { busy: false, url: null, error: null }]));

async function version(bin) {
  try { return (await run(bin, ["--version"], { timeout: 10000 })).stdout.trim().split("\n")[0]; } catch { return null; }
}

// agy has no status command: an installed CLI counts as logged in, as in Dispatch.
const geminiStatus = v => ({ connected: !!v, method: v ? "Antigravity CLI (agy)" : null });

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

async function codexStatus() {
  try {
    const { stdout, stderr } = await run("codex", ["login", "status"], { timeout: 15000 });
    const out = (stdout + stderr).trim();
    const connected = /logged in/i.test(out) && !/not logged in/i.test(out);
    const method = !connected ? null : /chatgpt/i.test(out) ? "ChatGPT 계정" : /api key/i.test(out) ? "API 키" : "로그인됨";
    return { connected, method };
  } catch {
    return { connected: false, method: null };
  }
}

export async function providerStatus() {
  const [gv, cv, ov, cs, os] = await Promise.all([version("agy"), version("claude"), version("codex"), claudeStatus(), codexStatus()]);
  return {
    gemini: { name: "Gemini", installed: !!gv, cli: gv, ...geminiStatus(gv), ...state.gemini, store: CLI.gemini.store,
              run: "agy -p --output-format stream-json", keySupported: false },
    claude: { name: "Claude", installed: !!cv, cli: cv, ...cs, ...state.claude, store: CLI.claude.store,
              run: "claude -p --output-format stream-json", keySupported: false },
    openai: { name: "OpenAI Codex", installed: !!ov, cli: ov, ...os, ...state.openai, store: CLI.openai.store,
              run: "codex exec --json", keySupported: true },
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

// agy has no logout command (running it bare would start an interactive session): nothing to run.
export async function logout(id) {
  if (!CLI[id]?.logout) return;
  await run(CLI[id].bin, CLI[id].logout, { timeout: 15000 }).catch(() => {});
}

/**
 * The CLI's own API-key login (Codex only, as in Dispatch). The key goes straight to the CLI's stdin:
 * it is not written to disk or logs, not kept after this call, and not put in an error message.
 */
export function loginWithKey(id, key) {
  if (id !== "openai") return Promise.reject(Object.assign(new Error("API 키 로그인은 Codex만 지원해요"), { status: 400 }));
  if (typeof key !== "string" || !key.trim()) return Promise.reject(Object.assign(new Error("API 키를 넣어 주세요"), { status: 400 }));
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawnCli("codex", ["login", "--with-api-key"], { stdio: ["pipe", "ignore", "pipe"] }); }
    catch (e) { reject(e); return; }
    let err = "";
    p.stderr.on("data", d => { err = (err + d).slice(-2000); });
    p.on("error", reject);
    // The CLI's own error text could echo the key back: say only that it failed.
    p.on("exit", code => (code === 0 ? resolve() : reject(new Error(`API 키 로그인이 끝나지 않았어요 (code ${code})`))));
    p.stdin.on("error", () => {}); // a CLI that exits before reading: the exit handler reports it
    p.stdin.end(key);
  });
}

// Strip the child-process handle and the cancel flag before sending state to the browser.
export function publicStatus(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) { const { proc, cancelled, ...rest } = v; out[k] = rest; }
  return out;
}
