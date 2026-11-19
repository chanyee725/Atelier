# eraser-diagrams: layout and style rules (notes for #733)

Source: <https://github.com/eraserlabs/eraser-diagrams>, commit
`6bde2841f1fb3368716d18e038aefa2214aa295f` (2026-11-11), MIT, "Copyright (c) 2026 Eraser Labs, Inc."
Every package has its own `LICENSE`; `packages/layout` also carries `THIRD_PARTY_NOTICES.md`
(RBush 4.0.1 MIT and Quickselect 3.0.0 ISC, in `src/rtree/RTree.ts`). These notes record values
and rules only; no code is copied here. Paths below are relative to the repo root at that commit.

## 0. What the package is (and is not)

- It is a renderer for an **already-positioned** JSON document: each element has a `tag`
  (`Shape`, `Group`, `Icon`, `Relationship`, `DatabaseTable`, `DatabaseRelationship`, `Pool`,
  `Lane`, `Activity`, `Event`, `Gateway`, `Textbox`, `Legend`, `Divider`, `Badge`) and authored
  `x/y` (missing = 0, `packages/render/SPEC.md` "Route and apply").
- There is **no automatic node placement** (no ELK/dagre/rank layout) and **no per-diagram-type
  layout** for flowchart, sequence or cloud architecture. The `layout` package routes lines around
  boxes it is given (`packages/layout/README.md`: "treats entity placement as input").
- There is **no sequence-diagram template**. Sequence look must be built from the shared rules
  (Shape box, Relationship line/label, palette, type) on top of our own `shared/render/layout-sequence.ts`.
- What we can take: (a) text-measured sizing, (b) shape/line/label styling values,
  (c) the elbow router and label placement (`packages/layout`, ~40k lines TS including
  `routing/corridor/*`; vendoring it whole is a big drop, a values-only port is the cheap option),
  (d) palette and font roles.
- Fonts in `packages/diagrams/fonts/` are Inter, JetBrains Mono and Shantell Sans (each with its
  OFL licence file). Per CLAUDE.md, take font files from their original OFL sources, not from this repo.

## 1. Pipeline order (applies to every type)

`packages/render/SPEC.md` "Page API": fill → mount at max-content → `document.fonts.ready` →
measure → size text → measure → route → apply. Connection labels that wrap are constrained by
the routed run, remeasured, and routed once more.

Rule for us: **measure text with the final font loaded before sizing any box, and route edges only
after boxes have their measured size.** Authored (user-moved / user-sized) geometry is a floor,
never shrunk (`SPEC.md` "Text sizing": "Authored dimensions remain floors").

## 2. Text sizing (node sizes from measured text)

`packages/render/src/browser/textSizing.ts`, `packages/render/SPEC.md` "Text sizing".

Policies per text slot (`data-text-grow-policy` on the template HTML):

| Policy | Rule | Used by |
| --- | --- | --- |
| `width-only` | box = natural max-content width | (templates without internal text) |
| `height-only` | keep authored/available width, grow height as text wraps | Group, Pool, Lane titles; Textbox |
| `balanced` | start at width W; if lines > maxLines, widen toward an aspect target before growing height; never wider than max-content | Shape, Activity, Relationship/DatabaseRelationship labels |

Constants:

- Unauthored width: `min(max-content, 100px)` (`DEFAULT_UNAUTHORED_TEXT_WIDTH = 100`), unless the
  template CSS already imposes a larger minimum.
- `DEFAULT_MAX_LINES = 3` (Shape sets `data-text-max-lines="3"`).
- `DEFAULT_ASPECT = 0.8`, `MAIN_APP_ASPECT_MAGIC = 1.2`.
- Balanced target text width = `sqrt(naturalTextWidth * lineHeight) * aspect * 1.2`;
  new width = `max(W, min(maxContent, W + max(0, target - currentTextWidth)))`.
- `WORD_FIT_TOLERANCE = 1.5`: widen up to 1.5x the preferred width to keep words whole; past that,
  break inside the word (`overflow-wrap: break-word`).
