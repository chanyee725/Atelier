---
name: atelier-files
description: Manage Atelier documents — list projects and files, create folders, rename, move or delete files and folders, see and restore earlier versions, bring back deleted files from the trash, and read a code range from the project. Use for "문서 목록", "이름 바꿔줘", "옮겨줘", "지워줘", "예전 버전으로 되돌려줘", "휴지통에서 살려줘", "이 코드 보여줘". Writing content is atelier-doc; sorting into area folders is atelier-organize.
---

# Atelier files

`<plugin-root>` is two levels above this file's folder. Calls go through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]`. Paths are workspace-relative and `/`-separated; a file path may omit `.dpx.json`; no `..`, hidden names or absolute paths. Full rules: `docs/workspace-api.md` in the Atelier repo.

## Steps

1. Look. `GET /api/tree` (folders first; `pipeline`, `questions` marks) or `GET /api/workspace/projects` (top folders as projects, `loose` root files). One file: `GET '/api/file?path=<file>'`.
   Done when: you have the exact path to act on.
2. Change the tree.
   - New folder: `POST /api/folder '{"path":"<folder>"}'`. New file: `POST /api/file '{"path":"<file>","title":"<title>"}'` (409 when it exists).
   - Rename or move: `POST /api/move '{"from":"<old>","to":"<new>"}'`. Add `"type":"file"` or `"folder"` when both share a name, `"withSubdocs":true` to take a document's sub-documents folder along. Never overwrites (409).
   - Delete (ask first, name what goes): `DELETE '/api/file?path=<file>'` (to the trash for 30 days) or `DELETE '/api/folder?path=<folder>'` (recursive).
   Done when: `GET /api/tree` shows the result.
3. Versions. `GET '/api/history?path=<file>'` → `versions[]` (`id`, `time`, `bytes`); `GET '/api/history/version?path=<file>&id=<id>'` → that version. Keep a version now: `POST '/api/history?path=<file>'`. Restore: take a snapshot first, then `PUT '/api/file?path=<file>'` the old version's `title`, `document`, `canvas`, `blocks` (and `plan`) with the current `revision`.
   Done when: the file reads as the chosen version and the previous state is in the history.
4. Trash. `GET /api/trash` → `items[]` (`id`, `path`, `deletedAt`); restore: `POST /api/trash/restore '{"id":"<id>"}'` (409 when the path is taken: move that file away first).
   Done when: the file is back in `GET /api/tree`.
5. Code window (read only). `GET '/api/code?path=<repo-relative>&start=<n>&end=<n>'` → `lines` from response `start` (with up to 20 lines of context). Git-tracked files only; secrets (`.env*`, keys) are refused.
   Done when: you quote the lines the user asked about.

## Rules

- Delete and folder delete only with the user's yes. Restore over a file only after a snapshot.
- Responses never contain absolute paths; do not add any to documents.
