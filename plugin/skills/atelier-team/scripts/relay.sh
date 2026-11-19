#!/usr/bin/env bash
# Hand a lead's queue to a fresh team, then remove the old team (one team per issue keeps contexts short).
#   relay.sh <project-dir> <old-lead-name-or-id> <preset> "<task for the new team>"
# Run by the lead as its last step after its issue's PR merged, or by the main session.
# Order: the new team is started first (team.sh); only when that worked are the old lead's teammates and
# then the old lead removed (POST /api/sessions/<id>/remove; a worktree with uncommitted work is kept).
# An empty task means the queue is done: the old team is removed and no new team starts.
# Port: DISPATCH_PORT, else <project>/.atelier/server.port. DISPATCH_TEAM_SH overrides team.sh (tests).
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
project="${1:?usage: relay.sh <project-dir> <old-lead-name-or-id> <preset> \"<task>\"}"
lead="${2:?old lead name or id}"
preset="${3:?preset: small | risky | standard | ui | full}"
task="${4-}"
port="${DISPATCH_PORT:-$({ tr -dc '0-9' < "$project/.atelier/server.port"; } 2>/dev/null || true)}"
[ -n "$port" ] || { echo "No Atelier server port for $project (set DISPATCH_PORT)" >&2; exit 1; }
url="http://127.0.0.1:$port"
team_sh="${DISPATCH_TEAM_SH:-$here/team.sh}"

state="$(curl -sf "$url/api/state")" || { echo "Atelier is not running at $url" >&2; exit 1; }
# Old team: the lead's children first, the lead last, so its own Bash call (this script) is cut only at the end.
ids="$(node -e '
  const [raw, lead] = process.argv.slice(1);
  const st = JSON.parse(raw);
  const l = st.sessions.find((s) => s.canSpawn && (s.id === lead || s.name === lead));
  if (!l) { console.error(`No lead named "${lead}". Leads: ${st.sessions.filter((s) => s.canSpawn).map((s) => s.name).join(", ") || "none"}`); process.exit(1); }
  for (const s of st.sessions) if (s.parent === l.id) console.log(s.id);
  console.log(l.id);
' "$state" "$lead")"

if [ -n "$task" ]; then
  DISPATCH_PORT="$port" "$team_sh" "$project" "$preset" "$task" || { echo "New team did not start; the old team is kept." >&2; exit 1; }
fi

rc=0
while read -r id; do
  [ -n "$id" ] || continue
  curl -sf -X POST "$url/api/sessions/$id/remove" -H 'content-type: application/json' -H 'x-dispatch: 1' -d '{}' >/dev/null \
    || { echo "Could not remove session $id" >&2; rc=1; }
done <<<"$ids"
exit $rc
