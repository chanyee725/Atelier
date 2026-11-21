# Atelier plugin

One folder, two hosts: Claude Code (`.claude-plugin/`) and Codex CLI (`.codex-plugin/`, marketplace in `.agents/plugins/`). Both load the same `skills/`. The `dispatch`, `dispatch-team` and `dispatch-update` skills are replaced by these `atelier-*` skills.

## Install

- Claude Code: `/plugin marketplace add <atelier>/plugin`, then `/plugin install atelier@atelier`.
- Codex: `codex plugin marketplace add <atelier>/plugin`, then `codex plugin add atelier@atelier`.

Both hosts copy the plugin into a cache. `scripts/start.sh` and `atelier-setup` then find the server in `DRAWING_HOME` (an Atelier checkout), else in the release `atelier-update` installed (`${DRAWING_INSTALL_BASE:-~/.dispatch/drawing}/current`). Codex's default sandbox has no network, loopback included: run the API skills with network allowed.

## Skills

| Skill | For |
|---|---|
| `atelier-setup` | start, stop, restart the server; connect Claude, Codex, Gemini |
| `atelier-update` | update to the latest release and restart servers |
| `atelier-status` | live board: sessions, tasks, limits |
| `atelier-team` | a lead plus teammates for normal or risky work |
| `atelier-quickfix` | a 1–3 file change, one session, straight to a PR |
| `atelier-session` | one session: start, message, interrupt, kill, permission, transcript, diff |
| `atelier-plan` | write a plan with a step diagram |
| `atelier-run` | start (after the user's yes), stop, resume, reopen, duplicate a plan; run records |
| `atelier-doc` | write a document |
| `atelier-diagram` | diagram-as-code blocks with code references |
| `atelier-canvas` | free-form drawing on the canvas (Excalidraw elements) |
| `atelier-files` | tree, folders, move, delete, versions, trash, code window |
| `atelier-questions` | questions in documents: ask, read, answer |
| `atelier-organize` | sort documents into area and feature folders |
| `atelier-settings` | usage, branches, timeline, limits, guard and team settings, providers, workspace folder |

The API skills call the server through `scripts/api.sh [-C <project>] METHOD /api/... [BODY]`: it finds the port (`<project>/.atelier/server.port`, else `DRAW_PORT`, else 4330), talks to 127.0.0.1 only and adds `x-drawing: 1` (and `x-drawing-session: $DRAWING_SESSION` when set) to writes.

## /atelier-agents

`/atelier-agents` (Claude Code) opens a pane beside the chat that follows Atelier's agent teams: 5-hour and weekly usage, each lead's status and model, its task board (stage, title, ETA, stuck), its team and the PR of each issue. It reads `GET /api/agents/summary` from the project's server on 127.0.0.1 every few seconds (read only, metadata only) and keeps a one-line summary in the status line. When the server is down it shows offline. Claude Code ships `/agents` itself, so the command carries the `atelier-` prefix.
