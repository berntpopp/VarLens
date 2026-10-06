# Track 13 — case-list context menu opens away from the cursor

## Root cause

`CaseList.vue` rendered its context menu as `<v-menu location-strategy="static">` with
`position: fixed; left: x; top: y` on the overlay root. In Vuetify 4 the static strategy
positions content with flexbox alignment classes derived from `location`; `VMenu` defaults
`location` to `bottom`, which maps to `v-overlay--justify-center v-overlay--align-end`. The
overlay root spans from the click point to the bottom-right of the viewport, so the menu was
centred horizontally in that box and pinned to the viewport bottom — 500–850 px from the cursor.
Not related to PR #418, transforms or scroll offsets (`clientX/Y` were correct). Desktop
Electron renders the same `CaseList` from `App.vue`, so it had the same bug.

## Fix

- `useContextMenu` now yields a client-coordinate `target` point (clamped to the viewport),
  opens from the keyboard (ContextMenu key / Shift+F10) anchored at the focused item, ignores
  the browser's follow-up synthetic `contextmenu`, and restores focus to the invoking item.
- New `CaseContextMenu.vue` uses `<v-menu :target="[x, y]" location="bottom start">`
  (connected strategy: top-left at the point, flips/shifts to stay in the viewport), focuses
  the first item on open, and uses `role="menu"`/`menuitem` (the old `role=list` + `<hr>`
  divider was an axe `aria-required-children` critical).
- Cohort and shortlist views have no context menu (only `CaseList` uses `contextmenu`).

## Evidence (own instance, port 8960, 60 seeded cases)

| viewport | probe | before: menu − click (dx, dy) | after |
|---|---|---|---|
| 1366x768 | top | (567, 407) | (0, 0) |
| 1366x768 | middle | (498, 167) | (0, 0) |
| 1366x768 | scrolled | (539, 263) | (0, 0) |
| 1920x1080 | top | (844, 719) | (0, 0) |
| 1920x1080 | middle | (775, 479) | (0, 0) |
| 1920x1080 | scrolled | (816, 419) | (0, 0) |

Keyboard (both viewports): Shift+F10 and ContextMenu key open the menu at the item, focus
moves into the menu, Escape returns focus to the item. axe on the open menu: 0 violations.

Gate: `tests/ui-gates/case-context-menu.gate.ts` (runs under `make ui-gates`) — passes with the
fix, fails on the old positioning (`top x: expected <= 4, received 567.375`).
Raw data: `before.json`, `after.json`; screenshots `before-top-1366x768.png`,
`after-top-1366x768.png`, `after-scrolled-1366x768.png`.
