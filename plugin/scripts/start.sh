#!/usr/bin/env bash
# Starts the Atelier server for another git project, in project mode (Dispatch run screen only).
#   start.sh <project>
# Workspace = <project>/atelier (created when missing; an older <project>/pipelines is moved there once, #773).
# The port is kept in <project>/.dispatch/server.port (its pid in server.pid, which stop.sh reads; both written only
# once the server is ready, a failed start leaves the old files alone; reusing a server rewrites server.pid from the
# lock); a server that already answers there is reused only when <project>/atelier/.drawing/server.lock names it
# (live pid, same port), so another project's server on a recycled port is never mistaken for ours.
# Port order (#773): remembered live server, else $ATELIER_PORT (deprecated aliases $DRAW_PORT, then $DISPATCH_PORT;
# team.sh and restart.sh pass it), else "port" in ~/.dispatch/drawing.json, else 4000. One port for the app, the API,
# the team sessions and the MCP endpoint. When that port is taken by anything else the start fails with a clear
# message; it never moves to another port. No ~/.dispatch/servers registry is written.
# The server binds 127.0.0.1 only. Prints the URL on stdout; nothing else is written outside the project.
set -euo pipefail

project=${1:-}
[ -n "$project" ] && [ -d "$project" ] || { echo "Usage: start.sh <project>" >&2; exit 1; }
project=$(cd "$project" && pwd -P)
top=$(git -C "$project" rev-parse --show-toplevel 2>/dev/null) || { echo "Not a git project: $project" >&2; exit 1; }
[ "$(cd "$top" && pwd -P)" = "$project" ] || { echo "Pass the git project's top folder: $top" >&2; exit 1; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
home=${DRAWING_HOME:-$(cd "$here/../.." && pwd -P)}
[ -f "$home/server/index.js" ] || { echo "Drawing server not found in $home (DRAWING_HOME must be a Drawing checkout)" >&2; exit 1; }

# shellcheck source=server-check.sh
source "$here/server-check.sh"

workspace=$project/atelier
state=$project/.dispatch
portfile=$state/server.port
mkdir -p "$state"

# One-time move of the old project folder (#773). Refused while an older server still runs on it.
old_ws=$project/pipelines
if [ -d "$old_ws" ] && [ ! -L "$old_ws" ] && [ ! -e "$workspace" ]; then
  old_pid=$(tr -dc '0-9' < "$state/server.pid" 2>/dev/null || true)
  if [ -n "$old_pid" ] && is_our_server "$old_pid" "$old_ws"; then
    echo "An older Atelier server (pid $old_pid) still runs on $old_ws. Stop it first (atelier-setup stop.sh), then start again." >&2
    exit 1
  fi
  mv "$old_ws" "$workspace"
  echo "Moved $old_ws to $workspace" >&2
fi
mkdir -p "$workspace"

lockfile=$workspace/.drawing/server.lock

# Succeeds only when OUR server answers on $1: /api/info says project mode on "atelier" (every
# project-mode server says that), and our workspace lock names a live pid listening on that same port.
# With $2, the lock's pid must also be that pid (the server we just started).
ours() {
  node -e '
    const http = require("node:http");
    const fs = require("node:fs");
    const [port, lockfile, want] = process.argv.slice(1);
    let lock;
    try { lock = JSON.parse(fs.readFileSync(lockfile, "utf8")); } catch { process.exit(1); }
    if (!lock || String(lock.port) !== port || !Number.isInteger(lock.pid) || lock.pid <= 0) process.exit(1);
    if (want && String(lock.pid) !== want) process.exit(1);
    try { process.kill(lock.pid, 0); } catch (e) { if (e.code !== "EPERM") process.exit(1); }
    const req = http.get({ host: "127.0.0.1", port: Number(port), path: "/api/info", timeout: 1500 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { try { const i = JSON.parse(b); if (i.mode === "project" && i.workspace === "atelier") { if (!want) { process.stdout.write(lock.pid + "\n", () => process.exit(0)); return; } process.exit(0); } process.exit(1); } catch { process.exit(1); } });
    });
    req.on("error", () => process.exit(1)); req.on("timeout", () => req.destroy());
  ' "$1" "$lockfile" "${2:-}"
}

port=$(tr -dc '0-9' < "$portfile" 2>/dev/null || true)
if [ -n "$port" ] && reused=$(ours "$port"); then
  # Reusing: rewrite server.pid with the lock's pid so stop.sh/update.sh still find it.
  [ -n "$reused" ] && echo "$reused" > "$state/server.pid"
  echo "http://127.0.0.1:$port/dispatch"
  exit 0
fi

# The port: environment, else the saved setting, else 4000. Never another one.
port=${ATELIER_PORT:-${DRAW_PORT:-${DISPATCH_PORT:-}}}
if [ -z "$port" ]; then
  port=$(node -e '
    const fs = require("node:fs");
    try {
      const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).port;
      if (Number.isInteger(p) && p > 0 && p <= 65535) console.log(p);
    } catch {}
  ' "${HOME:-/nonexistent}/.dispatch/drawing.json")
fi
port=${port:-4000}
[[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || { echo "Bad port: $port (ATELIER_PORT must be 1-65535)" >&2; exit 1; }
if reused=$(ours "$port"); then
  [ -n "$reused" ] && echo "$reused" > "$state/server.pid"
  echo "$port" > "$portfile"
  echo "http://127.0.0.1:$port/dispatch"
  exit 0
fi
node -e '
  const s = require("node:net").createServer();
  s.once("error", () => process.exit(1));
  s.listen(Number(process.argv[1]), "127.0.0.1", () => s.close(() => process.exit(0)));
' "$port" || {
  echo "Port $port is already in use by another app (or another project's Atelier server). Stop it, or start on another port: ATELIER_PORT=<port> $0 $project" >&2
  exit 1
}
log=$state/server.log
ATELIER_PORT=$port DRAW_PORT= DISPATCH_PORT= nohup node "$home/server/index.js" --project-mode "$workspace" >"$log" 2>&1 &
pid=$!

for _ in $(seq 1 100); do
  ours "$port" "$pid" && { echo "$pid" > "$state/server.pid"; echo "$port" > "$portfile"; echo "http://127.0.0.1:$port/dispatch"; exit 0; }
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
echo "Server did not start; see $log" >&2
kill "$pid" 2>/dev/null || true
exit 1