- Overflow growth: up to `MAX_GROWTH_PASSES = 6`, epsilon 0.5px.
- Connection labels: available width = longest horizontal straight run minus end clearance
  (`CONNECTION_LABEL_END_MARGIN = 24`), minimum `CONNECTION_LABEL_MIN_WIDTH = 48`.

Effect: short labels give compact boxes; long labels wrap to at most ~3 lines and the box widens
toward a roughly 0.96:1 text block instead of becoming a tall thin column. Same label + same font
= same size every time, so boxes of one shape stay consistent.

## 3. Typography

Font roles (`--font-<role>`; enum `TYPEFACES` in `packages/templates/src/schema/enums.ts`):
`clean` = Inter (default for every template, `base.style.css` `[data-tpl]`), `rough` = Shantell Sans,
`mono` = JetBrains Mono. Letter spacing everywhere: `-0.01em`.

| Slot | Size | Line height | Weight | File |
| --- | --- | --- | --- | --- |
| Shape primary text (first run) | 15px | 1.25 | 400 | `templates/Shape/Shape.style.css` |
| Shape secondary runs | 12px, 2px gap above, opacity 0.72 | 1.25 | 400 | same |
| Relationship label | 14px | 1.2 | 400, padding `0 2px`, colour = line colour | `templates/Relationship/Relationship.style.css` |
| Group / Pool / Lane title | 16px | normal | 400 | `templates/Group/Group.style.css` |
| Icon caption | 15px, 5px below glyph, wraps at 1.8x glyph size, `text-wrap: balance` | 1.25 | 400 | `templates/Icon/Icon.style.css` |
| DatabaseTable title / field / type | 18px / 17px / 15px mono (muted) | — | 400 | `templates/DatabaseTable/DatabaseTable.style.css` |
| Activity (BPMN task) | 16px | 1.3 | 400 | `templates/Activity/Activity.style.css` |
| Event / Gateway caption | 15px, below the 56px glyph (Event: 6px gap), max-width 300% | 1.25 | 400 | `templates/Event/`, `templates/Gateway/` |
| Markdown h1/h2/h3 | 26/32, 21/28, 17/25 | — | 700 | `templates/src/base.style.css` |

## 4. Palette and colours

Palette tokens (`packages/templates/src/schema/palette.ts`, `STOCK_PALETTE`):

| token | colour |
| --- | --- |
| white | `#ffffff` |
| yellow | `#d3d61e` |
| green | `#30a050` |
| blue | `#2866c4` |
| purple | `#c43dcf` |
| red | `#bd413a` |
| orange | `#c38424` |
| black | `#3a3a3a` |

Derivation from one identity colour C (`base.style.css`, `CUSTOMIZATION.md` "Color"):

- Shape fill = `hsl(C h s 85%)`, stroke = C.
- Group / Pool / Lane / DatabaseTable body = `hsl(C h s 98%)`, stroke = C,
  title surface = `hsl(C h s 85%)`, divider = `hsl(C h s 92%)`, BPMN fill = `hsl(C h s 96%)`.
- Authored `bgColor` / `borderColor` win over the formulas.
- No colour: fill transparent, stroke = text ink.
- Text on dark fills switches to a readable ink (`templates/src/canvasColors.ts`).

Semantic tokens (light / dark), `base.style.css`:

| token | light | dark |
| --- | --- | --- |
| canvas / surface | `#ffffff` | `#171717` |
| text | `#242424` | `#e2e2e2` |
| line | `#1c1c1c` | `#e9e9e9` |
| shadow | `#e8e8e8` | `#3f3f3f` |
| muted | `#737373` | `#a2a2a2` |
| separator | `#ebebeb` | `#3c3c3c` |
| body text | `#2e2e2e` | `#dadada` |
| link | `#457fe5` | `#68aaf2` |

Style modes: `plain`, `shadow` (default: hard `4px 4px 0 0 var(--er-shadow)` offset, no blur),
`watercolor` (texture; skip for us).

