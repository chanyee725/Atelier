import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/* ---------------- Shared Claude limits ---------------- */
// Claude windows are account-wide, so every Dispatch server on this machine reads and writes one
// file, ~/.dispatch/limits.json, next to prefs.json and servers/. Only numbers and reset times go in
// it — no account, email or token. Other servers (older Dispatch) may keep their own keys in it, such
// as `gemini`: this server does not read them but keeps them untouched on write.

export const LIMITS_FILE = path.join(os.homedir(), ".dispatch", "limits.json");
// fable: the weekly window the CLI reports as seven_day_overage_included (models with their own weekly
// bucket, Fable today). Only Fable turns carry it, so it keeps its last value between them.
const EMPTY_CLAUDE = () => ({ five: null, seven: null, fable: null, fiveReset: null, sevenReset: null, fableReset: null, updatedAt: null });
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Keeps the known number fields only; anything else in the input is dropped. */
export function cleanClaude(l) {
  const c = EMPTY_CLAUDE();
  if (l && typeof l === "object") for (const k of Object.keys(c)) c[k] = num(l[k]);
  return c;
}
const newer = (a, b) => (a ?? -Infinity) > (b ?? -Infinity);

/** Keys this server does not know: kept as they are. */
const extras = x => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "claude")) : {});

/** The Claude section with the newer timestamp wins; unknown keys are kept (b over a). */
export function mergeLimits(a, b) {
  const ca = cleanClaude(a?.claude), cb = cleanClaude(b?.claude);
  return { ...extras(a), ...extras(b), claude: newer(cb.updatedAt, ca.updatedAt) ? cb : ca };
}

/**
 * The shared limits file. Writes merge with what is on disk (newest wins) and replace it with a
 * temp file + rename, so concurrent servers never see a half-written file. refresh() (polled by the
 * server) picks up another server's change and emits "change".
 */
export class SharedLimits extends EventEmitter {
  static WAIT_MS = 2000;
  static STALE_MS = 10_000;
  constructor(file = LIMITS_FILE) {
    super();
    this.file = file;
    this.data = { claude: EMPTY_CLAUDE() };
  }

  get claude() { return this.data.claude; }

  async read() {
    try {
      return { data: mergeLimits(JSON.parse(await readFile(this.file, "utf8")), null) };
    } catch (e) {
      return { data: null, missing: e.code === "ENOENT" };
    }
  }

  /**
   * Loads the file. `seed` is an older per-project copy: it is merged in once (newest wins), so the
   * first servers to start after the move fill the shared file with the newest value any had.
   */
  async load(seed = null) {
    const { data } = await this.read();
    this.data = mergeLimits(this.data, data);
    const merged = mergeLimits(this.data, seed);
    if (JSON.stringify(merged) !== JSON.stringify(this.data)) await this.write(seed);
    return this.data;
  }

  /** Re-reads the file if it changed on disk; emits "change" when another server wrote newer values. */
  async refresh() {
    const { data } = await this.read();
    if (!data) return false; // missing or damaged: keep what we have
    const next = mergeLimits(this.data, data);
    const changed = JSON.stringify(next) !== JSON.stringify(this.data);
    this.data = next;
    if (changed) this.emit("change", this.data);
    // Ours is newer than the disk (a write that lost a race): put it back so other servers see it.
    if (JSON.stringify(next) !== JSON.stringify(data)) await this.write({});
    return changed;
  }

  /**
   * Holds ~/.dispatch/limits.json.lock (O_EXCL create) around read → merge → rename, so two servers
   * writing at once cannot replace a newer value with an older one. A lock older than STALE_MS is
   * left over from a crashed server and is taken over; if the lock cannot be had within WAIT_MS the
   * write goes ahead anyway and refresh() repairs the file on its next tick.
   */
  async lock() {
    const lock = this.file + ".lock";
    const until = Date.now() + SharedLimits.WAIT_MS;
    await mkdir(path.dirname(this.file), { recursive: true });
    for (;;) {
      try {
        await (await open(lock, "wx")).close();
        return () => rm(lock, { force: true });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const st = await stat(lock).catch(() => null);
        if (st && Date.now() - st.mtimeMs > SharedLimits.STALE_MS) { await rm(lock, { force: true }); continue; }
        if (Date.now() > until) return async () => {};
        await new Promise(r => setTimeout(r, 5 + Math.random() * 10));
      }
    }
  }

  /** Records new values (each section only if newer) and writes the merged result. */
  async write(patch) {
    this.data = mergeLimits(this.data, patch);
    const unlock = await this.lock();
    try {
      const { data } = await this.read();
      this.data = mergeLimits(this.data, data);
      const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(this.data, null, 2));
        await rename(tmp, this.file);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    } finally {
      await unlock();
    }
    return this.data;
  }

  // A stamp strictly after the one we hold: two updates within the same millisecond must not tie,
  // or mergeLimits (newer wins) would drop the second one.
  stamp(prev) { return Math.max(Date.now(), (prev ?? 0) + 1); }
  setClaude(l) { return this.write({ claude: { ...l, updatedAt: l.updatedAt ?? this.stamp(this.data.claude?.updatedAt) } }); }
}
