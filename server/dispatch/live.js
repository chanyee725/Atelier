// Live "what is this agent doing now" view (issue #728). Built from tool entries as they pass through
// Hub.push(), in memory only: nothing here is written to disk. It keeps metadata only (a short label,
// a file path or a command's first words, times, an error flag), never assistant text, tool input
// bodies or tool output (CLAUDE.md privacy rules).
//
// Changes are sent as a throttled `live` event per session: `{ id, tool, recent, files }`, where
// `recent` and `files` hold only the items added or changed since the last event (upsert by `n` and
// `path`). GET /api/sessions/:id/live gives the full state for a newly opened view or a reconnect.

import path from "node:path";
import { activityOf } from "./hub.js";

export const LIVE_RECENT = 20;
export const LIVE_FILES = 50;
export const LIVE_THROTTLE_MS = 500;

// Gemini (agy) tool names mapped to the Claude names activityOf() knows.
const GEMINI = {
  read_file: "Read", read_many_files: "Read", list_directory: "Glob", glob: "Glob", search_file_content: "Grep",
  write_file: "Write", replace: "Edit", run_shell_command: "Bash",
};
const READS = new Set(["Read", "Grep", "Glob"]);
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "edit"]);
const SHELLS = new Set(["Bash", "shell"]);
const PATH_KEYS = ["file_path", "notebook_path", "absolute_path", "path"];

function parse(text) {
  try { const o = JSON.parse(text); return o && typeof o === "object" ? o : null; } catch { return null; }
}

/** A string field from a (possibly clipped, so unparsable) JSON tool input. */
function field(text, obj, keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === "string") return obj[k];
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (m) { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } }
  }
  return null;
}

/**
 * A path as the view may show it: relative to the session's folder; a path outside it keeps only its
 * last two parts, so home folders and user names never reach the UI.
 */
export function shownPath(p, cwd) {
  if (!p || typeof p !== "string") return null;
  p = p.trim().split("\n")[0];
  if (!p) return null;
  if (!path.isAbsolute(p)) return path.normalize(p).replace(/^(\.\/)+/, "") || null;
  if (cwd) {
    const rel = path.relative(cwd, p);
    if (rel === "") return ".";
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  const parts = p.split(path.sep).filter(Boolean);
  return parts.length ? "…/" + parts.slice(-2).join("/") : null;
}

/** A command's first words (program and subcommand), never its arguments: `npm test`, `git commit`. */
export function commandHead(cmd) {
  const words = String(cmd || "").trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "").split(/\s+/);
  const prog = path.basename(words[0] || "");
  if (!/^[\w.+-]+$/.test(prog)) return null;
  const sub = words[1];
  return sub && /^[a-z][\w-]*$/.test(sub) && sub.length <= 20 ? `${prog} ${sub}` : prog;
}

/**
 * What one tool entry does, for the live view: `{ label, file?, mode?, cmd? }`. `text` is the entry's
 * already masked and clipped text (JSON input, or a Codex shell command / edit list).
 */
export function liveOf(name = "", text = "", cwd = null) {
  const tool = GEMINI[name] || name;
  const obj = parse(text);
  if (SHELLS.has(tool)) {
    const cmd = name === "shell" ? text : field(text, obj, ["command"]) || "";
    return { label: activityOf(tool, cmd), cmd: commandHead(cmd) };
  }
  if (name === "edit") {
    // Codex file_change: one "kind path" per line; the first file is the target.
    const files = String(text).split("\n").map(l => shownPath(l.replace(/^\S+\s+/, ""), cwd)).filter(Boolean);
    return { label: activityOf(name), file: files[0] ?? null, files, mode: "edit" };
  }
  if (READS.has(tool) || EDITS.has(tool)) {
    const file = shownPath(field(text, obj, PATH_KEYS), cwd);
    return { label: activityOf(tool), file, mode: EDITS.has(tool) ? "edit" : "read" };
  }
  return { label: activityOf(name) };
}

export class LiveTracker {
  constructor({ emit, throttleMs = LIVE_THROTTLE_MS, now = () => Date.now() } = {}) {
    this.emitFn = emit || (() => {});
    this.throttleMs = throttleMs;
    this.now = now;
    this.byId = new Map(); // id -> { tool, recent, files, n, calls, dirty, timer, lastSent }
  }

