# Workspace API (E1)

Paths are relative to the workspace, `/`-separated. No `..`, absolute paths, hidden (`.x`) names or symlinks. A file path may omit the `.dpx.json` extension.

| Route | Notes |
|---|---|
| `GET /api/tree` | folders first; unreadable files are listed with `title:''`, `revision:null`; files with a `plan` carry `pipeline: {state:'plan'}` |
| `GET /api/workspace/projects` | projects view, see below (`/api/projects` belongs to Dispatch) |
| `GET /api/workspace/agents?project=` | live agent list, see below; `project` (a top folder) is optional |
| `GET /api/file?path=` / `POST /api/file {path,title?,document?,canvas?,blocks?,plan?}` | create is exclusive (409 if it exists); optional content (a template) is checked like a save (400) |
| `PUT /api/file?path=` `{revision,title,document,canvas,blocks,plan?}` | whole-file save; 409 `{revision}` when `revision` is not the current one |
| `PATCH /api/file/plan?path=` `{revision?,ops}` | step-level plan edit, see below; returns `{path,revision,plan}` |
| `DELETE /api/file?path=` | files only. `?path=sub` never touches a folder `sub/` |
| `POST /api/folder {path}` / `DELETE /api/folder?path=` | folders only; delete is recursive |
| `POST /api/move {from,to,type?,withSubdocs?}` | rename = move |

## Projects view

`GET /api/workspace/projects` → `{ projects: Project[], loose: DocNode[] }` (design: `docs/design/dispatch-integration/6-app-shell-projects.md` §1). Read only; built from the same walk as `/api/tree`.

- **Project** = a top-level folder: `{ path, name, icon, description, created, modified, count, docs }`. An optional `<folder>/.project.json` gives `name` (max 100 characters), `icon` (max 16) and `description` (max 500); other fields, non-strings, broken JSON, files over 16 KB and symlinks are ignored. Without it `name` is the folder name, `icon` null, `description` ''. Sorted by `name`.
- **DocNode** = `{ type: 'doc'|'group', path, name, title?, revision?, created, modified, count, children }`. A folder `X/` next to `X.dpx.json` holds X's sub-documents (`children`); a folder with no such file is a `group` (its `path` is the folder). `count` is the number of documents below. Sorted by `name`.
- `loose` = files right in the workspace root (미분류). They are not nested: a top-level folder is always a project.
- Times are ISO strings. `modified` is the file's mtime (a group's or project's newest below). `created`: saves replace the file, so its birth time is lost; a file made through the API gets a `born` mark (ms) in its history folder, which moves with it and goes through the trash. For files made outside the app it is the earliest of the oldest kept snapshot and the file's own times.

## Live agents and who is writing (E528)

