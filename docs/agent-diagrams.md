# Atelier code-analysis diagrams (guide for agents)

Design: `docs/design/code-linked-nodes.md` (§1 data model, §4 agent side). API details: `docs/workspace-api.md`.

## Rule

- **Label nodes by feature, in short Korean** (e.g. `로봇 데이터 녹화`, `LeRobot 형식 변환`). Never put file names, paths or class names in a label (`record.py` is wrong).
- **Attach where the feature lives as code references**, not in the label: the DSL attribute `code: "path:start-end#symbol"`, and in block JSON `codeRefs.nodes` with `summary` and `note`.
- **Declare groups in flow order and avoid a flow that goes back and forth between groups.** A flowchart whose edges go from one group to another and back is drawn with the groups as bands across the flow (#1066); one-way flow reads best.

## Reference format

`path[:start[-end]][#symbol]`, several separated by `;`. The line range comes before `#symbol`: in `a.py#f:10` the `:10` is part of the symbol (`f:10`), not a line number; write `a.py:10#f`.

- `path`: repo-relative, `/`-separated, no `..`, no leading `/`.
- `start`, `end`: 1-based, inclusive. `end` is optional (= `start`); `end - start <= 2000`.
- `symbol`: optional, max 200 characters.
- Per node: at most 20 refs; `summary` max 500 characters; ref `note` max 300 characters.

Notes and summary exist only in block JSON. The DSL attribute carries path, lines and symbol only.

## Diagram-as-code

```
title 로봇 데이터 파이프라인
direction right

로봇 데이터 녹화 [icon: video, code: "src/record/recorder.py:42-118#Recorder.record_episode"]
LeRobot 형식 변환 [code: "convert/lerobot.py:10-80#to_lerobot; convert/schema.py:5"]
학습 데이터 저장 [icon: database]

로봇 데이터 녹화 > LeRobot 형식 변환 > 학습 데이터 저장
```

### Colour

- **One colour per group, a different colour per role.** Put `color:` on the group (`서버 [color: blue] { ... }`); its nodes and nested groups take that colour. A node's own `color:` wins, and `color: none` keeps one node neutral.
- Nodes outside any group stay neutral unless they are a hub or the one thing to notice; colour at most one or two of those.
- Names: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink` and the other palette names in `shared/render/theme.ts`. Keep the default `colorMode` (`pastel`); use `bold` or `outline` only for the single standout.
- Red means risk or a boundary (firewall, DMZ, error path), not decoration. Do not use more than five colours in one diagram.

```
서버 [icon: server, color: blue] { 녹화 명령 전달; 메타데이터 등록 }
사용자 PC 앱 [icon: monitor, color: green] { 녹화 화면; 영상 인코딩 }
녹화 명령 전달 > 녹화 화면
```

DSL refs are merged with the block's `codeRefs.nodes` entry of the same node name. Block JSON wins on conflict; the DSL only adds refs that are not there yet. How Eraser treats the `code` attribute is not verified, so Atelier strips `code:` attributes when it exports the DSL (copy for Eraser).

## Full block (in a `.dpx.json` file)

The block key is `codeRefs` (the block's own `code` is the DSL string). It is keyed by node name, the same key the DSL and `layout.items` use:

```json
{
  "id": "b1",
  "type": "flowchart",
  "code": "title 로봇 데이터 파이프라인\n로봇 데이터 녹화 [icon: video, code: \"src/record/recorder.py:42-118#Recorder.record_episode\"]\nLeRobot 형식 변환 [code: \"convert/lerobot.py:10-80#to_lerobot\"]\n로봇 데이터 녹화 > LeRobot 형식 변환",
  "x": 0, "y": 0, "w": 0, "h": 0,
  "codeRefs": {
    "v": 1,
    "nodes": {
      "로봇 데이터 녹화": {
        "summary": "카메라와 관절 값을 에피소드 단위로 저장해요",
        "refs": [
          { "path": "src/record/recorder.py", "start": 42, "end": 118,
            "symbol": "Recorder.record_episode",
            "note": "카메라·관절 값을 에피소드 단위로 저장" }
        ]
      },
      "LeRobot 형식 변환": {
        "summary": "녹화 결과를 LeRobot 데이터셋 형식으로 바꿔요",
        "refs": [
          { "path": "convert/lerobot.py", "start": 10, "end": 80, "symbol": "to_lerobot" },
          { "path": "convert/schema.py", "start": 5 }
        ]
      }
    }
  }
}
```


Free-form canvas shapes carry the same shape in `customData.codeRefs` (`{summary, refs}`).

## Saving: `PUT /api/file`

Read the whole file, change only the block, and send the whole file back with its `revision`. Never type `document`, `canvas` or `plan` by hand: a save rewrites the whole file, so anything missing is wiped. Every non-GET request needs the `x-drawing: 1` header. A stale `revision` gets 409 with the current one: re-read and retry. `PORT` is the port in the dispatch skill.

Needs `jq`. Save it as a script file and run it (`bash save.sh`) rather than pasting it into a shell: `set -e` would close an interactive shell. `set -e` and `curl -f` stop the script on the first failure (HTTP error, missing block) instead of saving a broken file.

```bash
set -e
URL="http://127.0.0.1:$PORT/api/file?path=analysis/robot"
curl -sf "$URL" > /tmp/robot.json
jq -e 'any(.blocks[]; .id == "b1")' /tmp/robot.json > /dev/null || { echo 'block b1 not found' >&2; exit 1; }

# set codeRefs on one block (id "b1"); everything else stays as read
jq '.blocks |= map(if .id == "b1" then .codeRefs = {
      v: 1,
      nodes: { "로봇 데이터 녹화": { summary: "카메라와 관절 값을 에피소드 단위로 저장해요",
        refs: [ { path: "src/record/recorder.py", start: 42, end: 118, symbol: "Recorder.record_episode" } ] } }
    } else . end)' /tmp/robot.json > /tmp/robot.next.json

