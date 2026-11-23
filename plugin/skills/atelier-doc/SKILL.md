---
name: atelier-doc
description: Write or edit an Atelier document (.dpx.json) through the workspace API, step by step so it shows live, in a short action-first style. Use for "문서 써줘", "분석 문서", "Atelier에 정리해줘", or any doc a team should read in Atelier.
---

# Atelier doc

Documents are `.dpx.json` files in the workspace (`<project>/.atelier`). Write them only in Atelier through the workspace API, so they show live; never as local files. In a team only the `docs` session edits documents; a lead manages sessions and hands it the user's answers and requests. The API is in `docs/workspace-api.md` in the Atelier repo. Every non-GET request needs `x-drawing: 1`; a session started by Atelier also sends `x-drawing-session: $DRAWING_SESSION`.

## Steps

1. Pick the server, then the file. Write to the server started from the work's own git project: check which one runs there first (its port is in `<project>/.atelier/server.port`; `GET /api/state` on it answers, else start it with `atelier-setup`), and tell the user that server's URL before the first write. A plan document goes in `기획/<feature>/`. `GET /api/tree` lists files. Create with `POST /api/file {path, title}` (409 when it exists).
   Keep the title (and the file name) short: about 12 characters, at most 20, a noun phrase; details go in the first line of the body.
   Done when: the user has the URL and `GET /api/file?path=<file>` returns a `revision`.
2. Write in small passes. Read the whole file, change `document` (and `blocks` when a diagram goes in), and `PUT /api/file?path=<file>` the whole JSON back with its `revision`. One section per PUT, so the reader sees it grow. A 409 means someone saved first: read again and redo the change.
   When one part changes, fix every other place that states the same fact in the same turn (top status line, current structure, step plan, tables, diagrams, 끝난 것 and 남은 것, 관련 코드), and search the whole document for the changed key words (a dropped format name) before saving. A part that still describes the old state is marked "지금(이전 전)".
   Done when: each PUT returns the new `revision`, and the search finds no place that still says the old fact.
3. Keep the style (Atelier repo `docs/design/writing-style.md`). Korean 해요체, short sentences.
   - Top of the document: 상태 and 결정 in one line, then 다음: the one thing the reader does now.
   - Each section opens with what the reader can do or check. One idea per paragraph; a side issue goes last as "따로: …".
   - Numbered steps for anything with more than one step, at most 5 items per list.
   - Concrete estimates ("15분", "파일 3개"), never "조금".
   - End with 끝난 것 and 남은 것 lists. 남은 것 is work still to do, never questions for the user. Analysis docs then end with a "관련 코드" section: real paths, functions and endpoints.
   Done when: the first line of the document and of each section is an action or a finding, and 남은 것 is there.
4. Write settled text only. No "(제안)", "추천", "확인 필요" or "결정할 것", and no sentence that asks the user something. Technical details (module layout, formats) are yours to decide from the code; write them as decided. Never write a "확인 필요", "결정할 것" or "열린 질문" section at the end. A decision the user makes goes on the block, node or text it concerns as a document question (`atelier-questions`), or comes up in the document's chat (the user presses 관리자와 대화 at the top right; the first message names the document path). When the answer comes, write it into the body where it belongs in the same turn. An older document that still has such a list: delete each decided item, and the whole section once it is empty.
   Done when: the document has no question list and no suggestion or question wording, and every answered decision reads as settled text in the body.
5. Check privacy. No transcripts, tokens, keys, emails or real names in the document.
   Done when: you read the final text once for those.

For a diagram inside the document use `atelier-diagram`.