- `GET /api/workspace/agents[?project=<top folder>]` → `{ agents: AgentPresence[] }` (type: `shared/dispatch/agent-presence.ts`): the agent sessions working right now (status `starting`, `running` or `waiting`) with `name`, `role`, `model`, `state`, `project` and `file`, the file each one edited last. Newest activity first. The SSE `agents` event carries the same `{ agents }` for the whole workspace, once on connect and on every change. Memory only; nothing about it is written to disk.
- A session counts for a project when the project is its own folder or the file it holds is in that folder.
- Outside API writers (another Dispatch, a script) may name themselves with the optional header `x-drawing-session: <name>` on `PUT /api/file`, `POST /api/file` and `PATCH /api/file/plan`. Their cursor (`cursor` event, `sid` `outside:<name>`) then shows that name instead of `에이전트`, and they are listed with `outside: true` for 2 minutes after their last write. When a session started by this Drawing could have made the change, the change stays that session's, whatever name the header sends. The name is cleaned: control and format characters, `<`, `>`, `&`, quotes, backticks and backslashes are dropped, spaces collapsed, at most 32 characters. It is kept in memory only, never on disk or in logs. Use a session name, never a real name or an email. Writes still need `x-drawing: 1`.
- An unnamed write of a file whose last outside writer named itself within 2 minutes keeps that writer's name (#653), so a writer that sends the header only on some writes does not turn into `에이전트`.
- A Drawing session keeps its own name on every edit it makes (#653): the server credits a change to the session whose running (or just finished) tool call names the file, by its full path, by `/api/file?path=…` without `.dpx.json` or partly encoded, or by running a script the session wrote that names the file (`bash save.sh`). A call that runs for minutes still counts. A file the session edited in the last 10 minutes stays its own while one of its edit-capable calls runs, when no other session claims it. A save from the page itself is never an agent's.
- SSE `cursor` events of a Drawing session carry `live: true` (the page keeps the cursor at its last place until a `{ sid, gone: true }` event: the session ended or left) and `status`, a short label such as `다이어그램 작성 중…`, `글 작성 중…`, `표 작성 중…`, `코드 읽는 중…` or `대기 중` (shared/dispatch/agent-status.ts). Outside writers' cursors (`outside:…`) have neither and fade after a few seconds.
- SSE `cursor-status` `{ sid, status }`: the status label of a session with a cursor changed (not an edit: the page keeps the cursor where it is). A page that connects or reconnects is sent the last `cursor` event of every session still at work. Labels come from the tool call's kind and target only; they are kept in memory, never stored.

## Delete and move rules

- `DELETE /api/file` always normalizes to `<path>.dpx.json` and removes that file only. `DELETE /api/folder` removes a directory only. Neither falls back to the other kind (404).
- `move` without `type`: a **file wins**. `from` is tried as a file (`<from>.dpx.json`) first, then as a folder. Send `type: "folder"` (or `"file"`) to be explicit when a file and a folder share a name.
- Moves never overwrite (409), and a folder cannot move into itself (400).
- `withSubdocs: true` (with `type: "file"` only) moves a document's sub-documents folder (`X/` next to `X.dpx.json`) along with it. Both targets are checked before anything moves (409 / 400 into its own sub-documents), and the file goes back if the folder move fails. Two `tree` events are sent, one per path.

## Revisions and outside edits

- Every save bumps `revision`. A stale save gets 409 with the current revision. A plan patch bumps it too.
- If a file is edited outside without raising its `revision`, the server raises it (`known revision + 1`) the next time it sees the change (watcher, GET or PUT). So a client holding the old revision gets 409, and re-reading gives the new revision.
- SSE `workspace` events (`create`, `change`, `delete`, `tree`): outside changes send all of them (`change` carries the raised `revision`). Through the API only deletes (`delete` for a file, `tree` for a folder) and moves (`tree`, with `path` = the new path and `from` = the old one) send an event, so other tabs update; saves and creates stay silent. A plan patch sends `change` with the new `revision`, so an open, clean tab reloads and a tab with unsaved edits gets 409 on its next save.
- Saving rewrites the file from the fields the server knows (`normalizeContent`), so fields added by a newer version or by hand are dropped. A file with a newer `version` is never rewritten.
- If the server cannot watch the folder (for example EACCES or the OS watch limit), it logs one line and goes on without outside-change events.

## Block `layout`

A block may carry `layout`, the node positions a user moved on top of the automatic layout (design: `docs/design/block-drag-edit.md`). Files that have it are format `version` 3; older files are read as they are and stored as v3 on the next save. An older server treats v3 files as read-only (422).

```jsonc
"layout": { "v": 1, "basis": { "type": "cloud-architecture", "direction": "right", "count": 3 },
            "items": { "API": { "cx": 212.5, "cy": 96, "parent": "VPC" } } }
```

- Optional. Without it (or with empty `items`) the block draws with the automatic layout.
- `v`: integer >= 1. `items`: at most 2000 entries; keys 1-200 characters, never `__proto__`; each value needs numeric `cx`, `cy` and a string `parent` (at most 200 characters). `basis`: string `type` and `direction` (at most 200 characters each), integer `count` >= 0. `basis.type` is the parsed diagram type (for example `cloud-architecture`), not the block `type`.
- A `PUT` with an invalid `layout` gets 400. A stored file whose `layout` is invalid still reads; only that layout is dropped.
- Unknown fields inside a `v` 1 layout are dropped. A layout with a `v` newer than the server knows is kept verbatim (only checked to be an object with an integer `v`), so a newer client's layout is never wiped.

## Block `codeRefs`

A block may carry `codeRefs`: where in the code each node's feature lives (design: `docs/design/code-linked-nodes.md` §1; how agents write it: `docs/agent-diagrams.md`). Keys are node names, like `layout.items`. Files that have it are format `version` 5; older files read as they are and are stored as v5 on the next save. An older server treats v5 files as read-only (422). (The block's own `code` field stays the diagram-as-code text.)

