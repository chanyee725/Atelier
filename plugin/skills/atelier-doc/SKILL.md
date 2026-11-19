---
name: atelier-doc
description: Write or edit an Atelier document (.dpx.json) through the workspace API, step by step so it shows live, in a short action-first style. Use for "문서 써줘", "분석 문서", "Atelier에 정리해줘", or any doc a team should read in Atelier.
---

# Atelier doc

Documents are `.dpx.json` files in the workspace (`<project>/atelier`). The API is in `docs/workspace-api.md` in the Atelier repo. Every non-GET request needs `x-drawing: 1`; a session started by Atelier also sends `x-drawing-session: $DRAWING_SESSION`.

## Steps

1. Find or create the file. `GET /api/tree` lists files. Create with `POST /api/file {path, title}` (409 when it exists).
   Done when: `GET /api/file?path=<file>` returns a `revision`.
2. Write in small passes. Read the whole file, change `document` (and `blocks` when a diagram goes in), and `PUT /api/file?path=<file>` the whole JSON back with its `revision`. One section per PUT, so the reader sees it grow. A 409 means someone saved first: read again and redo the change.
   Done when: each PUT returns the new `revision`.
3. Keep the style. Korean 해요체, short sentences. Each section opens with what the reader can do or check. Numbered steps for anything with more than one step, at most 5 items per list. Analysis docs end with a "관련 코드" section: real paths, functions and endpoints.
   Done when: the first line of each section is an action or a finding.
4. Check privacy. No transcripts, tokens, keys, emails or real names in the document.
   Done when: you read the final text once for those.

For a diagram inside the document use `atelier-diagram`.
