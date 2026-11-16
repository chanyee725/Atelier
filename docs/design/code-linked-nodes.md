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
dropped on read; unknown `v` kept verbatim; at most 2000 nodes. develop is already format v4 (`plan`), so adding it
bumps the file format `version` to **v5**: v4 and older files are read as they are and stored as v5 on the next save; an
older server treats v5 files as read-only (422), so it can never drop `codeRefs` through `normalizeContent`.
Refs are keyed by node name, like `layout.items`: renaming a node leaves its refs orphaned. The server keeps orphaned
entries as they are (never dropped on save; the 2000-node cap applies), so an autosave in the middle of a rename loses
nothing. Cleanup is only an explicit action in the code panel ("연결 안 된 코드 정리").

### Diagram-as-code shorthand

Eraser node attributes stay compatible; one extra attribute, `code`, is parsed into refs and merged with the block's
`codeRefs.nodes` entry (block JSON wins on conflict, DSL adds refs that are not there yet):

```
로봇 데이터 녹화 [icon: video, code: "src/record/recorder.py:42-118#Recorder.record_episode"]
LeRobot 형식 변환 [code: "convert/lerobot.py:10-80#to_lerobot; convert/schema.py:5"]
```

Format: `path[:start[-end]][#symbol]`, several separated by `;`. Notes and summary only via block JSON (agents
write them through the API). `code` is added to the node attribute keys of the graph diagrams only (flowchart and
cloud-architecture, `GRAPH_KEYS` in `shared/dsl/common.ts`), so it no longer warns there; sequence and ERD are out of
scope and keep warning. How Eraser treats an unknown attribute is not verified, so any "copy for Eraser" / DSL export
path strips `code:` attributes.

### Free-form canvas

Excalidraw elements carry the same shape in `customData.codeRefs` (`{summary, refs}`); converting a diagram block to
free-form copies each node's entry onto its shape.

## 2. Server: read-only code API

`GET /api/code?path=<repo-relative>&start=&end=` →
`{ path, start, end, total, lines: string[], language }` (language from extension, for highlighting only).

- Root = the git project that holds the workspace (same root the server already resolves for `.dispatch/`).
  No git project → 404 `{error:'no-project'}`.
- Git-tracked files only: the path must be listed by `git --literal-pathspecs ls-files --error-unmatch -- <path>` run
  with `cwd` = root (through `server/dispatch/cli.js`, no shell). Literal pathspecs stop glob and magic matching
  (`a[b].txt` must not match tracked `ab.txt`; `:(top)x` is just a name). This keeps gitignored local config, `node_modules/` and `.dispatch/wt/` out.
  Not tracked → 404 `{error:'not-tracked'}`. The deny list below stays as a second layer.
