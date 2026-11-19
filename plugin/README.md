# Atelier plugin

The `dispatch`, `dispatch-team` and `dispatch-update` skills are replaced by the `atelier-*` skills in `skills/` (`atelier-setup`, `atelier-team`, `atelier-update`, …).

## /atelier-agents

`/atelier-agents` opens a pane beside the chat that follows Atelier's agent teams: 5-hour and weekly usage, each lead's status and model, its task board (stage, title, ETA, stuck), its team and the PR of each issue. It reads `GET /api/agents/summary` from the project's server on 127.0.0.1 every few seconds (read only, metadata only) and keeps a one-line summary in the status line. When the server is down it shows offline. Claude Code ships `/agents` itself, so the command carries the `atelier-` prefix.