## 5. Shapes (flowchart and generic nodes)

`templates/Shape/Shape.style.css`. Kinds: rectangle, parallelogram, trapezoid, diamond, cylinder,
hexagon, circle, ellipse, oval, triangle, document, star (`schema/enums.ts` `ALLOWED_SHAPES`).

- Border 1.2px (drawn as inset box-shadow so it does not snap to 1px).
- Rectangle corner radius `min(12px, 15%)` (i.e. `min(min(w,h)*0.15, 12)`); oval = pill
  (`9999px`), circle/ellipse = 50%.
- Horizontal text inset per side: 7.5% of width (total 15%); triangle 25%; diamond and star 10%.
- Text vertically centred; `top`/`bottom` alignment adds a 10px margin.
- Cylinder: text row sits between the cap (22% of height, min 10px) and a 6% bottom band (min 6px).
- Side icon: default 20px, columns `10% | icon | max(10px, inset) | text | inset`.
- Polygon kinds are drawn as an SVG in a 0–100 box with sharp corners.

## 6. Connections (edge routing and labels)

Line style, `templates/Relationship/Relationship.style.css` and `.html`:

- Stroke `#1c1c1c` (`--er-line`), width 1.3px. Dashed `8 8.75`, dotted `1.5 6.75`.
- Arrowheads: `arrow` = fixed 12x11 chevron stroked with the line width; `triangle` = 10 x line
  width long (marker 5.71 x 5.14 stroke-width units); `bar`, `dot`, `crowFootSingle`, `crowFootMany`.
- Connector styles `elbow` (default), `straight`, `arc`; corner style `elbow` rounds corners with
  radius 6px, clamped to half the shorter leg (`render/src/browser/roundedPath.ts` `ELBOW_CORNER_RADIUS`).
- Ports: top, right, bottom, left (authored `fromPort`/`toPort` respected).

Router (`packages/layout`, entry `routeConnections` in `src/routing/routeConnections.ts`):

- Elbow routes are orthogonal, obstacle-aware, container-aware; only selected connections are
  re-routed, others keep their points (partial routing — matches "user-moved nodes stay").
- `DEFAULT_OPTIONS` (`src/constants.ts`): `marginBetweenEntities 40`, `marginBetweenRanks 40`,
  `containerPadding 20` all sides, `minConnectionLength 80`, `minConnectionTextMargin 40`.
- Quality targets (`src/routing/corridor/wallQuality.ts`, `topology.ts`): keep 24px clear of
  walls (`WALL_HUG_CLEARANCE_PX`), ideal terminal stub 24px (`TERMINAL_STUB_IDEAL_PX`),
  narrow-section target 24px, wall clearance target 16px, 5px corner clearance at the terminal turn,
  straight terminal allowed up to 32px misalignment before penalty.
- Fallback when no corridor route exists: a simple detour of 20px (`src/routing/fallbackConnection.ts`).

Label placement (`src/routing/textPlacements.ts`, `render/src/browser/labelGap.ts`):

- Label sits centred on the longest suitable segment; the line is **cut** under the label
  (SVG mask = label box + 2px clearance, `LABEL_MASK_CLEARANCE = 2`). No label background box.
- If `labelLength + 25 > segmentLength` (`LABEL_OFF_SEGMENT_BUFFER`), the label moves off the
  line: above a horizontal segment / beside a vertical one, centre offset 24px
  (`LABEL_OFFSET_MAGNITUDE`), 4px gap to the line (`LABEL_LINE_GAP`).
- Manual label anchors keep 40px from line ends (`LABEL_END_CAP_PX`, `manualLabelAnchor.ts`).
- Lines share one layer above all nodes; labels share one layer above the lines
  (`render/SPEC.md` "Route and apply").

## 7. Per diagram type

### Flowchart

