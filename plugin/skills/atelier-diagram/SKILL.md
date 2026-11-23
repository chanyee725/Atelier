---
name: atelier-diagram
description: Draw a flow, architecture or code-analysis diagram in an Atelier document — diagram-as-code (Eraser-compatible DSL) with code references on nodes, styled like eraser-diagrams. Use for "다이어그램 그려줘", "구조도", "코드 흐름 정리", or a diagram block in a plan or doc.
---

# Atelier diagram

A diagram is a block in a `.dpx.json` file: `type` (`flowchart`, `sequence`, `cloud-architecture`, `entity-relationship`) and `code` (the DSL). Full guide: `docs/agent-diagrams.md` in the Atelier repo. Style and layout follow the MIT `eraser-diagrams` rules.

Every design (diagram, canvas, document screen, UI) follows Eraser.io. References in the Atelier repo: `docs/research/eraser/02-diagram-as-code-ai.md`, `04-visual-design.md`, `09-examples/`, `09-examples-style.md`.

## Steps

1. Sketch the nodes. Label each by feature in short Korean (`로봇 데이터 녹화`), not by file or class name. Group with `[ ]` blocks when there are more than 7 nodes. Declare groups in flow order and avoid a flow that goes back and forth between groups.
   Done when: no label holds a file name, path or class name.
2. Write the DSL. Start with `title` (short: about 12 characters, at most 20; details go in the document's first line) and `direction right`, then nodes with `[icon: ...]`, then edges (`A > B`).
   Done when: every edge names nodes that exist.
3. Attach code. For code diagrams add `code: "path:start-end#symbol"` per node (flowchart and cloud-architecture), or block JSON `codeRefs: {v: 1, nodes: {"<label>": {summary, refs: [{path, start, end?, symbol?}]}}}` for summaries and notes.
   Done when: every node that maps to code has a ref with `path` and `start`, and the lines match the current file.
4. Save. Read the file, change only the block, `PUT /api/file?path=<file>` the whole JSON with its `revision` and `x-drawing: 1`. A 400 names the bad field; fix it and save again.
   Done when: the PUT returns a new `revision` and the diagram renders in Atelier.

Renaming a node: rename its `codeRefs.nodes` key too. Summaries and notes describe code only, no secrets or personal data.
