---
name: atelier-questions
description: Ask, read and answer questions inside Atelier documents — an agent puts a decision it needs on a block, diagram node or text range (with choices), keeps working, and gets the answer as a message; the user's open questions across the workspace are listed and can be answered from here. Use for "사용자한테 물어봐야 해", "결정 필요", "열린 질문 있어", "질문에 답해줘".
---

# Atelier questions

`<plugin-root>` is two levels above this file's folder. Calls go through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]`; it sends `x-drawing-session: $DRAWING_SESSION` when that is set. Format: `docs/workspace-api.md` → "Questions in a document" in the Atelier repo.

## Ask (an agent session started by Atelier)

1. Pick the anchor: `{"kind":"block","block":"<block-id>"}`, `{"kind":"node","block":"<block-id>","node":"<node name>"}` or `{"kind":"text","from":<n>,"to":<n>}`.
2. `api.sh POST '/api/file/discussions?path=<file>' '{"anchor":{…},"question":"<one decision>","choices":["A","B"],"step":"<plan step id>"}'`. `choices` 2–10 (or none for free text); `step` marks that plan step blocked while open. Without `DRAWING_SESSION` of a live session the server refuses (400): only Atelier sessions ask.
   Done when: the reply has `item.id` (`q_…`).
3. Keep doing what does not depend on it. The answer arrives as a message `[문서 질문 답변] …`; if it does not (restart, long turn), read `GET '/api/file/discussions?path=<file>'` and look for `status: "answered"`.
   Done when: you act on the answer.
4. Put the answer into the document in the same turn: rewrite the block, node or text the question was on so it reads as decided (a plan: `write_plan` again). If the document still lists that decision under "확인 필요", "결정할 것" or "열린 질문", delete the item; delete the section once it is empty.
   Done when: `GET /api/file?path=<file>` shows the decision in the body and no list item for it.

## Read and answer (for the user)

1. Open questions: `api.sh GET /api/discussions/open` → `total`, `files[]` (`path`, `title`, `open`). One file: `GET '/api/file/discussions?path=<file>'`.
   Done when: you show each open question with its choices.
2. Answer only with the user's own decision: `POST '/api/file/discussions/answer?path=<file>' '{"id":"q_…","choice":<index>}'` or `'{"id":"q_…","text":"…"}'`. One answer per question. `delivered: false` means the asking session is gone or busy; tell the user.
   Done when: the item reads `answered`.

## Rules

- The question card is the only place a decision waits: never also list it at the end of the document (`atelier-doc`). The user may answer in the document's chat instead (관리자와 대화, a message that starts with `[문서: <path>]`); treat that like an answer and do step 4.
- One decision per question, short Korean 해요체. No transcripts, tokens, keys, emails or real names in questions or answers.
