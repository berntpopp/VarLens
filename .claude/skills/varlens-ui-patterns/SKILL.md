---
name: varlens-ui-patterns
description: Use when building or changing VarLens renderer UI — Vue 3 + Vuetify 4 components, dialogs, side panels, data tables, colors, backgrounds, hover states, or theme work. Symptoms of about to get it wrong: reaching for surface-variant or a hardcoded hex for a background, a v-data-table-server whose row expansion silently does nothing, adding console.log in a component, or styling that looks fine in light theme but breaks in dark.
metadata:
  version: "1.0.0"
  updated: "2026-07-06"
---

# VarLens UI patterns (Vue 3 + Vuetify 4)

## Overview

VarLens is a data-dense clinical app with a WCAG-AA+ theme ("Clinical Slate", light + dark).
The full pattern catalog is `/.planning/docs/UI-PATTERNS.md` — **read it before non-trivial
UI work** (dialogs, side panels, tables, tabs, expansion panels, spacing, ARIA). This skill
is the fast index plus the traps that bite hardest.

Global Vuetify defaults live in `src/renderer/src/plugins/vuetify.ts` (density `compact`,
outlined inputs, `elevation: 1` cards, `fade-transition` everywhere). Don't re-declare defaults.

## The traps that bite hardest

1. **Never use `surface-variant` for a background.** It sits too close to `surface` and reads
   as invisible white-on-white (or dark-on-dark). Use `bg-grey-lighten-3` for subtle contrast
   (nested tables, expanded rows, filter bars) or `secondary` for strong contrast (toolbars,
   tabs, headers).
   > The exact hex values in AGENTS.md ("warm palette", `#f5f2ef`) are stale — the theme is now
   > Clinical Slate (cool-toned). The **rule** stands regardless of the hexes.

2. **`v-data-table-server` `v-model:expanded` is an array of item-key strings**, not
   `{ value, item }` objects. Pass the wrong shape and row expansion silently does nothing —
   no error, just a dead expand chevron. Bind the item-key array.

3. **Theme-aware colors use `color-mix()`, not raw theme variables.** For hover/zebra/selected
   rows: `color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent)`. A raw
   `rgb(var(--v-theme-surface-variant))` background or a hardcoded hex breaks one of the two themes.

4. **No `console.*` in renderer code.** Use `logService` from
   `src/renderer/src/services/LogService` — `logService.error(msg, 'source')`. (This is not
   lint-enforced, so it's on you.) Documented bootstrap exceptions only: `logStore.ts`, `main.ts`.

## Structural conventions (see UI-PATTERNS.md for full examples)

- **Dialogs**: `v-dialog > v-card` always. Never bare content in a dialog. `:persistent` while loading.
- **Side panels**: `v-navigation-drawer > v-card flat` with `h-100 d-flex flex-column`; scroll area is `flex-grow-1 overflow-y-auto`.
- **Tabs**: `v-tabs` + `v-tabs-window` / `v-tabs-window-item` (not the deprecated `v-window`).
- **Data tables**: share styles via `<style src="./data-table-shared.css">` (zebra, scroll sync, selection, hover, ellipsis). `VariantTable.vue` and `CohortDataTable.vue` both use it.
- **Shared logic goes in composables** (`src/renderer/src/composables/`), not in components. Props via `defineProps<T>()`, emits via `defineEmits<{...}>()`, `<script setup lang="ts">`.

## Cross-cutting

- Any filter/sort/search/column UI you build for the single-case table must ship the cohort-view
  twin in the same change — see `varlens-cohort-parity`. The two tables (`VariantTable.vue` /
  `cohort/CohortDataTable.vue`) are structural twins that share column headers and cell components.
- Verify UI by opening the app, not just typechecking — see `varlens-verify-before-done`.

## Common mistakes

- `surface-variant` background → invisible. Use `bg-grey-lighten-3` / `secondary`.
- Expanded rows do nothing → `v-model:expanded` given the wrong shape (needs string keys).
- Dark theme looks broken → hardcoded hex or raw theme var instead of `color-mix()`.
- Overriding `density` back to default → the app is intentionally `compact`; don't.
- Slide transitions on menus/tooltips → everything is `fade-transition` globally; don't override.
