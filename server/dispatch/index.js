// Dispatch module: agent sessions, task board and usage limits for the git project that holds the
// workspace (merged from the standalone Dispatch server, issue #87). See docs/design/dispatch-integration.md.
//
// Writes: <project>/.dispatch/ (state.json, session worktrees) and ~/.dispatch/limits.json (usage
// limits shared with other servers). Transcripts stay in memory. Off when the workspace is not in a
// git project, or another server already uses the project's .dispatch/ (project.js, E13): the
// drawing tool works on its own and GET /api/dispatch says why.
import path from "node:path";
import { ownGitEnv, runCli } from "./cli.js";
import { cancelLogin, login, loginWithKey, logout, PROVIDER_IDS, providerStatus, publicStatus } from "./auth.js";
import { Burn } from "./burn.js";
import { Store } from "./dispatch-store.js";
import { currentBranch } from "./git.js";
import { Ledger } from "./ledger.js";
import { accountLabelOf } from "../../shared/dispatch/accounts.js";
import { Hub } from "./hub.js";
import { createPrStatus } from "./pr-status.js";
import { createLiveBranches } from "./live-branches.js";
import { createIssueList } from "./issues.js";
import { claimProject, findProject, OFF_MESSAGES } from "./project.js";
import { SharedLimits } from "./limits.js";
import { codexModels, staticModels } from "./models.js";
import { PERMS, ROLES } from "./roles.js";
import { adapt, routeTable } from "./routes.js";
import { patchProfiles, profileGrid, readStored, resolveProfile } from "./mode-profiles.js";
import { effectiveRoles, teamSettings } from "./settings.js";
import { readLegacyTheme, UserDefaults } from "../user-defaults.js";

/** Hub events forwarded to the shared SSE stream; none collides with Drawing's `workspace`. */
export const HUB_EVENTS = ["session", "message", "live", "limits", "removed", "tasks", "tickets"];
const THEMES = ["system", "light", "dark", "monitor"];


/** The git top level that holds dir, or null when dir is not in a git work tree. */
export async function gitTop(dir) {
  try { return (await runCli("git", ["-C", dir, "rev-parse", "--show-toplevel"], { env: ownGitEnv() })).stdout.trim() || null; } catch { return null; }
}

/** Every provider "not checked yet": what the UI shows before a provider is connected. */
const UNCHECKED = Object.fromEntries(PROVIDER_IDS.map(id => [id, { installed: null, connected: false, busy: false, url: null, error: null }]));

/**
 * Starts Dispatch for the project at `root`. `deps` replaces the parts that start CLIs or touch the
 * home folder, so tests run with fakes: { providerStatus, codexModels, limitsFile, login, loginWithKey,
 * logout, cancelLogin, spawnCli } (spawnCli as in ./cli.js: the session runners start every agent CLI through it).
 * `deps.userDefaults` is the server's UserDefaults (~/.dispatch/drawing.json); without it nothing outside the
 * project is read or written for settings (memory only).
 */
