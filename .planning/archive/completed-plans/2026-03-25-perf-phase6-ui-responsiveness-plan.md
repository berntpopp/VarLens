# Phase 6: UI Responsiveness & Perceived Speed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VarLens feel as snappy as VS Code by eliminating animation lag, reducing unnecessary reactivity work, parallelizing blocking IPC calls, and adding instant visual feedback.

**Architecture:** Pure renderer-side changes — no main-process or IPC protocol modifications. Changes target Vuetify global defaults, CSS transition overrides, Vue watcher optimization, and async component loading fallbacks. Each task is independently deployable and testable.

**Tech Stack:** Vue 3 (shallowRef, v-memo, computed), Vuetify 3 (global defaults, transition CSS), CSS (`content-visibility`, `will-change`, transition duration overrides)

**Audit:** See `.planning/docs/frontend-responsiveness-audit.md` for the full analysis backing these changes.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/src/plugins/vuetify.ts` | Modify:97-125 | Add `ripple: false`, transition overrides, tooltip/menu delay |
| `src/renderer/src/assets/styles/custom.css` | Modify (append) | Desktop-fast transition durations, `content-visibility`, `will-change` |
| `src/renderer/src/components/FilterToolbar.vue` | Modify:582-585 | Parallelize onMounted IPC calls |
| `src/renderer/src/components/variant-table/useVariantData.ts` | Modify:133 | Replace deep watcher with computed key |
| `src/renderer/src/composables/useFilterState.ts` | Modify:420-427 | Replace deep watcher with computed key |
| `src/renderer/src/composables/useOffsetPagination.ts` | Modify:204-217 | Replace deep watcher with serialized comparison |
| `src/renderer/src/components/CaseList.vue` | Modify:313-314 | Remove unnecessary `deep: true` on primitive arrays |
| `src/renderer/src/components/cohort/CohortFilterBar.vue` | Modify:240-263,444 | Replace deep watchers with computed keys |
| `src/renderer/src/components/SectionSkeleton.vue` | Create | Skeleton loader SFC for async component fallback |
| `src/renderer/src/components/VariantDetailsPanel.vue` | Modify:181-185 | Add loading fallbacks to defineAsyncComponent |
| `src/renderer/src/stores/logStore.ts` | Modify:52 | Switch `ref` to `shallowRef` |
| `src/renderer/src/components/LogViewer.vue` | Modify:259-271 | RAF-batch scroll handler |
| `src/renderer/src/components/DslSearchBar.vue` | Modify:181-186 | Clean up setTimeout on unmount |
| `src/renderer/src/components/SlimFilterToolbar.vue` | Modify:198-200,241 | Reduce animation from 300ms to 200ms |
| `tests/renderer/composables/useOffsetPagination.test.ts` | Modify | Verify sort watcher still works without `deep` |
| `tests/renderer/composables/useFilters.test.ts` | Modify | Verify filter emission still debounced |

---

### Task 1: Disable Ripple & Add Vuetify Global Defaults for Speed

**Files:**
- Modify: `src/renderer/src/plugins/vuetify.ts:97-125`

- [ ] **Step 1: Read the current defaults block**

Verify the current content at lines 97-125 matches expectations.

- [ ] **Step 2: Update the defaults block**

Replace the `defaults` object (lines 97-125) with:

```ts
  defaults: {
    global: {
      density: 'compact',
      ripple: false
    },
    VBtn: {
      density: 'compact',
      ripple: false
    },
    VTextField: {
      density: 'compact',
      variant: 'outlined'
    },
    VSelect: {
      density: 'compact',
      variant: 'outlined',
      transition: 'fade-transition'
    },
    VAutocomplete: {
      density: 'compact',
      variant: 'outlined',
      transition: 'fade-transition'
    },
    VDataTable: {
      density: 'compact'
    },
    VCard: {
      elevation: 2
    },
    VDialog: {
      eager: false
    },
    VMenu: {
      transition: 'fade-transition',
      openDelay: 0,
      closeDelay: 0
    },
    VTooltip: {
      openDelay: 400,
      closeDelay: 0,
      transition: 'fade-transition',
      contentClass: 'bg-secondary'
    },
    // Note: verify `disableResizeWatcher` exists in installed Vuetify version
    // (check VNavigationDrawer API docs). If not, Vuetify silently ignores it.
    VNavigationDrawer: {
      disableResizeWatcher: true
    },
    VSnackbar: {
      transition: 'fade-transition'
    }
  }
