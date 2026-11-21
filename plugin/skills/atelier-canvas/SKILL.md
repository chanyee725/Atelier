---
name: atelier-canvas
description: Draw free-form on an Atelier document's infinite canvas — boxes, ellipses, diamonds, arrows, lines and text as Excalidraw elements written through the workspace API, for sketches, wireframes, boards and anything diagram-as-code does not fit. Use for "캔버스에 그려줘", "화이트보드처럼", "와이어프레임", "자유롭게 그림". A structured flow or architecture diagram goes to atelier-diagram.
---

# Atelier canvas

`<plugin-root>` is two levels above this file's folder. Calls go through `<plugin-root>/scripts/api.sh [-C <project-root>] METHOD PATH [BODY]`. A file's canvas is `canvas: { elements: [...], appState: {} }`; the page fills in every element field you leave out, so write only what matters.

## Steps

1. Open the file. `api.sh GET '/api/file?path=<file>'`, or create one: `api.sh POST /api/file '{"path":"<file>","title":"<title>"}'`.
   Done when: you hold its `revision`, `title`, `document`, `canvas` and `blocks`.
2. Lay it out on paper first: a grid with 40 px gaps, boxes 160–240 × 64–96, text 16–24 px, at most 7 colours. Ids are short and unique (`login`, `login-t`, `a1`).
3. Write the elements. Keep the existing ones (and `blocks`, which are diagram pictures framed on the canvas) and append yours. Then `api.sh PUT '/api/file?path=<file>' @<json-file>` with the whole file: `{revision, title, document, canvas, blocks}` (and `plan` if the file has one). A 409 means someone saved first: read again and redo.
   Done when: the PUT returns the new `revision`.
4. Ask the user to look (canvas view: 캔버스 tab) or check in a headless browser when you can.
   Done when: the shapes, labels and arrows sit where planned.

## Elements

```jsonc
// box with a label: the box lists its text and arrows in boundElements, the text points back with containerId
{ "type": "rectangle", "id": "login", "x": 0, "y": 0, "width": 200, "height": 80,
  "backgroundColor": "#a5d8ff", "fillStyle": "solid", "roundness": { "type": 3 },
  "boundElements": [{ "type": "text", "id": "login-t" }, { "type": "arrow", "id": "a1" }] },
{ "type": "text", "id": "login-t", "x": 50, "y": 28, "width": 100, "height": 25, "text": "로그인", "originalText": "로그인",
  "fontSize": 20, "textAlign": "center", "verticalAlign": "middle", "containerId": "login" },
// arrow from login to home: points are relative to x/y; bindings keep it attached when a box moves
{ "type": "arrow", "id": "a1", "x": 200, "y": 40, "width": 160, "height": 0, "points": [[0, 0], [160, 0]],
  "endArrowhead": "arrow", "startBinding": { "elementId": "login", "focus": 0, "gap": 1 },
  "endBinding": { "elementId": "home", "focus": 0, "gap": 1 } },
// free text
{ "type": "text", "id": "title", "x": 0, "y": -60, "width": 300, "height": 30, "text": "사용자 흐름", "originalText": "사용자 흐름", "fontSize": 24 }
```

- Other shapes: `ellipse`, `diamond` (same fields as `rectangle`), `line` (like `arrow`, no arrowheads), `frame` (`name` field; group shapes by setting their `frameId`).
- Style fields: `strokeColor` (default `#1e1e1e`), `backgroundColor`, `fillStyle` (`solid` · `hachure`), `strokeWidth` (1–4), `strokeStyle` (`solid` · `dashed` · `dotted`), `opacity` (0–100).
- To change a shape, edit it in place by `id`; to delete one, set `"isDeleted": true` or drop it (and its bound text).
- Fonts are bundled (Pretendard); do not set `fontFamily` unless asked.

## Rules

- Never drop elements you did not draw. No transcripts, tokens, keys, emails or real names on the canvas.