```jsonc
"codeRefs": { "v": 1, "nodes": { "로봇 데이터 녹화": { "summary": "카메라·관절 값을 저장해요",
  "refs": [ { "path": "src/record/recorder.py", "start": 42, "end": 118, "symbol": "Recorder.record_episode", "note": "에피소드 단위 저장" } ] } } }
```

- Optional. `v`: integer >= 1. `nodes`: at most 2000 entries; keys 1-200 characters, never `__proto__`; each value has optional `summary` (at most 500 characters) and `refs` (array, at most 20).
- Ref: `path` (1-500 characters, repo-relative, `/`-separated, no leading `/`, no `..` or empty segment, no backslash or NUL), `start` integer >= 1, optional `end` integer >= `start` with `end - start` <= 2000, optional `symbol` (at most 200) and `note` (at most 300).
- A `PUT` with invalid `codeRefs` gets 400. A stored file whose `codeRefs` is invalid still reads; only those refs are dropped. Unknown fields inside a `v` 1 value are dropped; a newer `v` is kept verbatim (only checked to be an object with an integer `v`).
- Diagram-as-code shorthand: a node attribute `code: "path[:start[-end]][#symbol]; ..."` (`;`-separated; a bare path means line 1) is parsed into `node.code` by `shared/dsl`. `mergeCodeRefs` (`shared/render/block-code.ts`) merges it with the block's entry: the block wins (summary and refs stay), the DSL adds refs the block does not have (same path, range and symbol), at most 20 per node. Bad pieces are skipped with a warning.
- Entries whose key is no node of the block's code (a node being renamed) are stored as they are, like `layout.items`, so autosave never loses data; the 2000-entry limit applies. Cleaning them up is an explicit action in the web panel, not a save side effect.
- Markdown export strips `code:` attributes from the diagram code it prints (`stripCodeAttrs`); Eraser's handling of the attribute is not verified. Only flowchart and cloud-architecture accept `code:`; sequence and ERD still warn.
- Converting a block to free-form shapes copies a node's merged entry to the shape as `customData.codeRefs` (`{summary?, refs}`).

## Pipeline `plan`

A file may carry a top-level `plan`: the steps of an agent pipeline drawn in one of its diagram blocks (design: `docs/design/dispatch-integration/2-file-format-and-live-overlay.md` §3). Files that have it are format `version` 4 or newer; older files read as they are and are stored in the current version on the next save. An older server treats newer files as read-only (422). Rules live in `shared/dispatch/plan.ts` (`planProblem`, `cleanPlan`), shared by the server and the web.

```jsonc
"plan": { "v": 1, "block": "b_pipe", "defaults": { "provider": "claude", "perm": "acceptEdits" },
          "steps": [ { "id": "impl", "node": "impl", "role": "impl", "n": 2, "task": "Implement section 2." },
                     { "id": "merge", "node": "merge", "role": "lead", "gate": "manual", "after": ["impl"] } ] }
```

