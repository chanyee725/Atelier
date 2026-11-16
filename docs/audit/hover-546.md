# Hover audit (#546, E521)

Clickable elements that had no hover or pointer today (found with onClick grep + class review).

Fixed on this branch:
- components/ui/button.tsx: no `cursor: pointer` on any Button (hover colours already existed)
- components/ui/tabs.tsx, toggle-group.tsx, switch.tsx: no pointer
- components/ui/sidebar.tsx: menu buttons and row actions: no pointer, no colour transition
- App.tsx:834 error banner dismiss button: underline only, no hover
- dispatch/index.tsx: top nav links and 상시 화면 link: text colour only, no background (selected keeps bg-muted on hover)
- run/PlanStrip.tsx (시작하기), run/RunStrip.tsx (계획 다시 열기): `hover:bg-primary` cancelled the default hover; now only when aria-disabled
- canvas/CodeBadges.tsx: text colour only, no background, no pointer
- canvas/clean.css: Excalidraw toolbar, menu items, zoom buttons: pointer + short fade (reduced-motion off)

Still open (blocked, index.css waits for #544):
- Global pointer for plain `button`/`a` in index.css; `.doc-wikilink:hover`, `.doc-slash button`, `.doc-table-bar button`, `.doc-outline li > button`, `.doc-diagram-actions button`, `.run-motion` have colour hover but no transition and some no pointer
- Not touched (other owners): SidebarModels.tsx, ThemeMenu.tsx, Sidebar.tsx (ICON_BUTTON rows), settings/*