Shape (§5) + Relationship (§6) + elbow router. Node spacing ≥ 40px both ways, edges ≥ 80px long,
40px margin around edge text. Box sizes from §2 (100px preferred width, ≤ 3 lines, balanced).
Placement itself stays ours (`shared/render/layout-graph.ts`); feed measured sizes into it, then
route with the §6 rules.

### Cloud architecture

Icon nodes: glyph 50px default (sm 32 / md 50 / lg 72 / xl 100), caption 15px hanging 5px below,
wrapping at 1.8x glyph width, balanced, near-black ink (`templates/Icon/Icon.style.css`).
Groups: body = identity tint 98%, 1px identity border, 6px radius, shadow mode offset 4/4,
title chip 16px with `margin 7.5px 7.5px 0`, `padding 3px 5px`, radius 2px, gap 5px to its 15px
icon; full-width band variant `padding 8px 12.5px`, radius `5px 5px 0 0`. Container padding 20px
(router default). Icon glyph files are #734's scope, not this one.

### Sequence

No template upstream. Reuse: participant box = Shape rectangle (§5, 15px text, measured width);
messages = Relationship straight lines with 14px labels (§6), label cut-out instead of a background
box; dashed `8 8.75` for replies; palette §4. Spacing between participants should come from
measured label widths (label + 2 x 24px end margin) so labels never overlap.

### ERD

`templates/DatabaseTable/*`: header band 36px min height, rows 28px min, `padding 0 10px`, 8px gap
between columns; 1.8px identity border, 5px radius, body tint 98%; 1px row dividers
(`hsl(C h s 92%)`), last row none. Title 18px, field 17px body-text colour, type and meta 15px
JetBrains Mono muted; one `fontSize` scales the whole ramp (18:17:15). Width = widest measured row.
Relations: `templates/DatabaseRelationship/*`, same line as §6 (1.3px, 14px label) with crow-foot
markers derived from `relType` (one-to-one, one-to-many, many-to-one, many-to-many); notations
`crows-foot` and `chen`.

### BPMN

- Activity (task): 2px border, 10px radius, `padding 12px 16px`, gap 10px to glyph, 16px text
  line-height 1.3, balanced sizing.
- Event: fixed 56px circle, 2px ring, caption below (6px gap, 15px).
- Gateway: fixed 56px diamond, stroke 2, dashed `6 5` / dotted `1.5 4`, caption below.
- Pool / Lane: Group rules (1px border, 6px radius, 16px title chip), title text `height-only`.
- BPMN fill = identity at 96% lightness.

### Plan / pipeline diagrams (`shared/dispatch/plan-diagram.ts`)

No upstream counterpart. Treat steps as Shape rectangles (§5) and step links as elbow
Relationships (§6), same palette and type, so they match the flowchart look.

## 8. Where this maps in Drawing (`origin/develop`)

| Concern | Our file |
| --- | --- |
| Text wrap / measure | `shared/render/layout-wrap.ts` |
| Graph placement (flowchart, cloud) | `shared/render/layout-graph.ts`, `shared/render/layout-align.ts` |
| Edge routes | `shared/render/layout-routes.ts` |
| Sequence | `shared/dsl/sequence.ts`, `shared/render/layout-sequence.ts` |
| ERD | `shared/dsl/erd.ts`, `shared/render/layout-erd.ts` |
| Plan diagram | `shared/dispatch/plan-diagram.ts` |
| Manual positions | `web/src/canvas/layoutEdit.ts`, `web/src/canvas/layoutSession.ts` |

## 9. NOTICE checklist for vendored parts

- Keep the MIT text with "Copyright (c) 2026 Eraser Labs, Inc." next to any vendored file and in
  a top-level third-party notice.
- If `packages/layout/src/rtree/RTree.ts` is taken, also keep the RBush (MIT) and Quickselect (ISC)
  notices from `packages/layout/licenses/`.
- Record source path + commit `6bde284` in the PR for every file taken.
- Do not take anything from Eraser beyond this MIT repo (name, logo, icon/illustration files,
  app code); do not take the icon library adapter's icon set (#734).
