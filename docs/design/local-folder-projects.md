# Local folder projects (E554, #721)

새 프로젝트 picks a folder on the PC that runs the server and adds it as a project. The app is often opened from
another device (over the tailnet), so the browser's own file picker is no use: the dialog browses the server's
folders through the API.

## What a linked project is

A project is still a top-level folder of the workspace (design doc 6 §1). Linking a folder creates

```
<workspace>/<name>/                 the project: its Drawing documents live here, as for any project
<workspace>/<name>/.project.json    { "name": "<folder name>", "linkedPath": "<absolute real path>" }
```

- `<name>` is the linked folder's base name, cleaned to the store's folder-name rules (no leading dot, no slashes or
  control characters, no `.dpx.json` ending), with ` 2`, ` 3`, ... added when a project or root document already
  uses it.
- The linked folder itself is never written to. Documents stay in the workspace, so the server's write rules do not
  change: it still writes only inside the workspace, its git project and `~/.dispatch/`.
- `.project.json` holds only the folder name and its path. No owner, user name or email is read or stored.
- The same folder can be linked once; a second try answers 409 with the existing project's path. Links run one at a
  time per workspace, so two requests for the same folder at once still make one project.
- The workspace itself (or any folder inside it) and the filesystem root cannot be linked.
- Refusals carry a stable `code` next to the English `error`: `already_linked` (409), `inside_workspace` (400),
  `filesystem_root` (400). The client branches on `code`, never on the message.

`GET /api/workspace/projects` returns `linkedPath` (or `null`) for each project; the project 개요 tab shows it as
연결한 폴더.

## API

### `GET /api/local-folders?path=<absolute path>`

Read-only. Without `path` it starts at the server user's home folder.

```json
{ "path": "/home/u/code", "parent": "/home/u", "home": "/home/u", "root": "/", "sep": "/",
  "folders": ["api", "web"], "truncated": false }
```

- Folder names only: files are not listed and nothing is opened or read, so no file contents (`.env` or otherwise)
  ever leave the machine.
- Hidden entries (names starting with `.`) are skipped.
- Symlinks inside the folder are skipped without being followed (the readdir entry type says "symlink"). A symlink
  in the requested path itself is resolved with `realpath`, and the answer carries the real path.
- At most 2000 names; `truncated: true` says the list was cut.
- Errors: relative path, NUL byte or a file → 400; missing → 404; no permission → 403. Messages never contain the
  path (the dialog shows Korean copy by status).

### `POST /api/workspace/local-project` `{ "path": "<absolute path>" }`

Needs `x-drawing: 1` like every write. Answers `201 { path, name, linkedPath }`, where `path` is the new project's
workspace path. Closed in project mode, like the other document writes. The `.project.json` is created with
`O_EXCL | O_NOFOLLOW` in the folder the store has just made.

## Web

`FolderPickerDialog` (opened by 새 프로젝트 in the sidebar) replaces the old name prompt; it still makes blank
projects:

- Up and home buttons, a breadcrumb (`nav` > `ol`, the current folder marked `aria-current="location"`), then the
  sub-folders as buttons: one click goes into a folder.
- 이 폴더 선택 adds the folder shown (the root cannot be picked). On success the dialog closes, the tree is refreshed
  and the new project opens; the "created" toast is raised after the dialog is gone.
- 빈 프로젝트 switches the dialog to a name form (label + input, native form submit, so Enter while composing Korean
  does not submit). 만들기 makes a plain top-level folder through `POST /api/folder`, as before E554; 폴더 고르기
  goes back to the folder browser.
- Errors show as an alert line in the dialog (Korean, by status and `code`).

## Not in this change

- Agent sessions still run in the git project that holds the workspace. Running a linked project's sessions in its
  linked folder (as their git project) needs a change to the Dispatch module and to the CLAUDE.md write rules, so it
  is left for a follow-up.
- Creating an empty project by name only (the old prompt) is gone from the sidebar; documents can still be created
  in any project as before.

## CLAUDE.md (proposed, pending the user's approval)

Listing folder names outside the workspace is a read, not a write, so the current write rule still holds. To make
the new read explicit, the proposed addition to the server rule in CLAUDE.md is:

> To add a project, it may list sub-folder names (never files, file contents or hidden entries, never following
> symlinks) of folders on the server machine, and a project may record a linked local folder path in its
> `.project.json` inside the workspace; it never writes into the linked folder.

This wording is not applied in this change.
