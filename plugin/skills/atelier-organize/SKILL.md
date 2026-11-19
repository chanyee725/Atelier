---
name: atelier-organize
description: Sort an Atelier project's documents into area and feature folders taken from the project's own code structure (web/, server/, packages, apps) — no fixed list, no "pipelines" folder. Use for "폴더 정리해줘", "문서 분류해줘", "프로젝트 구조대로 나눠줘", before a lead's first plan in a project, or when plans and docs pile up at the top.
---

# Atelier organize

Atelier keeps one tree per project: **area → feature → documents**.

```
<workspace>/
  Web/                    area: a top-level part of the code
    이슈-대시보드/          feature: one piece of work
      계획.dpx.json         the lead's plan (when there is one)
      화면-흐름.dpx.json     other docs and diagrams (optional)
  Server/
    단일-폴더-저장/
      계획.dpx.json
```

The workspace is the folder the server serves (`GET /api/info` → `workspace`). The API is in `docs/workspace-api.md` of the Atelier repo. Every non-GET request needs `x-drawing: 1`.

## Steps

1. Read the project's structure, not the workspace. List the top-level folders of the git project and one level inside the main ones (`web/src`, `server`, `packages/*`, `apps/*`, `services/*`). Skip `node_modules`, `test`, `dist`, `build`, hidden folders and the workspace itself.
   Done when: you can name 2–6 parts of the code, each with the folder it comes from.
2. Pick the areas. One area per part, named after it in short English PascalCase (`web/` → `Web`, `server/` → `Server`, `apps/admin` → `Admin`). Reuse an area that already exists in the workspace (`GET /api/tree`); never make two for the same part. Never use `pipelines`, `docs`, `misc` or `etc`.
   Done when: you have the area list, existing ones first.
3. Create the missing areas: `POST /api/folder {path: "<Area>"}` (409 means it exists, which is fine).
   Done when: `GET /api/tree` shows every area at the top.
4. File the loose items. For each top-level document or folder that is not an area, choose the area of its main change and a feature name: short Korean, 2–4 words joined by `-`, no issue number, no goal sentence (`이슈-대시보드`, `단일-폴더-저장`). Create `<Area>/<feature>` with `POST /api/folder`, then move:
   - a plan → `POST /api/move {from, to: "<Area>/<feature>/계획.dpx.json", type: "file"}`
   - any other doc → `<Area>/<feature>/<short-name>.dpx.json`
   Moves keep history, run records and the plan's pipeline state. A target that exists returns 409: pick another short name.
   Done when: nothing but areas is left at the top.
5. Remove the empty leftovers (`DELETE /api/folder?path=<folder>`), such as an old `pipelines/`. Only remove a folder that `GET /api/tree` shows empty.
   Done when: the tree is area → feature → docs and nothing else.
6. Report the tree in a few lines: each area, its features, and what moved where.
   Done when: the user or the lead has the list.

Documents inside a feature are optional: an area or a feature folder may stay empty until work starts there.

## Later plans

A lead writing a plan puts it at `<Area>/<feature>/계획.dpx.json` (`write_plan` with that `path`). Run this skill again when a new part of the code appears or items land at the top.