export async function createDispatch({ root, broadcast, port, workspaceDir, deps = {} }) {
  const dep = { providerStatus, codexModels, login, loginWithKey, logout, cancelLogin, ...deps };
  const store = new Store(root);
  await store.load();
  // The user's defaults file wins over the project's state.json, key by key (docs/design/user-defaults.md).
  const userDefaults = dep.userDefaults ?? new UserDefaults(null);
  const ud = userDefaults.values;
  if (ud.team) store.data.settings.team = { ...(store.data.settings.team || {}), ...ud.team };
  if (ud.guard) store.data.settings.guard = { ...store.data.settings.guard, ...ud.guard };
  const models = staticModels();
  // Claude limits and the Gemini quota live in ~/.dispatch/limits.json, shared by every server.
  const limits = new SharedLimits(...(dep.limitsFile ? [dep.limitsFile] : []));
  await limits.load({ claude: store.data.limits, gemini: store.data.geminiQuota }).catch(e => console.error("dispatch limits:", e.code ?? e.name));
  // Per-project copies saved by an older version: merged into the shared file above, then dropped.
  if ("limits" in store.data || "geminiQuota" in store.data) { delete store.data.limits; delete store.data.geminiQuota; store.save(); }
  const hub = new Hub({ root, store, models, roles: ROLES, port, limits, workspaceDir, spawnCli: dep.spawnCli });

  // A provider counts as connected only after the user connects it here, even if its CLI is already
  // logged in on this machine (`cliLoggedIn` keeps the CLI's own state). Until one is connected no
  // CLI is started at all, not even for a status check.
  const enabled = () => store.data.settings.enabled || {};
  const anyEnabled = () => Object.values(enabled()).some(Boolean);
  const decorate = raw => {
    const out = {};
    for (const [id, p] of Object.entries(publicStatus(raw))) out[id] = { ...p, cliLoggedIn: p.connected, connected: p.connected && !!enabled()[id] };
    return out;
  };
  let providers = decorate(UNCHECKED);
  // Set by close(): a login that ends later must not save state or broadcast on a closed server.
  let closed = false;
  let codexLoaded = false;
  async function refreshProviders() {
    if (closed) return;
    providers = decorate(await dep.providerStatus());
    // Codex publishes its model list through its own CLI: asked once, only after OpenAI Codex is connected here.
    // An empty answer (codex failed) is asked again on the next refresh.
    if (providers.openai?.connected && !codexLoaded) {
      codexLoaded = true;
      const list = await dep.codexModels();
      if (!list.length) codexLoaded = false;
      const add = list.filter(m => !models.some(x => x.id === m.id));
      if (add.length) { models.push(...add); broadcast("models", models); }
    }
    broadcast("providers", providers);
  }
  const setEnabled = (id, on) => {
    if (closed) return;
    store.data.settings.enabled = { ...enabled(), [id]: on };
    store.save();
  };
  // A session's folder must be a top-level workspace folder; the workspace module knows them (none in tests of the hub alone).
  if (dep.topFolders) hub.topFolders = dep.topFolders;
  hub.isConnected = provider => !!providers[provider]?.connected;
  hub.burn = new Burn(store); // $/h per session and the burnWarn flag, on every session object

  for (const ev of HUB_EVENTS) hub.on(ev, data => broadcast(ev, data));

  // Which sessions, models and accounts worked on which issue (#747), kept past session removal. A new session
  // takes the account label its provider has now; after each turn the branch its folder is on is noted (the
  // issue a branch like feat/747-x names).
  hub.accountLabel = provider => accountLabelOf(userDefaults.values.accountLabels, provider);
  const ledger = new Ledger(store);
  for (const s of hub.sessions) ledger.sync(s);
  const lastStatus = new Map();
  hub.on("session", s => {
    ledger.sync(s);
    if (lastStatus.get(s.id) === s.status) return;
    lastStatus.set(s.id, s.status);
    if (!s.cwd || !["idle", "done", "error"].includes(s.status)) return;
    currentBranch(s.cwd).then(b => { if (!closed && ledger.noteBranch(s.id, b)) store.save(); }, () => {});
  });
  hub.on("removed", ({ id }) => { lastStatus.delete(id); ledger.end(id); store.save(); });

  // UI preferences: ~/.dispatch/drawing.json first, then the project's state.json, then the standalone Dispatch's
  // ~/.dispatch/prefs.json (read only), then "system".
  const legacyTheme = dep.userDefaults ? await readLegacyTheme(userDefaults.file) : null;
  const readPrefs = async () => {
    const theme = [(await userDefaults.current()).theme, store.data.prefs?.theme, legacyTheme].find(t => THEMES.includes(t));
    return { theme: theme ?? "system" };
  };
  async function writePrefs(patch) {
    const next = await readPrefs();
    if (THEMES.includes(patch.theme)) {
      await userDefaults.update({ theme: patch.theme });
      next.theme = patch.theme;
    }
    store.data.prefs = next;
    store.save();
    broadcast("prefs", next);
    return next;
  }
  /** Team and guard settings saved from the 설정 UI go to the user's defaults file (`enabled` stays per project). */
  async function saveUserDefaults({ team, guard }) {
    const patch = {};
    if (team) patch.team = team;
    if (guard) {
      const { enabled, ...g } = guard;
      patch.guard = g;
    }
    if (Object.keys(patch).length) await userDefaults.update(patch);
  }

  // Only a whole leading HOME becomes "~" (project.js `home()` undoes exactly that). A trailing slash on
  // HOME, or HOME as a mere prefix of another folder name, must not change the path.
  const tilde = p => {
    const h = (process.env.HOME || "").replace(/\/+$/, "");
    return h && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p;
  };
  async function snapshot() {
    return {
      project: { name: path.basename(root), path: tilde(root), branch: await currentBranch(root) },
      roles: effectiveRoles(ROLES, store, models), perms: PERMS, models, providers,
      limits: hub.currentLimits(), settings: { ...store.data.settings, team: teamSettings(store) },
      sessions: hub.sessions.map(s => hub.publicSession(s)),
      prefs: await readPrefs(),
      tasks: hub.tasks,
      tickets: hub.tickets,
    };
  }

  function usage() {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 864e5).toLocaleDateString("sv-SE");
      days.push({ day, ...(store.data.daily[day] || { cost: 0, models: {}, roles: {} }) });
    }
    return { days };
  }

  // Only this project: other servers are no longer found by registry files or port scans.
  const projects = async () => [{ port: hub.port, name: path.basename(root), path: tilde(root), current: true }];

  // Harness profiles per mode (#748), stored in ~/.dispatch/drawing.json as `modeProfiles`.
  const isConnected = provider => !!providers[provider]?.connected;
  const storedProfiles = async () => readStored((await userDefaults.current()).modeProfiles);
  const modeProfiles = {
    async get() {
      return { ...profileGrid({ stored: await storedProfiles(), models, isConnected, roleModels: teamSettings(store).roleModels }), error: userDefaults.status().error };
    },
    async put(body) {
      const next = patchProfiles(await storedProfiles(), body, models);
      await userDefaults.update({ modeProfiles: next });
      const out = await modeProfiles.get();
      broadcast("mode-profiles", out);
      return out;
    },
    /** What team creation calls (PR2): the profile for `role` in `mode`, with a fallback note. */
    async resolve(mode, role, { perm } = {}) {
      return resolveProfile({ mode, role, stored: await storedProfiles(), models, isConnected, roleModel: teamSettings(store).roleModels[role], perm });
    },
  };

  hub.resolveProfile = (mode, role, opts) => modeProfiles.resolve(mode, role, opts);

  const d = {
    modeProfiles,
    root, store, hub, ledger, models, broadcast, snapshot, usage, projects, readPrefs, writePrefs, saveUserDefaults,
    providers: () => providers, refreshProviders, setEnabled,
    login: dep.login, logout: dep.logout, cancelLogin: dep.cancelLogin, loginWithKey: dep.loginWithKey,
    // PR number, state and CI rollup per branch through `gh` (pr-status.js); off per workspace, cached 30s.
    prStatus: dep.prStatus ?? createPrStatus({ workspaceDir, cwd: root, prDefault: async () => (await userDefaults.current()).prStatus ?? true }),
    // Open issues with the PRs on them through `gh` (issues.js, #776); same switch as PR tracking, cached 60s.
    issues: dep.issues ?? createIssueList({ workspaceDir, cwd: root, prDefault: async () => (await userDefaults.current()).prStatus ?? true }),
  };
  // Session branches with ahead/behind, last commit, dirty flag and PR phase (#792); cached 3s.
  d.liveBranches = dep.liveBranches ?? createLiveBranches({ root, sessions: () => hub.sessions, prStatus: d.prStatus });

  const timers = [];
  // Each timer is guarded on its own: a Hub error must not stop the server or the drawing routes.
  const every = (ms, name, fn) => timers.push(setInterval(async () => {
    try { await fn(); } catch (e) { console.error(`dispatch ${name}:`, e.code ?? e.name); }
  }, ms));

  return {
    ...d,
    routes: routeTable(d).map(adapt),
    /** Runs once the server listens (the Hub needs the port for MCP and hook URLs). */
    async listening() {
      every(30_000, "teams", () => hub.checkTeams());
      // Burn rates are per 30 minutes of wall time; recompute them even when no session event arrives.
      every(60_000, "burn", () => hub.refreshBurn());
      // Another server may have written newer limits; the Hub broadcasts a "limits" event when it did.
      every(5_000, "limits", () => limits.refresh());
      if (anyEnabled()) await refreshProviders().catch(e => console.error("dispatch providers:", e.code ?? e.name));
      try { hub.resumeInterrupted(); } catch (e) { console.error("dispatch resume:", e.code ?? e.name); }
    },
    async close() {
      closed = true;
      // A running CLI login must not outlive the server (it could still log the CLI in).
      await Promise.all(PROVIDER_IDS.map(id => Promise.resolve(dep.cancelLogin(id)).catch(() => {})));
      for (const t of timers) clearInterval(t);
      hub.stopAll();
      await store.close().catch(() => {});
    },
  };
}

