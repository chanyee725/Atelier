// Live agent cursor (E56, issue #226): when an agent session changes a diagram, broadcast where on the canvas it
// is working as a `cursor` event on the shared /api/events hub. Memory only: nothing about cursors is written to
// disk, and the position comes only from the agent's own edits (no mouse data).
//
// Attribution: a session's recent tool calls (masked, clipped input text from the Dispatch hub) that mention the
// changed file's path, within ATTRIBUTE_MS. Read-only tools do not count, nor do calls that failed or finished more
// than SETTLE_MS before the change (a jq or curl GET that left no edit), except in a watcher catch-up (see
// `onChange`). Several sessions left: see `pick`. Results are paired with calls by `callId` (Claude: tool_use id, so
// parallel and subagent calls cannot swap); without one, in call order. Codex entries are `final`: already finished.
import { AGENT_COLORS } from '../dispatch/colors.js';
import { changedCentre, changedDocSpot, changedKeys, docBlocksOf, mentionsFile, shapesOf, textMentions } from './model.js';
import { agentStatus } from '../../shared/dispatch/agent-status.ts';

const ATTRIBUTE_MS = 60_000;
const RECENT_PER_SESSION = 20;
const MAX_FILES = 50;
const END_GRACE_MS = 2000;
const SETTLE_MS = 3000; // a finished call's own edit reaches onChange well within this (watcher debounce: 60ms)
const LIVE = new Set(['running', 'starting', 'waiting']);
// A session that edited a file keeps it this long (#653): an unnamed later write of that file while one of its own
// edit calls runs (`bash save.sh`, a helper script) is still its own, not an outside writer's.
const HOLD_MS = 10 * 60_000;
// An outside writer that named itself keeps the file this long: its unnamed writes keep that name (#653).
const OUTSIDE_HOLD_MS = 2 * 60_000;
const MAX_SCRIPTS = 20;
const SCRIPT_RE = /(?:^|[\s"'=/])([\w.-]+\.(?:sh|bash|py|mjs|cjs|js|ts|rb|pl))\b/g;
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch']);
const DPX_RE = /[^\s"'`=?&<>|;(),]*\.dpx\.json/g;
const EMPTY = new Map();
// What a change is diffed on: the shapes with a place (shapesOf) plus, for the document cursor (E529, #619), the
// document's top-level blocks as `.doc`.
const snapshotOf = (file) => Object.assign(shapesOf(file), { doc: docBlocksOf(file) });
const docOf = (s) => s?.doc ?? [];
// Where a change lands: `{ x, y }` on the canvas and/or `{ doc: { index, offset } }` in the document (E529, #619).
const spotOf = (before, after) => {
  const at = changedCentre(before, after);
  const doc = changedDocSpot(docOf(before), docOf(after));
  return at || doc ? { ...(at ?? {}), ...(doc ? { doc } : {}) } : null;
};
const OUTSIDE_NAME = '에이전트';
// Workspace paths in `/api/file?path=…` URLs (decoded; the API adds `.dpx.json` when it is missing, #653).
const API_PATH_RE = /\/api\/file(?:\/plan)?\?(?:[^\s"'`]*&)?path=([^&\s"'`\\#]+)/g;
const apiPaths = (text) => {
  const out = new Set();
  for (const m of text.matchAll(API_PATH_RE)) {
    let p;
    try { p = decodeURIComponent(m[1]); } catch { p = m[1]; }
    p = p.replace(/^\/+/, '');
    if (!p || p.includes('$') || p.split('/').includes('..')) continue;
    out.add(p.endsWith('.dpx.json') ? p : `${p}.dpx.json`);
  }
  return [...out];
};

// Whether `text` names `id` as a whole token, so a short id ("a") does not match inside other words. A path segment
// ("flow" in flow.dpx.json or /api/file) is not a mention: common words as ids would otherwise match every call.
const namesId = (text, id) => {
  if (!id) return false;
  for (let i = text.indexOf(id); i !== -1; i = text.indexOf(id, i + 1)) {
    const before = text[i - 1] ?? '';
    const after = text.slice(i + id.length, i + id.length + 2);
    if (!/[\w\-/.]/.test(before) && !/^[\w\-/]/.test(after) && !/^\.\w/.test(after)) return true;
  }
  return false;
};

export async function setup(ctx) {
  const ws = ctx.modules.workspace;
  const hub = ctx.modules.dispatch?.hub;
  if (!ws?.store || !ws.onChange || !hub) return {};
  const recent = new Map(); // session id -> [{ entry, at, done, failed }]
  // Two kinds of "before" per file, kept apart so a slow tool-time read can never overwrite what a change reported:
  // `seen` is the version from the file's last reported change (watcher or API), the exact version the next change
  // starts from; `pre` is read when a tool call mentions a file with no reported change yet.
  const seen = new Map(); // rel -> shapesOf(file), insertion order = age
  const pre = new Map(); // rel -> shapesOf(file)
  const pending = new Map(); // rel -> tool-time read in flight
  const queue = new Map(); // rel -> tail of that file's change handling (one change at a time per file)
  const shown = new Set(); // session ids with a cursor on screen
  // Per session (#653), memory only: scripts it wrote that name a file (script file name -> workspace paths), the file
  // it last edited and when, what part of it (diagram | doc | table) and the status label last sent.
  const scripts = new Map(); // session id -> Map name -> Set rel
  const holds = new Map(); // session id -> { file, at }
  const targets = new Map(); // session id -> AgentTarget
  const statuses = new Map(); // session id -> status label last sent
  const lastCursor = new Map(); // session id -> last cursor event (replayed to a page that connects later)
  const outsideNames = new Map(); // rel -> { name, at }: the last named outside writer of a file
  const statusListeners = new Set();
  // In-process listeners for the live agent list (server/cursor/agents.js): which file each writer holds now.
  const heldListeners = new Set();
  const held = (e) => {
    for (const fn of heldListeners) fn(e);
  };

  const remember = (map, rel, s) => {
    map.delete(rel);
    map.set(rel, s);
    if (map.size > MAX_FILES) map.delete(map.keys().next().value);
  };
  const read = async (rel) => snapshotOf(await ws.store.readFile(rel));

  // Before an edit lands: read the file's current shapes so the change can be diffed. The tool line arrives
  // before the tool runs. Resolves true when `rel` exists (a missing file is about to be created).
  function readBefore(rel) {
    if (seen.has(rel) || pre.has(rel)) return Promise.resolve(true);
    let p = pending.get(rel);
    if (!p) {
      p = read(rel).then((s) => { remember(pre, rel, s); return true; }, () => false);
      pending.set(rel, p);
      p.then(() => { if (pending.get(rel) === p) pending.delete(rel); });
    }
    return p;
  }

  // The mention may be absolute or relative to another folder: try its tail segments.
  async function baseline(text) {
    for (const raw of new Set(text.match(DPX_RE) ?? [])) {
      let path;
      try { path = decodeURIComponent(raw); } catch { path = raw; }
      const parts = path.split('/').filter((s) => s && s !== '.');
      for (let i = Math.max(0, parts.length - 6); i < parts.length; i++) {
        if (await readBefore(parts.slice(i).join('/'))) break;
      }
    }
  }

  const onMessage = ({ id, entry }) => {
    if (entry?.kind === 'tool_result') {
      if (entry.final) return; // Codex: its result belongs to the entry just before, which was final already
      // Paired by call id; without one, in call order: the session's oldest call still running.
      const open = recent.get(id)?.filter((c) => c.done === null);
      const call = entry.callId ? open?.find((c) => c.entry.callId === entry.callId) : open?.[0];
      if (call) {
        call.done = Date.now();
        call.failed = !!entry.error;
      }
      refresh(id);
      return;
    }
    if (entry?.kind !== 'tool' || typeof entry.text !== 'string') return;
    const list = recent.get(id) ?? [];
    // Codex reports a call only once it has finished, with no result to follow.
    const now = Date.now();
    const final = entry.final === true;
    list.push({ entry, at: now, done: final ? now : null, failed: final && !!entry.error });
    if (list.length > RECENT_PER_SESSION) list.shift();
    recent.set(id, list);
    noteScript(id, entry);
    if (entry.text.includes('.dpx.json')) baseline(entry.text).catch(() => {});
    for (const rel of apiPaths(entry.text)) readBefore(rel).catch(() => {});
    refresh(id);
  };

  // A Write/Edit of a script that names workspace files (by path, with or without .dpx.json): remember the script's
  // file name, so a later `bash save.sh` counts as a mention of those files. Files known from changes and reads only.
  function noteScript(id, entry) {
    if (!/^(Write|Edit|MultiEdit|edit)$/.test(entry.name)) return;
    const names = [...entry.text.matchAll(SCRIPT_RE)].map((m) => m[1]);
    if (!names.length) return;
    const body = entry.text.replace(SCRIPT_RE, ' ');
    const known = [...seen.keys(), ...pre.keys(), ...outsideNames.keys(), ...[...holds.values()].map((h) => h.file)];
    const files = [...new Set([...apiPaths(body), ...known.filter((rel) => textMentions(body, rel))])];
    if (!files.length) return;
    const m = scripts.get(id) ?? new Map();
    for (const n of names) {
      m.delete(n);
      m.set(n, new Set(files));
    }
    while (m.size > MAX_SCRIPTS) m.delete(m.keys().next().value);
    scripts.set(id, m);
  }
  const namesWord = (text, word) => new RegExp(`(^|[\\s"'=/])${word.replace(/[.]/g, '\\.')}\\b`).test(text);
  // Whether a session's call names `rel`: directly, or by running a script it wrote that names it.
  function mentions(id, entry, rel) {
    if (mentionsFile(entry, rel)) return true;
    if (entry?.kind !== 'tool' || READ_ONLY.has(entry.name) || typeof entry.text !== 'string') return false;
    for (const [n, files] of scripts.get(id) ?? EMPTY) if (files.has(rel) && namesWord(entry.text, n)) return true;
    return false;
  }

  // The session's status label (shared/dispatch/agent-status.ts) from its newest running call and what it edited.
  function statusOf(id) {
    const s = hub.get(id);
    if (!s || !LIVE.has(s.status)) return null;
    const list = recent.get(id) ?? [];
    let open = null;
    for (let i = list.length - 1; i >= 0 && !open; i--) if (list[i].done === null) open = list[i].entry;
    return agentStatus({ status: s.status, tool: open && { name: open.name, text: open.text }, target: targets.get(id) ?? null });
  }
  // Send the status of a session with a cursor when it changed, as its own `cursor-status` event { sid, status }:
  // it is not an edit, so the page keeps the cursor where it is and does not restart its editing phase.
  function refresh(id) {
    const status = statusOf(id);
    if ((statuses.get(id) ?? null) === status) return;
    if (status) statuses.set(id, status);
    else statuses.delete(id);
    for (const fn of statusListeners) fn({ sid: id, status });
    const last = lastCursor.get(id);
    if (!shown.has(id) || !last || !status) return;
    lastCursor.set(id, { ...last, status });
    ctx.hub.broadcast('cursor-status', { sid: id, status });
  }

  // Every live session with a recent edit-tool mention of `rel` that could have made this change (its newest one):
  // still running, or finished within SETTLE_MS, and not failed. Several sessions can edit one file at once (two
  // agents, two blocks of one diagram): choosing among them waits for the diff, see `pick`.
  // A call still running counts however long ago it started (a script that saves several times over minutes, #653).
  function whoEdited(rel, now, settle = SETTLE_MS, { app = false, writer = null } = {}) {
    const out = [];
    if (app) return out; // a save from this page is the user's, even while an agent's call is open
    for (const [id, list] of recent) {
      const s = hub.get(id);
      if (!s) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const { entry, at, done, failed } = list[i];
        if (done !== null && now - at > ATTRIBUTE_MS) continue;
        if (now - at > HOLD_MS) break;
        if (failed || (done !== null && now - done > settle)) continue;
        if (mentions(id, entry, rel)) { out.push({ s, entry, at }); break; }
      }
    }
    if (out.length) return out;
    // Nobody named the file: a session that edited it lately and has an edit-capable call running (or just finished)
    // made it, when it is the only one. A writer naming someone else is not it.
    const held = [];
    for (const [id, h] of holds) {
      const s = hub.get(id);
      if (!s || h.file !== rel || now - h.at > HOLD_MS || !LIVE.has(s.status)) continue;
      if (writer && writer !== s.name) continue;
      const list = recent.get(id) ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        const { entry, at, done, failed } = list[i];
        if (now - at > HOLD_MS) break;
        if (failed || READ_ONLY.has(entry.name) || (done !== null && now - done > settle)) continue;
        held.push({ s, entry, at });
        break;
      }
    }
    return held.length === 1 ? held : out;
  }

  const used = new WeakSet(); // tool entries already credited with a change
  // One change, several candidate sessions: the one whose tool call names a changed block or element and no
  // unchanged one wins (a whole-file Write or curl PUT body names every id, so it tells nothing); else the oldest
  // call that has not been credited yet (each agent's call precedes its own change); else the newest.
  function pick(cands, before, after) {
    if (cands.length < 2) return cands[0] ?? null;
    const changed = new Set(changedKeys(before, after));
    const idOf = (k) => k.slice(k.indexOf(':') + 1);
    const hit = [...changed].map(idOf).filter(Boolean);
    const miss = [...new Set([...before.keys(), ...after.keys()])].filter((k) => !changed.has(k)).map(idOf).filter(Boolean);
    const newest = (l) => l.reduce((a, c) => (c.at > a.at ? c : a));
    const named = cands.filter((c) => hit.some((id) => namesId(c.entry.text, id)) && !miss.some((id) => namesId(c.entry.text, id)));
    if (named.length) return newest(named);
    const fresh = cands.filter((c) => !used.has(c.entry));
    if (fresh.length) return fresh.reduce((a, c) => (c.at < a.at ? c : a));
    return newest(cands);
  }

  async function place(rel, cands, wait, app, writer) {
    await wait; // a tool-time read still in flight when the change came: let it land in `pre` first
    let after;
    try { after = await read(rel); } catch { return; }
    const before = seen.get(rel);
    const earlier = pre.get(rel);
    remember(seen, rel, after);
    pre.delete(rel);
    // No session on this hub made the change: a writer from another Dispatch or plain API calls (E520, #543). It gets
    // a generic cursor at the changed place, per file, that fades by itself. Saves from this page (`app`) are not it.
    // A writer that names itself (`x-drawing-session`, cleaned; E528 #592) gets its own label and one cursor of its own.
    // A session on this hub that could have made the change keeps it, whatever name the request sends (an agent may
    // send a wrong or role-style name); the `x-drawing-session` label only names writers this hub cannot see.
    if (!cands.length) {
      if (app) return;
      const now = Date.now();
      // An unnamed write of a file a named outside writer wrote lately is that writer's (#653).
      const named = outsideNames.get(rel);
      if (writer) outsideNames.set(rel, { name: writer, at: now });
      else if (named && now - named.at <= OUTSIDE_HOLD_MS) writer = named.name;
      if (outsideNames.size > MAX_FILES) outsideNames.delete(outsideNames.keys().next().value);
      if (writer) held({ sid: `outside:${writer}`, name: writer, file: rel, at: now, outside: true });
      const spot = spotOf(before ?? (earlier && spotOf(earlier, after) ? earlier : EMPTY), after);
      const sid = writer ? `outside:${writer}` : `outside:${rel}`;
      if (spot) ctx.hub.broadcast('cursor', { sid, name: writer ?? OUTSIDE_NAME, role: '', file: rel, ...spot, at: now });
      return;
    }
    // From the reported version when there is one. Otherwise from the tool-time read, unless that shows no change
    // (it raced the edit and read the new version) or there is none (a new file): then from an empty canvas, so a
    // first edit or a new diagram still gets a place.
    const base = before ?? (earlier && spotOf(earlier, after) ? earlier : EMPTY);
    const at = spotOf(base, after);
    const chosen = pick(cands, base, after);
    used.add(chosen.entry);
    const s = chosen.s;
    shown.add(s.id);
    // Without a place (nothing with a place changed) the cursor stays where it was.
    const color = AGENT_COLORS.includes(s.color) ? { color: s.color } : {};
    const now = Date.now();
    holds.set(s.id, { file: rel, at: now });
    if (at) targets.set(s.id, targetOf(at, after));
    held({ sid: s.id, file: rel, at: now });
    const status = statusOf(s.id);
    if (status) statuses.set(s.id, status);
    // `live`: the page keeps this cursor until the session ends or moves on (a `gone` event), it does not fade.
    const e = { sid: s.id, name: s.name, role: s.role, ...color, file: rel, ...(at ?? {}), live: true, ...(status ? { status } : {}), at: now };
    const last = lastCursor.get(s.id);
    lastCursor.set(s.id, { ...e, ...(at ? {} : last?.file === rel ? pick2(last) : {}) });
    ctx.hub.broadcast('cursor', e);
  }
  // The place fields of a cursor event, for the replay to a page that connects later.
  const pick2 = (e) => ({ ...(e.x !== undefined ? { x: e.x, y: e.y } : {}), ...(e.doc ? { doc: e.doc } : {}) });
  // What part of the file a change was in: a diagram (a place on the canvas or an embedded diagram), a table, text.
  function targetOf(at, after) {
    if (at.x !== undefined && !at.doc) return 'diagram';
    const type = docBlocksOf(after)[at.doc?.index]?.type ?? '';
    if (/table/i.test(type)) return 'table';
    if (/diagram|drawing|canvas/i.test(type)) return 'diagram';
    return at.x !== undefined ? 'diagram' : 'doc';
  }

  // Changes of one file are handled in order: each diffs against the version the one before it left in `seen`.
  // A watcher catch-up (it restarted after a failure, backoff up to 30s) reports edits made while it was down, so
  // the call finishing before it is no longer a sign of a read-only call: any call within ATTRIBUTE_MS can be it.
  // So read-only calls (jq, curl GET) that finished within that window also become candidates during a catch-up.
  const onChange = (rel, { catchUp = false, app = false, writer = null } = {}) => {
    const cands = whoEdited(rel, Date.now(), catchUp ? ATTRIBUTE_MS : SETTLE_MS, { app, writer });
    const run = (queue.get(rel) ?? Promise.resolve()).then(() => place(rel, cands, pending.get(rel), app, writer));
    const tail = run.catch(() => {});
    queue.set(rel, tail);
    tail.then(() => { if (queue.get(rel) === tail) queue.delete(rel); });
    return run;
  };

  const gone = (id) => {
    lastCursor.delete(id);
    if (!shown.delete(id)) return;
    ctx.hub.broadcast('cursor', { sid: id, gone: true });
  };
  // A turn that ended: its last edit can still be on its way through the file watcher, so forget the session a
  // moment later (unless it is busy again by then).
  const ending = new Map(); // session id -> timer
  const end = (id) => {
    ending.delete(id);
    recent.delete(id);
    scripts.delete(id);
    holds.delete(id);
    targets.delete(id);
    if (statuses.delete(id)) for (const fn of statusListeners) fn({ sid: id, status: null });
    gone(id);
    held({ sid: id, gone: true });
  };
  const onSession = (ps) => {
    if (!ps?.id) return;
    if (LIVE.has(ps.status)) {
      clearTimeout(ending.get(ps.id));
      ending.delete(ps.id);
      refresh(ps.id);
    } else if (!ending.has(ps.id) && (recent.has(ps.id) || shown.has(ps.id))) {
      ending.set(ps.id, setTimeout(end, END_GRACE_MS, ps.id));
    }
  };
  const onRemoved = ({ id }) => {
    clearTimeout(ending.get(id));
    end(id);
  };

  hub.on('message', onMessage);
  hub.on('session', onSession);
  hub.on('removed', onRemoved);
  const offChange = ws.onChange((rel, opts) => { onChange(rel, opts).catch(() => {}); });
  // A page that connects (or reconnects: it clears its cursors) gets the cursors of sessions still at work.
  ctx.hub.onAttach?.((sendTo) => {
    for (const [id, e] of lastCursor) if (shown.has(id)) sendTo('cursor', { ...e, ...(statuses.has(id) ? { status: statuses.get(id) } : {}) });
  });
  return {
    /** The status label of a live session (shared/dispatch/agent-status.ts), or null. Memory only. */
    statusOf: (sid) => statuses.get(sid) ?? statusOf(sid),
    /** fn({ sid, status }) when a session's status label changes (status null: it stopped working). */
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    /** fn({ sid, file, at, name?, outside? } | { sid, gone: true }) when a writer is credited with a change or leaves. */
    onHeld(fn) {
      heldListeners.add(fn);
      return () => heldListeners.delete(fn);
    },
    close() {
      for (const t of ending.values()) clearTimeout(t);
      hub.off('message', onMessage);
      hub.off('session', onSession);
      hub.off('removed', onRemoved);
      offChange();
    },
  };
}