```

- [ ] **Step 3: Run dev server and verify visually**

Run: `make dev`
Verify: Click buttons — no ripple effect. Open menus/tooltips — instant. Drawers open/close faster.

- [ ] **Step 4: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/plugins/vuetify.ts
git commit -m "perf: disable ripple and add speed-focused Vuetify global defaults"
```

---

### Task 2: CSS Transition Duration Overrides for Desktop Speed

**Files:**
- Modify: `src/renderer/src/assets/styles/custom.css` (append after line 139)

- [ ] **Step 1: Append desktop-fast transition overrides**

Add at the end of `custom.css`:

```css
/* -------------------------------------------------------------------------
   Desktop-fast Vuetify transitions (100ms enter, 75ms exit)
   Material Design 3 recommends 100-200ms for desktop apps.
   ------------------------------------------------------------------------- */
.fade-transition-enter-active,
.scale-transition-enter-active,
.slide-x-transition-enter-active,
.slide-y-transition-enter-active,
.scroll-y-transition-enter-active,
.dialog-transition-enter-active {
  transition-duration: 100ms !important;
}

.fade-transition-leave-active,
.scale-transition-leave-active,
.slide-x-transition-leave-active,
.slide-y-transition-leave-active,
.scroll-y-transition-leave-active,
.dialog-transition-leave-active {
  transition-duration: 75ms !important;
}

/* Overlay backdrop fades faster */
.v-overlay__scrim {
  transition-duration: 100ms !important;
}

/* Navigation drawer slide: fast but not instant (retains spatial context) */
.v-navigation-drawer {
  transition-duration: 150ms !important;
  will-change: transform;
}

/* CSS containment on table rows for rendering isolation */
.v-data-table__tr {
  contain: layout style paint;
}
```

- [ ] **Step 2: Run dev server and verify animations**

Run: `make dev`
Verify: Open/close dialogs, menus, drawers — all feel significantly faster. No visual glitches or clipping.

- [ ] **Step 3: Run lint**

Run: `make lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/styles/custom.css
git commit -m "perf: add desktop-fast CSS transition overrides (100ms enter, 75ms exit)"
```

---

### Task 3: Parallelize FilterToolbar onMounted IPC Calls

**Files:**
- Modify: `src/renderer/src/components/FilterToolbar.vue:582-585`

- [ ] **Step 1: Read the onMounted block**

Verify lines 582-585 contain:
```ts
onMounted(async () => {
  await loadFilterOptions(props.caseId)
  await loadPresets()
})
```

- [ ] **Step 2: Replace with Promise.all**

Change lines 582-585 to:
```ts
onMounted(async () => {
  await Promise.all([loadFilterOptions(props.caseId), loadPresets()])
})
```

- [ ] **Step 3: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `make test`
Expected: All tests pass. No FilterToolbar-specific test exists, so ensure no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FilterToolbar.vue
git commit -m "perf: parallelize filter options and presets loading in FilterToolbar onMounted"
```

---

### Task 4: Replace Deep Watchers with Computed Keys

This task eliminates 6 deep watchers across the codebase, replacing them with serialized computed keys or removing unnecessary `deep: true`.

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts:133`
- Modify: `src/renderer/src/composables/useFilterState.ts:420-427`
- Modify: `src/renderer/src/composables/useOffsetPagination.ts:204-217`
- Modify: `src/renderer/src/components/CaseList.vue:313-314`
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue:240-263,444`
- Test: `tests/renderer/composables/useOffsetPagination.test.ts`
- Test: `tests/renderer/composables/useFilters.test.ts`

- [ ] **Step 4.1: Fix useVariantData.ts — column filter deep watcher**

Read line 133 and verify it contains:
```ts
watch(columnFilterState.columnFilters, debouncedColumnFilterReload, { deep: true })
```

The `useColumnFilters` composable already uses **reference replacement** for every mutation (e.g., `columnFilters.value = { ...columnFilters.value, [columnKey]: filter }`), so deep watching is unnecessary — a plain watch detects reference changes. Simply remove `{ deep: true }`:

```ts
const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)
watch(columnFilterState.columnFilters, debouncedColumnFilterReload)
```

- [ ] **Step 4.2: Fix useFilterState.ts — filter emission deep watcher**

Read lines 420-427 and verify the deep watcher on `filters`. Replace with:

```ts
  // Watch filters and emit changes (serialized key avoids deep traversal)
  const filterEmitKey = computed(() => JSON.stringify(filters.value))
  watch(filterEmitKey, () => {
    debouncedEmit()
  })