curl -sf -X PUT "$URL" -H 'content-type: application/json' -H 'x-drawing: 1' -H "x-drawing-session: $DRAWING_SESSION" --data-binary @/tmp/robot.next.json
```

`x-drawing-session`: a session started by this Atelier sends `$DRAWING_SESSION` (its session id, set in its environment), so the cursor and the project's agent list show its name for certain (#656). Without it the server guesses from your tool calls, also when the path has no `.dpx.json`, is partly encoded, or the PUT runs from a script you saved (`bash save.sh`). While you work, your cursor stays at your last edit with a short status (`글 작성 중…`, `다이어그램 작성 중…`) and leaves when your session ends. A writer outside this Atelier may send its own session name (e.g. `Otto`) instead. Never put a real name or an email there; it is kept in memory only, cut to 32 characters, and stripped of HTML and control characters.

The GET body already holds `revision`, `title`, `document`, `canvas`, `blocks` and `plan` (if any), so the PUT body is the same JSON with the edited block. The block shown above is what `b1` looks like after the edit.

Invalid `codeRefs` (bad path, `start > end`, too many refs) gets 400 with the reason; fix it and save again.

## Privacy and limits

- `summary` and `note` are stored in the document. Write only a description of the code. Never include secrets, tokens, API keys, emails, real names or conversation text.
- The DSL `code:` attribute works only in `flowchart` and `cloud-architecture` diagrams.
- Paths are repo-relative with `/`; `./` segments are dropped (`./a.py` is stored as `a.py`). In the DSL `code:` attribute the first `#` starts the symbol and everything after it is the symbol (`a.ts#Class.#priv`, `a.cpp#operator/`), so paths containing `#` are not supported there. Such a path is not rejected: `a#b/c.py` is read as path `a` with symbol `b/c.py`, without a warning, so the ref points at file `a`. Use block JSON `codeRefs` for those paths. `symbol`, when given, is non-empty.
- At most 2000 nodes per block. The file format is v5 once a block has `codeRefs`; an older server opens such files read-only.
- Refs are keyed by node name. When you rename a node, rename its `codeRefs.nodes` key too, or the refs are orphaned.

## Checklist

1. Every label is a short Korean feature name, no file names.
2. Every node that maps to code has at least one ref with `path` and `start`.
3. `summary` says what the feature does in one sentence; `note` says what that range does.
4. Summaries and notes hold no secrets or personal data; renamed nodes have renamed keys.
5. Paths exist in the repo and lines match the current file.
6. Every group has a `color:`, and groups with different roles have different colours.