- Path checks: decode once (reject any `%` left after decoding, so no double encoding; this deliberately also refuses
  real file names containing `%`, which code refs do not need), normalize; reject absolute, `..`, NUL, backslash; `realpath` must stay inside the root (symlink escape →
  403); reject `.git` and `.dispatch` as any path segment (not only the leading one) and any segment starting with `.env`,
  case-insensitively, on both the requested path and its realpath, plus key/secret files (`*.pem`, `*.key`, `id_rsa*`,
  `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `credentials*`, `secrets*`) → 403; must be a regular file. The key/secret
  patterns apply exactly like `.git`/`.dispatch`/`.env*`: to every path segment, case-insensitively, on both the
  requested path and its realpath (one deny-list regex in `server/code/index.js`, `SECRET_SEGMENT`).
- Limits: file ≤ 1 MB (exactly 1 MB is allowed, one byte more → 413), binary (NUL in first 8 KB) → 415, directory → 400.
  Returned window ≤ 400 lines: the range plus up to 20 lines of context each side, clamped to the file. A range longer
  than fits is cut at 400 lines from its start with `truncated: true` in the response (the panel says so).
  `start`/`end` missing → from line 1; non-integer, `< 1` or `start > end` → 400; `start > total` → 416. Read only, no writes, no outbound requests, no caching on disk.
- No content is logged (path + status only at debug level).
- Tests (E504b) cover: symlink escape (file and folder), `..` and `%2e%2e` / double encoding, `.ENV` / `.Env.local`,
  nested segments (`sub/.git/config`, `pkg/.Dispatch/x`), the realpath case (a tracked symlink to `.git/config`, `.env`,
  a `*.pem` or `.npmrc` file is 403 even when its own name is harmless),
  untracked and gitignored files, `a[b].txt` untracked next to tracked `ab.txt`, directory path, the 1 MB boundary, every range error above, `truncated`.

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
- `summary` and `note` are stored in documents: the guide tells agents to describe the code only, never paste secrets,
  tokens, emails, real names or transcript text there.
- The server-side prompt fragment that Drawing gives agent sessions for diagrams (where `write_plan`'s description and
  the cursor docs live) gets the same two-line rule.

## 5. Font: Pretendard on the canvas

Excalidraw 0.18.1 cannot register a new family without patching: `Fonts.register` is `private static` and `Fonts` is
not exported (only `FONT_FAMILY`). So:

- **Approach (decided):** keep our clean font id 9 ("Liberation Sans") and replace its single face file. Excalidraw
  defines one face for family 9 with no `unicode-range`, so extra subset faces cannot be added, and a separate CSS
  `@font-face` for Hangul would neither trigger Excalidraw's redraw nor be included in its own SVG export. So the one
  file served at the Liberation Sans asset URL under `/excalidraw/fonts/` (our vendored copy) is a Pretendard Regular
  woff2 holding Latin + Hangul (KS X 1001 2,350 syllables + jamo + Latin/punctuation subset, built from the `pretendard`
  npm package by a checked-in script, like `scripts/subset-clean-font.py`). No CDN, and no Excalidraw changes beyond the
  transforms `web/vite.config.ts` already applies. If the vendored asset layout makes this impossible, stop and report.
- **License:** Pretendard is OFL-1.1 with the Reserved Font Name "Pretendard". A subset is a modified version, so it
  must not carry that name as its font name. The new subset script does exactly what `scripts/subset-clean-font.py`
  does: the font name records get Drawing Sans–based names (ID 1 `Drawing Sans`, ID 2 the style, ID 3
  `Drawing Sans <style> (subset)`, ID 4 `Drawing Sans <style>`, ID 6 and CFF `fontNames[0]` `DrawingSans-<style>`;
  the canvas file uses `Drawing Sans Canvas Regular` / `DrawingSansCanvas-Regular`). The copyright and license records
  (IDs 0/13/14) are kept as-is, because the OFL forbids removing them, and the source is credited in the description,
  ID 10 (`Subset of Pretendard 1.3.9 …`). So "Pretendard" appears only in IDs 0/10/13/14, never in a font name record
  (checked with fontTools, E504g #497). Add to the existing Pretendard
  entry in NOTICE.md and next to the Excalidraw font comment in
  `web/vite.config.ts` (source, version, subset command, OFL text path).
- **Metrics:** Excalidraw computes line height and baseline for family 9 from its own `FONT_METADATA` (Liberation),
  which is not exported, so there is no runtime correction. Measure Pretendard's ascent/descent/line gap, set
  `CLEAN_LINE_HEIGHT` so a single 13px line sits vertically centred within ±1px of the box centre, and report the
  numbers in the PR.
- **Existing texts:** saved width/height are Liberation-based. On load, re-measure free-form and bound text in
  family 9 (and hand fonts, already converted in `cleanStyle.ts`) with the existing refit path (`refit.ts`) so text
  never overflows its box and bound text stays centred.
- **Export:** `shared/render` embeds "Drawing Sans" (Pretendard Latin subset). Hangul in SVG/PNG export also uses
  Pretendard by subsetting to the glyphs used at export time (web side); the shared Latin subset stays as it is. Size
  caps: the family-9 woff2 asset at most 400 KB; main web JS bundle at most +150 KB gzip (export subsetter);
  `shared/render` at most +20 KB; checked with `npm run build` and the built asset sizes, reported in the PR.
- **Done when:** headless screenshots of (1) a new canvas with Korean + Latin text, (2) a diagram block, (3) an
  existing file with Liberation and hand-font texts show Pretendard and no text overflowing its box; full e2e passes.

## Out of scope

- Editing code, jumping into an editor, git blame/history. Auto-generating refs (agents write them).

## Tickets

| Ticket | Scope |
|---|---|
| E504a | shared + server: block `codeRefs` field (validation, v5), DSL `code` attribute parse/merge, docs/workspace-api.md |
| E504b | server: `GET /api/code` read-only API with guards and tests |
| E504c | web: code badge, "기능 코드" panel, preview (after a + b) |
| E504d | agent guide + prompt/skill text + example |
| E504e | canvas font → Pretendard (canvas, blocks, export) |