```

Ensure `computed` is imported from `vue` (it should be already).

- [ ] **Step 4.3: Fix useOffsetPagination.ts — sort watcher**

Read lines 204-217. `sortBy` is an array of `{ key, order }` objects — deep watching traverses all properties on every change. The watcher already does manual serialization internally, so extract that into a computed key.

Replace lines 204-217 with:
```ts
  // Watch sort changes — reset page and clear pre-fetch cache.
  const sortKey = computed(() =>
    normalizeSortBy(sortBy.value)
      .map((s) => `${s.key}:${s.order}`)
      .join(',')
  )
  watch(sortKey, (serialized) => {
    if (serialized === prevSortSerialized) return
    prevSortSerialized = serialized
    prefetchCache.clear()
    page.value = 1
    options.onSortChange?.(sortBy.value.length > 0)
  })
```

Note: `computed` is already imported at line 10: `import { ref, shallowRef, watch, type Ref } from 'vue'` — add `computed` to this import.

- [ ] **Step 4.4: Fix CaseList.vue — primitive array watchers**

Read lines 313-314. These watch `ref<number[]>` and `ref<string[]>` — arrays of primitives. When the user selects/deselects, Vue replaces the array reference via v-model. Remove `deep: true`:

Change:
```ts
watch(selectedCohortIds, resetList, { deep: true })
watch(selectedHpoIds, resetList, { deep: true })
```
to:
```ts
watch(selectedCohortIds, resetList)
watch(selectedHpoIds, resetList)
```

- [ ] **Step 4.5: Fix CohortFilterBar.vue — preset divergence deep watcher**

Read lines 240-263. This watches `[filters, selectedImpactPresets]` deeply. Replace with a computed key:

Change lines 240-263 to:
```ts
// Auto-deactivate presets when user manually changes filter values
const presetDivergenceKey = computed(() =>
  JSON.stringify([filters.value, selectedImpactPresets.value])
)
watch(presetDivergenceKey, () => {
  if (applyingPresets || activePresetIds.value.size === 0) return
  const idsToDeactivate: number[] = []
  for (const id of activePresetIds.value) {
    const preset = allPresets.value.find((p) => p.id === id)
    if (
      preset !== undefined &&
      isPresetDiverged({
        filters: filters.value,
        presetFilterJson: preset.filterJson,
        consequencesValue: selectedImpactPresets.value
      })
    ) {
      idsToDeactivate.push(id)
    }
  }
  for (const id of idsToDeactivate) {
    togglePreset(id)
  }
})
```

- [ ] **Step 4.6: Fix CohortFilterBar.vue — filter emission deep watcher**

Read line 444. Change:
```ts
watch(filters, () => emitFilterChange(), { deep: true })
```
to:
```ts
const cohortFilterKey = computed(() => JSON.stringify(filters.value))
watch(cohortFilterKey, () => emitFilterChange())
```

Ensure `computed` import is present.

- [ ] **Step 4.7: Run all tests**

Run: `make test`
Expected: All pass. Pay special attention to:
- `tests/renderer/composables/useOffsetPagination.test.ts`
- `tests/renderer/composables/useFilters.test.ts`
- `tests/renderer/composables/useFilterPresets.test.ts`
- `tests/renderer/composables/useColumnFilters.test.ts`
- `tests/renderer/components/CohortFilterBar.test.ts`

- [ ] **Step 4.8: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 4.9: Commit**

```bash
git add src/renderer/src/components/variant-table/useVariantData.ts \
        src/renderer/src/composables/useFilterState.ts \
        src/renderer/src/composables/useOffsetPagination.ts \
        src/renderer/src/components/CaseList.vue \
        src/renderer/src/components/cohort/CohortFilterBar.vue
git commit -m "perf: replace deep watchers with computed serialized keys (6 instances)"
```

---

### Task 5: Add Loading Fallbacks to Async Detail Panel Sections

**Files:**
- Create: `src/renderer/src/components/SectionSkeleton.vue`
- Modify: `src/renderer/src/components/VariantDetailsPanel.vue:181-185`

- [ ] **Step 1: Create the skeleton fallback SFC**

Vuetify components do not resolve in inline template strings (Vite ships the runtime-only Vue build — no template compiler). Create a proper SFC:

Create `src/renderer/src/components/SectionSkeleton.vue`:
```vue
<template>
  <v-skeleton-loader type="list-item-three-line" class="my-2" />