/** Drawing module entry (server/modules.js). `deps` is for tests; ctx.spawnCli replaces the CLI seam. */
export async function setup(ctx, deps = {}) {
  let status = { enabled: false, reason: "no-workspace" };
  const statusRoute = { method: "GET", path: "/api/dispatch", handler: (req, res) => sendStatus(res, status) };
  const off = (reason, port = null) => {
    status = { enabled: false, reason, message: OFF_MESSAGES[reason], ...(port ? { port } : {}) };
    console.log(`Dispatch off: ${reason}${port ? ` (port ${port})` : ""}`);
    return { routes: [statusRoute], status: () => status };
  };

  const found = await findProject(ctx.workspaceDir, { gitTop });
  if (!found.root) return off(found.reason);
  const claim = await claimProject(found.root);
  if (!claim.ok) return off(claim.reason, claim.port);
  let d;
  try {
    const topFolders = async () => ((await ctx.modules.workspace?.store?.tree()) ?? []).filter(n => n.type === "folder").map(n => n.name);
    d = await createDispatch({ root: found.root, workspaceDir: ctx.workspaceDir, broadcast: ctx.hub.broadcast, port: () => ctx.port, deps: { topFolders, ...(ctx.modules.userDefaults?.defaults && { userDefaults: ctx.modules.userDefaults.defaults }), ...(ctx.spawnCli && { spawnCli: ctx.spawnCli }), ...deps } });
  } catch (e) {
    await claim.lock.release();
    throw e;
  }
  status = { enabled: true };
  // Each new SSE client gets the Dispatch snapshot first, as the standalone server sent it.
  ctx.hub.onAttach(async sendTo => sendTo("snapshot", await d.snapshot()));
  return {
    ...d,
    // The git project this server runs agents for; /api/info names it by folder (server/app.js projectName).
    projectRoot: found.root,
    routes: [statusRoute, ...d.routes],
    status: () => status,
    async listening() {
      // d.listening() first: it starts the timers synchronously, so a close() that comes while the
      // lock is being written still finds and clears them.
      const started = d.listening();
      await claim.lock.setPort(ctx.port).catch(e => console.error("dispatch lock:", e.code ?? e.name));
      await started;
    },
    async close() {
      await d.close();
      await claim.lock.release();
    },
    releaseSync: () => claim.lock.releaseSync(),
  };
}

function sendStatus(res, body) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
