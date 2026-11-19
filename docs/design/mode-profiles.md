# 설정 > 모드별 모델 (mode × role profiles)

Issue #748. Design spec for the settings UI (PR 3). Server storage and team creation (PR 1, PR 2) only need the
data shape in the last section. Mockup: `mode-profiles/mockup.html` (static, not app code); screenshots
`mode-profiles/desktop-build.png` (800 px dialog, 구현 tab, Codex not connected) and
`mode-profiles/narrow-research.png` (390 px, 조사 tab).

## Where it goes

- Replaces the 역할별 모델 section (`web/src/settings/sections/RolesSection.tsx`). Nav label becomes 모드별 모델.
  The section id can stay `roles` so `useDirtyMark('roles', …)` and the close-confirm keep working.
- Reuse, don't fork: `SectionFrame`, `LoadNote` / `OffNote`, `PRIMARY_BTN`, `NativeSelect`, `ProviderIcon`,
  `modelGroups` / `roleChoice` / `subjParticle` from `modelsSection.ts`, `permsFor` / `fitPerm` from
  `dispatch/lib/create.ts`, `permLabel` from `dispatch/lib/format.ts`, Radix `Tabs` from `components/ui/tabs.tsx`.
- Do not touch 모델 연결 (`ProvidersSection`, #747) or the session board (#731).

## Layout

```
모드별 모델                                    (h3, SectionFrame)
팀이나 플랜 단계를 시작할 때 고른 모드의 설정을 써요. …   (hint)
[계획·설계 •][구현][리뷰·테스트][문서][빠른 수정][조사]   (tablist, one row)
기능을 만들고 고치는 기본 모드예요.                       (mode description)
        모델                       생각 수준   권한        (column heads, md+ only)
관리자  [◆ Sonnet 5.5          ▾] [기본   ▾] [자동      ▾]
        ⚠ <fallback note, only when needed>
        잘하는 것 [빠른 수정·문서                      ]
구현자  …  (6 role rows)
──────────────────────────────────────────────────────── (sticky footer)
<status text>                          [이 모드 기본값으로] [저장]
```

- Tabs: `TabsList` default (muted pill) look, `h-8`, triggers `h-7 px-2.5`. One row, never wrap: the list
  scrolls horizontally (`overflow-x-auto`, `flex-none` triggers, hidden scrollbar) and the selected tab is
  scrolled into view on change (`scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })`).
  Selection follows focus (Radix default `activationMode="automatic"`): panels are local state, instant.
- A tab whose mode has unsaved edits shows a 6 px dot after its label plus sr-only `(바뀜)`.
- Role grid (md+): CSS grid `grid-cols-[4.5rem_minmax(0,1fr)_6rem_9.5rem] gap-x-2 gap-y-1 items-center`.
  Controls `h-8`, text `text-sm`. Second line of a row (note + 잘하는 것) spans columns 2–4, `mb-2.5` between rows
  so the gap between roles is larger than inside a role.
- Narrow (< md): the role name on its own line, model full width, then 생각 수준 | 권한 in two columns, each with
  its own visible small label (column heads are hidden). All controls `h-11`. Same order in DOM and on screen.
- Footer: sticky at the bottom of the section body (`sticky bottom-0 bg-background border-t`), status text left
  (`role="status"`), buttons right. Buttons `h-8` (`h-11` narrow).

## Cell controls

| Control | Content | Notes |
| --- | --- | --- |
| 모델 | Native `<select>` with `<optgroup>` per provider, the same picker as today (#621/#672): an unconnected provider's group is disabled with `· 연결 안 됨` in its label; a saved model no longer listed stays as its own first option. `ProviderIcon` before the select. | Changing the model resets 생각 수준 to 기본 and fits 권한 with `fitPerm` (Codex: plan/auto only), like 새 세션. |
| 생각 수준 | `기본` + the model's `efforts`. | Value `default` = provider default. |
| 권한 | `permsFor(provider)` with `permLabel`. Never offers anything looser than the provider allows; no bypass. | |
| 잘하는 것 | `<input type="text" maxlength="40">`, visible label 잘하는 것. | Starts as the model's built-in strength. If the user never typed in it, it follows a new model's strength; once typed, it stays and shows a small `직접 씀` tag. Clearing it brings the built-in text back. |

Built-in strengths (copy, editable defaults): Fable `복잡한 작업·설계`, Opus `구현·꼼꼼한 검토`,
Sonnet `빠른 수정·문서`, Haiku `가벼운 일`, Codex models (GPT) `서치·자료 모으기`, Gemini `빠른 확인·긴 문맥`.

## States

| State | What shows |
| --- | --- |
| Loading / stream dropped | `LoadNote`; picks stay on screen (#644). |
| Dispatch off | `OffNote`, whole fieldset `disabled` + `opacity-60`, as today. |
| Model's provider not connected | Select gets `aria-invalid` + warn border; note under it with ⚠ (not colour alone): `OpenAI Codex가 연결되지 않았어요. 지금은 Opus 5.5로 대신 써요.` (the fallback the server will really use). Saving is still allowed: the cell keeps the user's choice. |
| Model not in list | Same pattern, `목록에 없는 모델이에요. 지금은 Opus 5.5로 대신 써요.` |
| 리뷰어/테스터 same model as 구현자 in that mode | Muted note (no warn colour): `구현자와 같은 모델이에요. 다른 제공사를 고르면 서로 다른 눈으로 봐요.` Informational only. |
| Unsaved edits | Tab dot; status `계획·설계 모드에 저장하지 않은 변경이 있어요.` (names the first other dirty mode, or nothing when only the open mode is dirty). Close asks first (existing `useDirtyMark`). |
| Saved | `저장했어요.`; save error → `text-destructive` with the server message. Nothing changed → `바뀐 게 없어요.` |

## Reset

- `이 모드 기본값으로` (secondary button): sets every cell of the open mode to the built-in default, hints back to
  built-in. Not saved until 저장, so no confirm dialog; status says `계획·설계 모드를 기본값으로 돌렸어요. 저장하면 적용돼요.`
  Disabled when the mode already equals its defaults.
- No "reset all" button in v1 (six clicks is fine; keeps the footer to two buttons).

## Copy (해요체)

- Section hint: `팀이나 플랜 단계를 시작할 때 고른 모드의 설정을 써요. 연결한 제공사의 모델이면 어느 것이든 고를 수 있어요.`
- Mode descriptions: 계획·설계 `큰 그림과 설계를 잡는 모드예요.` · 구현 `기능을 만들고 고치는 기본 모드예요.` ·
  리뷰·테스트 `만든 것을 다른 눈으로 확인하는 모드예요.` · 문서 `문서를 쓰고 다듬는 모드예요.` ·
  빠른 수정 `작은 수정을 빨리 끝내는 모드예요.` · 조사 `웹 서치와 자료 모으기에 맞춘 모드예요.`
- Role names come from the server's roles (관리자, 구현자, 리뷰어, 테스터, 디자이너, 문서화).

## Accessibility

- Tabs: Radix `Tabs` gives `role=tablist/tab/tabpanel`, `aria-selected`, roving focus with ←/→/Home/End. Tablist
  `aria-label="모드"`; triggers are `<button type="button">` (inside the form, must not submit). Selected state
  is not colour alone: border + background (existing trigger style).
- Each role row is a `<fieldset>` with an sr-only `<legend>` = role name (`display: contents` on md+ so it can sit
  in the grid). Every control has a real label: model `<label>` = role name; 생각 수준 / 권한 via
  `aria-labelledby="<column head id> <legend id>"` on md+, visible `<label>` on narrow (render both, hide by
  breakpoint, or always use visible labels; never placeholder-only).
- Warnings: `aria-invalid` + `aria-describedby` to the note id; ⚠ is `aria-hidden`, text carries the meaning.
- Focus: `focus-visible:ring-2 ring-ring` on every control (existing `FOCUS`). Tab order: tablist → panel
  controls row by row → reset → 저장.
- Contrast: only existing tokens (`muted-foreground` on `background` ≥ 4.5:1, `warn` for warnings, `ring` ≥ 3:1).
- Targets ≥ 44 px on narrow (`max-md:h-11`).

## Defaults grid (built-in, before any edit)

Cells are `model / effort`; 권한 defaults to `auto` (Codex `auto`, a 리뷰어 on Codex `plan`). `GPT` = the first
model `codex debug models` lists. Each cell carries an ordered fallback list; the first connected, listed model
wins, else the role's built-in Claude model.

| Mode | 관리자 | 구현자 | 리뷰어 | 테스터 | 디자이너 | 문서화 |
| --- | --- | --- | --- | --- | --- | --- |
| 계획·설계 | Fable 5.2 → Opus | Fable 5.2 → Opus | Opus | Sonnet | Fable 5.2 → Opus | Sonnet |
| 구현 | Sonnet | Opus | GPT → Opus (cross-check) | Sonnet | Sonnet | Sonnet |
| 리뷰·테스트 | Sonnet | Opus | GPT → Opus (cross-check) | GPT → Sonnet | Sonnet | Sonnet |
| 문서 | Sonnet | Sonnet | Sonnet | Sonnet | Sonnet | Sonnet (adhd style, #737) |
| 빠른 수정 | Sonnet | Sonnet | Sonnet | Sonnet | Sonnet | Haiku → Sonnet |
| 조사 | GPT → Opus | GPT → Opus | Opus | Sonnet | Sonnet | Sonnet |

## Data shape (for PR 1 / PR 2)

`~/.dispatch/drawing.json` → `team.modeProfiles` (only cells the user changed; missing = built-in default):

```json
{ "team": { "modeProfiles": {
  "build": { "review": { "model": "claude-opus-5-5", "effort": "medium", "perm": "plan", "hint": "꼼꼼한 검토" } }
} } }
```

Mode ids: `plan`, `build`, `review`, `docs`, `quick`, `research`. Role ids as in `server/dispatch/roles.js`.
`hint` is plain text ≤ 40 chars (no personal data). The existing `team.roleModels` reads as the `build` mode's
`model` for old files. Saves send only changed cells, like `roleModelsPatch` today.