</template>
```

- [ ] **Step 2: Read current defineAsyncComponent declarations**

Verify lines 181-185 contain the 5 `defineAsyncComponent` calls without loading fallbacks.

- [ ] **Step 3: Add loading component option**

Replace lines 181-185 with:

```ts
import SectionSkeleton from './SectionSkeleton.vue'

const asyncOpts = { delay: 0, loadingComponent: SectionSkeleton }

const ExternalLinksSection = defineAsyncComponent({
  loader: () => import('./ExternalLinksSection.vue'),
  ...asyncOpts
})
const CommentsSection = defineAsyncComponent({
  loader: () => import('./CommentsSection.vue'),
  ...asyncOpts
})
const TagsSection = defineAsyncComponent({
  loader: () => import('./TagsSection.vue'),
  ...asyncOpts
})
const AcmgClassificationPanel = defineAsyncComponent({
  loader: () => import('./AcmgClassificationPanel.vue'),
  ...asyncOpts
})
const ActivityLogPanel = defineAsyncComponent({
  loader: () => import('./ActivityLogPanel.vue'),
  ...asyncOpts
})
```

- [ ] **Step 3: Run dev server and verify**

Run: `make dev`
Open a variant detail panel. On first load, sections should show skeleton placeholders briefly before content appears.

- [ ] **Step 4: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/VariantDetailsPanel.vue
# If SectionSkeleton.vue was created:
# git add src/renderer/src/components/SectionSkeleton.vue
git commit -m "perf: add skeleton loading fallbacks for async detail panel sections"
```

---

### Task 6: Switch logStore entries to shallowRef

**Files:**
- Modify: `src/renderer/src/stores/logStore.ts:52`

- [ ] **Step 1: Read logStore.ts and check imports**

Verify line 52 contains `const entries = ref<LogEntry[]>([])`.
Check which Vue imports are at the top of the file.

- [ ] **Step 2: Change ref to shallowRef**

Change line 52 from:
```ts
const entries = ref<LogEntry[]>([])
```
to:
```ts
const entries = shallowRef<LogEntry[]>([])
```

Add `shallowRef` to the Vue import at the top of the file. For example, if the import is:
```ts
import { ref, computed } from 'vue'
```
Change to:
```ts
import { ref, computed, shallowRef } from 'vue'
```

- [ ] **Step 3: Fix entry mutations to use array replacement**

With `shallowRef`, in-place mutations like `.push()` and `.shift()` will **not trigger reactivity**. The `addEntry` function at lines 71-91 currently uses both. Replace lines 76-82:

```ts
    // BEFORE (lines 76-82):
    if (entries.value.length >= maxEntries.value) {
      entries.value.shift()
      stats.value.totalDropped++
    }
    entries.value.push({ ...entry, id })

    // AFTER:
    if (entries.value.length >= maxEntries.value) {
      entries.value = [...entries.value.slice(1), { ...entry, id }]
      stats.value.totalDropped++
    } else {
      entries.value = [...entries.value, { ...entry, id }]
    }
```

Also check for `clearEntries` or similar functions in the store. If there is a clear function that does `entries.value.length = 0` or `entries.value.splice(0)`, change it to `entries.value = []`.

- [ ] **Step 4: Run tests**

Run: `make test`
Expected: PASS

- [ ] **Step 5: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/stores/logStore.ts
git commit -m "perf: use shallowRef for log entries to avoid deep reactivity on large arrays"
```

---

### Task 7: RAF-Batch LogViewer Scroll Handler & Fix DslSearchBar setTimeout Leak

**Files:**
- Modify: `src/renderer/src/components/LogViewer.vue:259-271`
- Modify: `src/renderer/src/components/DslSearchBar.vue:181-186`

- [ ] **Step 7.1: RAF-batch the scroll handler in LogViewer**

Read lines 258-271. Replace `handleScroll` with:

```ts
// Handle scroll — RAF-batched to avoid firing hundreds of times per second
let scrollTicking = false
function handleScroll(event: Event): void {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    const target = event.target as HTMLElement
    if (target !== null) {
      const { scrollTop, scrollHeight, clientHeight } = target
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50
      if (!isNearBottom) {
        isAutoScroll.value = false
      }
    }
    scrollTicking = false
  })
}
```

- [ ] **Step 7.2: Fix DslSearchBar setTimeout leak**

Read lines 181-186. Replace with:

```ts
let blurTimeout: ReturnType<typeof setTimeout> | null = null

