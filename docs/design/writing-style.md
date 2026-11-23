# Writing style for agent documents (#737)

Agent-written documents read as cluttered when they open with background, mix several ideas per paragraph and end without saying what is left.
Sessions that write documents (docs role, lead reports and handovers, any `atelier-doc` run) follow this page.
The role prompts in `server/dispatch/roles.js` and the `atelier-doc` skill in `plugin/skills/` carry a short form of it.

The reader may skim, lose their place, or come back days later. Every rule below makes the next step obvious without rereading.

## Rules

1. **Next action first.** The first line of the document, and of each section, is something the reader does or checks. Background comes after, if at all.
2. **State and decisions at the top.** Open with where things stand (단계, 결정, 막힌 것). The reader should not have to keep anything from an earlier section in mind.
3. **Number multi-step work.** More than one step → a numbered list. One bounded action per step, fewest steps that work. Lists stop at 5 items; split longer ones into 지금 / 나중.
4. **One idea per paragraph.** Short sections, short paragraphs. A side issue gets its own line at the end ("따로: …"), not a sidebar in the middle.
5. **Concrete estimates.** "15분", "파일 3개", "오후 반나절". Never "조금", "꽤".
6. **Visible done / left.** End with two short lists: 끝난 것 (what now works, concretely) and 남은 것 (with owner or next action).

## Asking the user (#1050)

Ask one decision at a time, with the answer ready to click.

1. **Claude: the AskUserQuestion tool.** Several questions go in one `questions[]` call. 2–4 choices, the recommended one first with "(추천)".
2. **Codex and Gemini: one question per turn in text.** They have no such tool. The shape:

```markdown
질문 1/4: 저장 위치를 어디로 할까요?
1. 프로젝트 폴더 (추천) — 다른 기기에서도 같이 보여요
2. 홈 폴더 — 프로젝트와 따로 남아요
```

3. **End the turn with it.** The question line ends in `?` and sits with its choices at the very end of the turn. The app's question card reads it (`web/src/dispatch/lib/question.ts`): a click moves to the next question, the last one sends all answers. After an answer, ask the next question.

Also: Korean 해요체 for prose, code and paths as they are, no opening or closing pleasantries, no restating what was just done.

## Shape of a document

```markdown
# <제목>

상태: <한 줄 — 단계, 결정>
다음: <독자가 지금 할 한 가지>

## <섹션>
<첫 줄: 할 일이나 찾은 것>
1. …
2. …

## 끝난 것
- …

## 남은 것
- … (담당, 예상 시간)
```

## Installing

The rules ship with the Atelier plugin: `plugin/skills/atelier-doc/SKILL.md` carries them, so any session with the plugin installed (`/plugin marketplace add <install>/current/plugin`, then `/plugin install atelier@atelier`; `atelier-update` prints both lines) writes this way. Agent sessions started by Atelier get the short form through their role prompt; nothing else to install.

The rules are summarized in our own words from the public `i-have-adhd` writing skill; no files from it are copied.