  state(id) {
    let st = this.byId.get(id);
    if (!st) this.byId.set(id, st = { tool: null, recent: [], files: new Map(), n: 0, calls: new Map(),
      dirty: { tool: false, recent: new Set(), files: new Set() }, timer: null, lastSent: 0 });
    return st;
  }

  /** Takes one transcript entry (after masking). Only tool calls and failed tool results count. */
  note(s, entry) {
    if (entry.kind === "tool") {
      const st = this.state(s.id);
      const at = entry.at ?? this.now();
      const info = liveOf(entry.name, entry.text, s.cwd);
      const target = info.file ?? info.cmd ?? null;
      const item = { n: ++st.n, at, label: info.label, target, ...(entry.error ? { error: true } : {}) };
      st.recent.push(item);
      if (st.recent.length > LIVE_RECENT) st.recent.splice(0, st.recent.length - LIVE_RECENT);
      st.dirty.recent.add(item.n);
      if (entry.callId) {
        st.calls.set(entry.callId, item);
        if (st.calls.size > LIVE_RECENT) st.calls.delete(st.calls.keys().next().value);
      }
      // Codex reports a finished call (final), so nothing is "running" after it.
      const next = entry.final ? null : { label: info.label, target, since: at };
      if (next?.label !== st.tool?.label || next?.target !== st.tool?.target) { st.tool = next; st.dirty.tool = true; }
      for (const p of info.files || (info.file ? [info.file] : [])) this.touchFile(st, p, info.mode, at);
      this.schedule(s.id, st);
    } else if (entry.kind === "tool_result" && entry.error && entry.callId) {
      const st = this.byId.get(s.id);
      const item = st?.calls.get(entry.callId);
      if (item && !item.error) { item.error = true; st.dirty.recent.add(item.n); this.schedule(s.id, st); }
    }
  }

  touchFile(st, p, mode, at) {
    const prev = st.files.get(p);
    // An edit stays an edit: a later read of the same file does not hide that it was changed.
    const f = { path: p, mode: prev?.mode === "edit" ? "edit" : mode, at, count: (prev?.count || 0) + 1 };
    st.files.delete(p);
    st.files.set(p, f);
    st.dirty.files.add(p);
    if (st.files.size > LIVE_FILES) {
      // Drop the oldest read first; edits are what the person cares about.
      const victim = [...st.files.values()].find(x => x.mode === "read") || st.files.values().next().value;
      st.files.delete(victim.path);
      st.dirty.files.delete(victim.path);
    }
  }

  /** The turn ended: nothing is running any more. */
  idle(id) {
    const st = this.byId.get(id);
    if (!st || !st.tool) return;
    st.tool = null; st.dirty.tool = true;
    this.schedule(id, st);
  }

  drop(id) {
    const st = this.byId.get(id);
    if (st?.timer) clearTimeout(st.timer);
    this.byId.delete(id);
  }

  schedule(id, st) {
    if (st.timer) return;
    const wait = this.throttleMs - (this.now() - st.lastSent);
    if (wait <= 0) return this.flush(id);
    st.timer = setTimeout(() => { st.timer = null; this.flush(id); }, wait);
    st.timer.unref?.();
  }

  flush(id) {
    const st = this.byId.get(id);
    if (!st) return;
    const d = st.dirty;
    if (!d.tool && !d.recent.size && !d.files.size) return;
    const ev = { id };
    if (d.tool) ev.tool = st.tool;
    if (d.recent.size) ev.recent = st.recent.filter(x => d.recent.has(x.n)).map(x => ({ ...x }));
    if (d.files.size) ev.files = [...d.files].map(p => st.files.get(p)).filter(Boolean).map(f => ({ ...f }));
    st.dirty = { tool: false, recent: new Set(), files: new Set() };
    st.lastSent = this.now();
    this.emitFn(ev);
  }

  /** Full state for one session: `{ tool, recent, files }` (files newest first). */
  snapshot(id) {
    const st = this.byId.get(id);
    if (!st) return { tool: null, recent: [], files: [] };
    return { tool: st.tool, recent: st.recent.map(x => ({ ...x })), files: [...st.files.values()].reverse().map(f => ({ ...f })) };
  }
}