function onBlur(): void {
  // Delay to allow click on suggestion to fire first
  blurTimeout = globalThis.setTimeout(() => {
    showMenu.value = false
  }, 200)
}
```

Then find the `onBeforeUnmount` hook (or add one) and add cleanup:

```ts
onBeforeUnmount(() => {
  if (blurTimeout !== null) {
    clearTimeout(blurTimeout)
  }
})
```

If `onBeforeUnmount` is not already imported, add it to the Vue import.

- [ ] **Step 7.3: Run lint and typecheck**

Run: `make lint && make typecheck`
Expected: PASS

- [ ] **Step 7.4: Run tests**

Run: `make test`
Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
git add src/renderer/src/components/LogViewer.vue \
        src/renderer/src/components/DslSearchBar.vue
git commit -m "perf: RAF-batch LogViewer scroll handler and fix DslSearchBar setTimeout leak"
```

---

### Task 8: Reduce Count-Pulse Animation Duration

**Files:**
- Modify: `src/renderer/src/components/SlimFilterToolbar.vue:198-200,241`

- [ ] **Step 1: Read the animation code**

Verify:
- Line 198-200: JavaScript timeout `}, 300)` that removes the pulse state
- Line 241: CSS rule `animation: count-pulse 300ms ease;`

- [ ] **Step 2: Change 300ms to 200ms in both places**

At line 200, change the setTimeout duration:
```ts
// BEFORE:
    }, 300)
// AFTER:
    }, 200)
```

At line 241, change the CSS animation duration:
```css
/* BEFORE: */
  animation: count-pulse 300ms ease;
/* AFTER: */
  animation: count-pulse 200ms ease;
```

- [ ] **Step 3: Run lint**

Run: `make lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SlimFilterToolbar.vue
git commit -m "perf: reduce count-pulse animation from 300ms to 200ms for snappier feedback"
```

---

### Task 9: Final Validation

- [ ] **Step 1: Run full CI suite**

Run: `make ci`
Expected: lint + typecheck + test all pass.

- [ ] **Step 2: Visual smoke test**

Run: `make dev`

Test these interactions and verify they feel snappy:
1. Open/close filter drawer — should feel instant (~150ms)
2. Open/close columns drawer — same
3. Click buttons — no ripple, instant feedback
4. Hover tooltips — appear after 400ms delay, fade in quickly
5. Open dialogs — fast fade, no sluggish scale
6. Type in search bar — suggestions appear without lag
7. Switch variant selection — detail panel sections show skeleton then content
8. Open LogViewer — scroll smoothly without jank
9. Toggle filters — result count updates with snappy pulse animation

- [ ] **Step 3: Commit any final fixups if needed**

---

## Summary

| Task | Change | Expected Impact |
|------|--------|----------------|
| 1 | Ripple off + Vuetify speed defaults | Every click/menu/tooltip feels instant |
| 2 | CSS transition overrides (100/75ms) | Dialogs, drawers, overlays 2-3x faster |
| 3 | Promise.all in FilterToolbar | 100-300ms saved on case load |
| 4 | Replace 6 deep watchers | ~20-30% less CPU during filtering |
| 5 | Skeleton fallbacks on async sections | No blank pop-in on detail panel |
| 6 | shallowRef for log entries | Less GC pressure with large log buffers |
| 7 | RAF scroll + setTimeout cleanup | Smoother scroll, no memory leak |
| 8 | Faster count-pulse animation | Snappier filter result feedback |

---

## Deferred to Future Phases

These items from the audit are intentionally excluded from Phase 6:

| Item | Rationale |
|------|-----------|
| **Optimistic updates** (tags, flags, ACMG, comments) | Requires store-level rollback patterns and error handling changes — medium effort, better as standalone Phase 7 |
| **Batch case-metadata IPC** (`case-metadata:getAll`) | Requires main-process IPC handler changes, contrary to Phase 6's renderer-only scope |
| **`v-memo` on variant table rows** | Lower priority polish; requires careful testing with selection/expansion state |
| **`v-if` → `v-show` conversions** (FilterDrawer panels, LogViewer) | Trade-off between memory and render time — benchmark first |
| **Hover-to-prefetch** (variant detail on row hover) | Nice-to-have; requires prefetch infrastructure in composables |
| **Missing `:key` bindings** (FilterDrawer presets, CaseList cohort chips) | Very low impact — stable data, small lists |
| **`content-visibility: auto` on detail panel sections** | Requires adding a CSS class to VariantDetailsPanel section wrappers — bundle with a future template refactor |
