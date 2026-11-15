# Feature-first nodes linked to code, and Pretendard on the canvas

Status: design (2026-11-15). Epic: see `docs/tickets.md` / the E504 issue.

## Goal

1. When an agent draws a code-analysis diagram, node labels say **what the feature does** ("로봇 데이터 녹화",
   "LeRobot 형식 변환"), not file names (`record.py`). Where the feature lives in the code is attached to the node as
   **code references**. Clicking the node shows the feature, its references (file:lines, symbol, one-line note) and a
   read-only preview of the selected reference with line numbers and the range highlighted.
2. The canvas uses the bundled Pretendard (Latin + Hangul) instead of Liberation Sans / handwriting fonts: new text,
   diagram block render, free-form shapes, SVG/PNG export. No CDN; local bundle only.

## 1. Data model

A code reference:

```jsonc
{ "path": "src/record/recorder.py", // repo-relative, '/'-separated, no '..', no leading '/'
  "start": 42, "end": 118,          // 1-based, inclusive; end optional (= start); end - start <= 2000
  "symbol": "Recorder.record_episode", // optional, max 200 chars
  "note": "카메라·관절 값을 에피소드 단위로 저장" } // optional, max 300 chars
```

Per node: `{ "summary"?: string (max 500), "refs": CodeRef[] (max 20) }`.

### Diagram blocks (canonical store)

A block may carry `codeRefs` (`code` is already the block's DSL source string), keyed by node name (the same key the DSL and `layout.items` use):

```jsonc
"codeRefs": { "v": 1, "nodes": { "로봇 데이터 녹화": { "summary": "...", "refs": [ { "path": "...", "start": 42, "end": 118 } ] } } }
```

Validated like `layout` (docs/workspace-api.md "Block `layout`"): bad `codeRefs` on PUT → 400; a bad stored `codeRefs` is
dropped on read; unknown `v` kept verbatim; at most 2000 nodes. Adding it bumps the file format `version` (v4) with
the same old-server read-only rule as v3.

### Diagram-as-code shorthand

Eraser node attributes stay compatible; one extra attribute, `code`, is parsed into refs and merged with the block's
`codeRefs.nodes` entry (block JSON wins on conflict, DSL adds refs that are not there yet):

```
로봇 데이터 녹화 [icon: video, code: "src/record/recorder.py:42-118#Recorder.record_episode"]
LeRobot 형식 변환 [code: "convert/lerobot.py:10-80#to_lerobot; convert/schema.py:5"]
```

Format: `path[:start[-end]][#symbol]`, several separated by `;`. Notes and summary only via block JSON (agents
write them through the API). Eraser itself ignores the attribute; exporting to Eraser keeps it as text.

### Free-form canvas

Excalidraw elements carry the same shape in `customData.codeRefs` (`{summary, refs}`); converting a diagram block to
free-form copies each node's entry onto its shape.

## 2. Server: read-only code API

`GET /api/code?path=<repo-relative>&start=&end=` →
`{ path, start, end, total, lines: string[], language }` (language from extension, for highlighting only).

- Root = the git project that holds the workspace (same root the server already resolves for `.dispatch/`).
  No git project → 404 `{error:'no-project'}`.
- Path checks: normalize; reject absolute, `..`, NUL, backslash; `realpath` must stay inside the root (symlink escape →
  403); reject `.git/` and any segment starting with `.env`, plus key/secret files (`*.pem`, `*.key`, `id_rsa*`,
  `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `credentials*`, `secrets*`) → 403; must be a regular file.
- Limits: file ≤ 1 MB (413), binary (NUL in first 8 KB) → 415, returned window ≤ 400 lines (range plus up to 20 lines of
  context each side; clamp to the file). Read only, no writes, no outbound requests, no caching on disk.
- No content is logged (path + status only at debug level).

## 3. Web: node click → code panel

- Selecting one node of a diagram block (or a free-form shape) that has code info opens a right-side panel
  "기능 코드" (reuse the existing right panel slot/style; Linear-like dark chrome). Nodes with code show a small
  `</>` badge so the click target is discoverable.
- Panel: node label (feature) + summary, list of refs (`path:start-end`, symbol, note). First ref selected by
  default; preview below: monospace, line numbers, the `start..end` range highlighted, scrolled into view, read-only.
  Esc / clicking empty canvas closes it. Errors in plain 해요체 ("파일을 찾지 못했어요").
- No syntax-highlighting library unless already bundled; plain text with line numbers is acceptable.

## 4. Agent side

- New agent guide `docs/agent-diagrams.md` (also linked from the plugin `dispatch` skill and the `write_plan` /
  workspace docs): "노드 라벨은 기능(한국어 짧게), 파일 이름은 라벨에 쓰지 않아요. 코드 위치는 `code` 로 붙여요",
  with a full example block (DSL + `codeRefs` JSON) and the API call to save it.
- The server-side prompt fragment that Drawing gives agent sessions for diagrams (where `write_plan`'s description and
  the cursor docs live) gets the same two-line rule.

## 5. Font: Pretendard on the canvas

- Excalidraw 0.18 only knows its own font ids. Investigate registering Pretendard as a font family (Excalidraw's font
  registry / `FONT_FAMILY` + `Fonts.register`), served from the bundled `pretendard` npm package (already a
  dependency for the UI). If registration isn't possible without patching, map our clean font id to Pretendard by
  serving Pretendard files under the Liberation Sans asset name only as a last resort, documented.
- `shared/render` already embeds "Drawing Sans" (Pretendard Latin subset) for SVG; extend export so Hangul text also
  renders in Pretendard (subset to used glyphs at export time, or embed a Hangul subset) without growing the main bundle
  more than needed; measure and note bundle size in the PR.
- Existing files: texts with Liberation Sans (9) are shown in Pretendard too (treated like hand fonts in
  `cleanStyle.ts`), so the switch is visible everywhere.

## Out of scope

- Editing code, jumping into an editor, git blame/history. Auto-generating refs (agents write them).

## Tickets

| Ticket | Scope |
|---|---|
| E504a | shared + server: block `codeRefs` field (validation, v4), DSL `code` attribute parse/merge, docs/workspace-api.md |
| E504b | server: `GET /api/code` read-only API with guards and tests |
| E504c | web: code badge, "기능 코드" panel, preview (after a + b) |
| E504d | agent guide + prompt/skill text + example |
| E504e | canvas font → Pretendard (canvas, blocks, export) |