- Optional. A file without `plan` is an ordinary drawing. Saving without `plan` removes it.
- `v`: integer >= 1. `block`: the diagram block id, 1-200 characters. `steps`: at most 200.
- A step needs `id` or `node` (1-200 characters each); the missing one is filled from the other. Ids are unique.
- `role`, `model`, `effort`, `provider`: strings of 1-200 characters. `perm`: `manual`, `acceptEdits`, `auto` or `plan` (nothing looser). `n`: integer 1-4. `task`: at most 20 000 characters, instructions only (no transcripts, tokens, keys or personal data). `gate`: `auto` or `manual`. `after`: step ids (at most 200).
- `defaults` takes the same fields and fills them into steps that omit them.
- A `PUT` or `POST` with an invalid `plan` gets 400. A stored file whose `plan` is invalid still reads; only the plan is dropped. Unknown fields in a `v` 1 plan are dropped; a plan with a newer `v` is kept verbatim (only checked to be an object with an integer `v`) and cannot be patched (422).
- Storage does not check that `block` exists, that `after` names real steps or that there is no cycle: a person deleting the diagram must still be able to save. Those make the plan not runnable; `planOrder` (`shared/dispatch/plan.ts`) reports them. Order: a step's `after`, or else the diagram edges between step nodes (edges to other nodes are ignored). A step whose node is missing from the diagram still runs.

`PATCH /api/file/plan?path=` `{revision?, ops}` re-reads the file under the store lock, applies the ops in order, validates and writes (`revision + 1`, the previous file kept in history). With `revision`, a stale one gets 409. Up to 200 ops; any failure leaves the file unchanged (400):

| Op | Effect |
|---|---|
| `{op:'plan', block?, defaults?}` | Set plan-level fields. Starts a plan (needs `block`) when the file has none. `defaults: null` removes them. |
| `{op:'add', step, before?}` | Insert a step before step `before`, or at the end. |
| `{op:'set', id, step}` | Change step `id`'s fields; `null` removes a field. A new `id` is renamed in every `after` and keeps the node link. |
| `{op:'remove', id}` | Remove step `id` and drop it from every `after`. |

## Code window `GET /api/code`

Read-only. `GET /api/code?path=<repo-relative>&start=<n>&end=<n>` returns `{path, start, end, total, lines, language, truncated?}`: the requested range plus up to 20 context lines each side, at most 400 lines, clamped to the file. `language` comes from the extension (for highlighting only); `total` is the file's line count.

- The response `start`/`end` are **not** the requested range: they are the first and last line number of the returned `lines` (`lines[i]` is line `start + i`), context included. The query `start`/`end` are the range asked for. A client that highlights the requested range keeps its own query values.

- Range: `start` missing → line 1; `end` missing → `start` (whole file when both are missing). A range longer than 400 lines is cut at 400 lines from its start (no context) and the response has `truncated: true`.
- Root: the git project holding the workspace. None: 404 `{error:'no-project'}`.
- Git-tracked files only (`git ls-files --error-unmatch`, no shell): untracked or gitignored → 404 `{error:'not-tracked'}`.
- 400: path with a `%` left after the one decode (double encoding), absolute path, `..`, NUL, backslash, longer than 4096 characters or more than 256 segments, a directory (a symlinked one too), `start`/`end` not an integer, `< 1`, or `start > end`.
- 416: `start` past the last line.
- 403: realpath outside the root (symlink escape), and, case-insensitively, any `.git` segment, segments starting with `.env`, and key/secret files (`*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `credentials*`, `secrets*`).
- 404 missing, 413 over 1 MB (exactly 1 MB is fine; the read itself stops at 1 MB + 1 byte, so a file growing after the size check is still refused), 415 binary (NUL in the first 8 KB).
- Git runs with `cwd` = the root. The file is opened without following a final symlink and the open handle is checked to be the file that passed the checks (same path via `/proc/self/fd` on Linux, same dev/ino), so a symlink swapped in between is 404.
- Nothing is written, cached on disk or logged (no content, no absolute paths).

## Errors

Filesystem conflicts map to 400/409 (`ENOTDIR`, `EISDIR`, `EEXIST`, `ENOTEMPTY`). Responses and server logs never contain absolute paths.
