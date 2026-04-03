# Performance Optimization Design Spec — Full Sweep

**Date:** 2026-03-25
**Goal:** Achieve "instant/snappy" feel comparable to VS Code by eliminating bundle bloat, reducing reactive overhead, optimizing DOM rendering, and improving IPC data flow.
**Approach:** 5 phased PRs, each independently testable, ordered by risk (lowest first).

---

## Phase 1: Zero-Risk Quick Wins

**PR scope:** Config changes, CSS tweaks, trivial code changes. No behavioral impact.
**Risk:** None

### 1.1 BrowserWindow backgroundColor
**File:** `src/main/index.ts` (BrowserWindow constructor)
**Change:** Add `backgroundColor: '#faf8f6'` to match warmLight theme surface color.
**Why:** Eliminates white flash between window creation and first paint.

### 1.2 V8 Code Caching
**File:** `src/main/index.ts` (webPreferences)
**Change:** Add `v8CacheOptions: 'bypassHeatCheck'`.
**Why:** Caches compiled JS bytecode from first load, speeding up subsequent launches.

### 1.3 Defer Auto-Updater
**File:** `src/main/index.ts` (ready-to-show handler)
**Change:** Wrap `initAutoUpdater()` and `scheduleUpdateChecks()` in `setImmediate()`.
**Why:** Auto-updater competes with app startup; deferring lets the window paint first.

### 1.4 KeepAlive for Router Views
**File:** `src/renderer/src/App.vue`
**Change:** Wrap `<router-view>` with `<KeepAlive :max="2">` using the scoped slot pattern:
```html
<router-view v-slot="{ Component }">
  <keep-alive :max="2">
    <component :is="Component" />
  </keep-alive>
</router-view>
```
**Why:** Preserves Case/Cohort view DOM and state on tab switch instead of destroying and rebuilding.

**Stale data mitigation:** Add `onActivated()` hooks in both CaseView and CohortView. On activation, compare a generation counter (incremented on import/delete/annotation changes in the Pinia store or useAppState) against the last-seen value. If changed, trigger a data refresh. This prevents stale data when the user modifies cases/annotations in one view and switches to the cached view.

### 1.5 Remove Table Row Hover Transitions
**File:** `src/renderer/src/components/VariantTable.vue` (scoped CSS)
**Change:** Remove `transition: background-color 0.15s ease` from `:deep(.v-data-table tbody tr)`.
**Why:** Instant hover response feels snappier than animated hover in data-dense UIs.

### 1.6 CSS Containment for Table Cells
**File:** `src/renderer/src/components/VariantTable.vue` (scoped CSS)
**Change:** Add `contain: layout style` to `:deep(.v-data-table tbody td)`.
**Why:** Tells the browser each cell is layout-independent, enabling layout/style optimizations. Uses `layout style` instead of `content` to avoid paint containment issues with any remaining absolutely-positioned tooltip children (AnnotationsCell keeps its own tooltips per Phase 3.1 scope).

### 1.7 Remove Plot Deep Watchers
**Files:** `src/renderer/src/components/association/ManhattanPlot.vue:117`, `VolcanoPlot.vue:108`
**Change:** Remove `{ deep: true }` from `watch(() => props.results, render, { deep: true })`.
**Why:** Results are replaced wholesale by the parent, not mutated. Shallow comparison suffices.

### 1.8 Cache getCaseCohorts in CaseList
**File:** `src/renderer/src/components/CaseList.vue`
**Change:** Add a computed `caseCohortMap` that pre-computes cohorts per case ID. Replace 2-3 template calls to `getCaseCohorts(caseItem.id)` with map lookup.
**Why:** Eliminates redundant method calls per row per render cycle.

### 1.9 markRaw on IPC Variant Data
**File:** `src/renderer/src/composables/useOffsetPagination.ts`
**Change:** Apply `markRaw()` to each individual item object in the result array, not the array itself:
```typescript
import { markRaw } from 'vue'
items.value = result.data.map(item => markRaw(item))
```
**Important:** Do NOT `markRaw()` the array itself — `shallowRef` needs to track the array reference to trigger reactivity. `markRaw` on each item prevents Vue from creating deep proxies on the individual variant objects while keeping the array trackable.
**Why:** Variant objects are read-only (replaced wholesale on page load). markRaw prevents Vue from creating reactive proxies on them, even if accessed through computed properties.

### 1.10 Remove Global Chip Animations
**File:** `src/renderer/src/assets/styles/custom.css`
**Change:** Remove the global `.v-chip` transition and `.applied-filters-bar .v-chip` entrance animation.
**Why:** Unnecessary compositor work on every chip across the app.

### Verification
- `make ci` passes
- `ls -lhS out/renderer/assets/` — no size change expected (these are runtime changes)
- Manual test: launch app, switch cases, hover table rows, switch Case/Cohort tabs

---

## Phase 2: Bundle Optimization

**PR scope:** Import pattern changes, lazy loading, build config. May affect load order.
**Risk:** Low (could break imports if tree-shaking removes something needed at runtime)

### 2.1 Vuetify Tree-Shaking Fix
**File:** `src/renderer/src/plugins/vuetify.ts`
**Change:**
- Remove `import * as components from 'vuetify/components'` (line 2)
- Remove `import * as directives from 'vuetify/directives'` (line 3)
- Remove `components` and `directives` from `createVuetify({...})`
**Why:** `vite-plugin-vuetify` with `autoImport: true` (already configured in `electron.vite.config.ts:41`) handles component registration. The wildcard import defeats tree-shaking, bundling all ~150 Vuetify components.
**Expected impact:** ~500KB-1MB JS reduction, ~500-800KB CSS reduction.

**Risk mitigation:** Some components used only in dynamic contexts (e.g., programmatic `h()` calls, string-based component resolution) may not be detected by auto-import. After building, test all views and dialogs to verify no missing components. If any are missing, add explicit imports in the files that use them.

### 2.2 Lazy-Load Routes
**File:** `src/renderer/src/router/index.ts`
**Change:** Replace static imports with dynamic imports:
```typescript
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/case' },
    { path: '/case', name: 'case', component: () => import('../views/CaseView.vue') },
    { path: '/cohort', name: 'cohort', component: () => import('../views/CohortView.vue') }
  ]
})
```
**Why:** CohortView and its dependency tree (association analysis, charts, gene burden) load even when user only uses Case mode.

### 2.3 Async Dialog Loading
**File:** `src/renderer/src/components/AppDialogHost.vue`
**Change:** Wrap rarely-opened dialogs with `defineAsyncComponent`:
- FaqDialog
- ExternalLinksSettings
- TagManagementDialog
- DatabaseOverviewDialog
- DeleteAllCasesDialog

Gate each with `v-if` on open state so they're not mounted until needed. Keep ImportDialog, BatchImportDialog, AppSnackbar, DisclaimerDialog, and CaseMetadataModal as eager (frequently used or needed at startup).

**Why:** 5 dialog component trees mounted eagerly for features rarely accessed.

### 2.4 Manual Chunk Splitting
**File:** `electron.vite.config.ts` (renderer section)
**Change:** Add build config:
```typescript
renderer: {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vuetify': ['vuetify'],
          'vue-vendor': ['vue', 'vue-router', 'pinia']
        }
      }
    }
  },
  // ... existing config
}
```
**Why:** Separates vendor code from app code. In Electron there's no HTTP cache benefit, but stable vendor chunk content hashes improve V8 code cache hits (see Phase 1.2). Use function-form `manualChunks` matching on module paths (`id.includes('node_modules/vuetify')`) to avoid conflicts with `vite-plugin-vuetify`'s import rewriting. Measure bundle after Phase 2.1 first — tree-shaking alone may make this unnecessary.

### Verification
- `make ci` passes
- `ls -lhS out/renderer/assets/` — expect significant JS/CSS reduction
- Manual test: all views, all dialogs open correctly, no missing Vuetify components
- Test both Case and Cohort routes load properly

---

## Phase 3: Rendering & Reactivity

**PR scope:** Component-level rendering optimizations and reactivity fixes.
**Risk:** Medium (behavioral changes to how components render and react)

### 3.1 Singleton Tooltip for Tables
**Files:** `src/renderer/src/components/VariantTable.vue`, all `table-cells/*.vue` components, `src/renderer/src/components/cohort/CohortDataTable.vue`

**Change:**
1. Create a `useTableTooltip` composable that manages a single tooltip:
   - Exposes `tooltipText`, `tooltipTarget`, `showTooltip` refs
   - Provides a `mouseenter` event delegation handler for the table container
   - Reads `data-tooltip` attribute from hovered elements
2. In VariantTable/CohortDataTable, mount one `v-tooltip` bound to these refs
3. In table cell components (AnnotationsCell, ClinVarCell, ConsequenceCell, AlleleCell, etc.), replace `<v-tooltip>` wrappers with `data-tooltip="..."` attributes on the activator elements
4. Keep `v-menu` instances in AnnotationsCell (menus need click interaction, not hover)

**Why:** Reduces tooltip component instances significantly per table page. Matches VS Code's singleton tooltip pattern.

**Scope exclusion:** AnnotationsCell is excluded from the singleton tooltip migration. Its 3 tooltips have complex conditional text based on annotation scope/state and the ACMG tooltip wraps a `v-menu` activator (`v-bind="{ ...menuProps, ...tooltipPropsAcmg }"`), making the `data-tooltip` approach impractical. The singleton approach applies to the simpler cells: AlleleCell, ClinVarCell, ConsequenceCell, FrequencyCell, transcript, and func columns (~6 per row x 25 rows = ~150 instances eliminated). AnnotationsCell's ~75 instances remain as a future optimization target requiring a different approach (shared composable managing tooltip state per-icon).

### 3.2 Minimize Table Re-render Cost
**File:** `src/renderer/src/components/VariantTable.vue`

**Note:** `v-memo` on table rows is NOT feasible with Vuetify's `v-data-table-server` slot architecture. The `#item` slot requires manually reconstructing the entire row DOM (all 40+ columns, sticky columns, row-props, selection state), which would be a massive error-prone refactor. Vuetify also manages internal row state (hover class, expanded state) that `v-memo` would prevent from updating.

**Alternative approach:** Rely on the combined effect of:
1. `markRaw()` on individual item objects (Phase 1.9) — prevents deep proxy creation
2. `shallowRef` for items array (already in place) — only triggers on array replacement
3. Singleton tooltip (Phase 3.1) — removes ~150 component instances from the re-diff tree
4. Annotation cache `shallowRef` (Phase 3.3) — reduces reactive proxy overhead

Together these reduce the per-render cost enough that v-memo is unnecessary. If profiling after these changes still shows row diffing as a bottleneck, a future Phase 6 could investigate a custom table renderer outside Vuetify's slot system.

### 3.3 shallowRef for Annotation Cache
**File:** `src/renderer/src/composables/useAnnotations.ts`
**Change:** Switch `annotationCache` and `loadingStates` from `ref<Map>` to `shallowRef<Map>`. Use `triggerRef()` after mutations.
**Why:** `ref()` on a Map deeply tracks every entry. With up to 5000 entries, this creates thousands of reactive proxies.

### 3.4 structuredClone Replacement
**File:** `src/renderer/src/components/variant-table/useVariantData.ts`
**Change:** Replace `JSON.parse(JSON.stringify({...}))` with `structuredClone(toRaw(filters.value))` for IPC serialization.
**Why:** `structuredClone` is 2-5x faster and semantically clearer.

### 3.5 importStatusStore Tick Optimization
**File:** `src/renderer/src/stores/importStatusStore.ts`
**Change:** Move the 1-second `setInterval` tick from the global store to the `ImportStatusBar` component itself. The store keeps `startTime` but drops the `elapsedTick` counter. The component creates a local `setInterval` in `onMounted` (cleaned up in `onUnmounted`) that only runs while the status bar is rendered.
**Why:** The current global store tick fires every second during any import, triggering reactive updates even if the status bar is not visible. Moving the timer to the consuming component scopes the reactive updates to when the UI actually needs them. This is a minimal change — the store still manages import state, just not the display timer.

### 3.6 GeneBurdenTable Pagination
**File:** `src/renderer/src/components/GeneBurdenTable.vue`
**Change:** Replace the current "load all on mount" pattern with `useOffsetPagination` (same composable used by VariantTable). Requires adding pagination support to the `cohort:geneBurden` IPC handler (offset/limit params).
**Why:** Currently loads entire dataset on mount — can be thousands of rows.

### 3.7 Lazy Detail Panel Sections
**File:** `src/renderer/src/components/VariantDetailsPanel.vue`
**Change:** Wrap non-critical sections with `defineAsyncComponent` or defer with `v-if` + `requestIdleCallback`:
- Keep **VariantIdentitySection** and **TranscriptSection** immediate (critical info)
- Defer **AcmgClassificationPanel**, **CommentsSection**, **ActivityLogPanel**, **ExternalLinksSection** until after initial paint
**Why:** Panel "snaps" open immediately without micro-stutter from rendering 5+ complex sub-components.

### Verification
- `make ci` passes
- Manual test: table row selection feels instant, tooltip appears on hover with correct text, annotation updates reflect immediately
- Manual test: import status bar updates correctly, GeneBurdenTable paginates
- Manual test: VariantDetailsPanel opens instantly, deferred sections appear after brief delay

---

## Phase 4: IPC & Data Flow

**PR scope:** Backend IPC handler changes and client-side data flow optimizations.
**Risk:** Medium (new IPC handlers, behavioral changes to data loading)

### 4.1 Bulk Sidebar Metadata
**Files:** `src/main/ipc/handlers/cases.ts` (new handler), `src/renderer/src/components/CaseList.vue`

**Change:**
1. Add `cases:bulkMetadata` IPC handler that accepts an array of case IDs and returns metadata for all of them in a single query (cohort memberships, HPO terms, status icons)
2. In CaseList, replace the `Promise.all(cases.map(loadMetadata))` pattern with a single `api.cases.bulkMetadata(caseIds)` call

**Why:** Current pattern fires N individual IPC requests (one per case). With 50 cases, that's 50 IPC round-trips causing "waterfall" loading.

### 4.2 Predictive Page Pre-fetch
**File:** `src/renderer/src/composables/useOffsetPagination.ts`

**Change:**
1. After loading page N, schedule a pre-fetch of page N+1 via `requestIdleCallback`
2. Store pre-fetched data in a `Map<string, T[]>` keyed by `${filterHash}:${page}:${sortHash}`
3. On page navigation, check cache first — serve instantly if available
4. Invalidate cache on filter/sort change
5. Cap cache at 3 pages (N-1, N, N+1)

**Why:** Page navigation becomes instant when the next page is already in memory.

### 4.3 AssociationDataBuilder to db-worker
**Files:** `src/main/statistics/AssociationEngine.ts`, `src/main/workers/db-worker.ts`

**Change:**
1. Add `association:build` task type to db-worker
2. Move `AssociationDataBuilder.build()` logic into the worker
3. In AssociationEngine, dispatch `dbPool.run({ type: 'association:build', params })` instead of calling `builder.build()` on main thread

**Why:** `build()` executes a heavy SQL query and JS grouping that can block the main thread for seconds on large datasets (1500 cases x 7k variants).

### 4.4 database:overview to db-worker
**Files:** `src/main/ipc/handlers/database.ts`, `src/main/workers/db-worker.ts`

**Change:**
1. Add `database:overview` task type to db-worker
2. Move `getDatabaseOverview()` call and BigInt conversion into the worker
3. Handler dispatches to pool instead of running synchronously

**Why:** Aggregate queries across entire database block main thread, causing jank when opening the overview modal.

### Verification
- `make ci` passes
- Manual test: CaseList sidebar loads all cases simultaneously (no staggered appearance)
- Manual test: page forward/back in variant table is instant (pre-fetched)
- Manual test: gene burden comparison doesn't freeze the UI
- Manual test: database overview modal opens without jank

---

## Phase 5: Large Migrations

**PR scope:** Cross-cutting changes touching many files.
**Risk:** High effort (many files), low runtime risk

### 5.1 @mdi/js Icon Migration
**Scope:** 329 icon usages across 83 files

**Change:**
1. Install `@mdi/js` package
2. In `vuetify.ts`, switch icon set from `mdi` (font) to `mdi-svg`:
   ```typescript
   import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
   ```
3. Remove `import '@mdi/font/css/materialdesignicons.css'`
4. In each component, replace string icon references with imported SVG paths:
   ```typescript
   // Before (font icon)
   <v-icon>mdi-star</v-icon>

   // After (SVG path)
   import { mdiStar } from '@mdi/js'
   <v-icon :icon="mdiStar" />
   ```
5. For icons used in config files (`filterGroups.ts`, `columnGroups.ts`, `disclaimerConfig.json`), import and export the icon paths from a central `icons.ts` module.

**Why:** Eliminates ~4MB of font files (eot, ttf, woff, woff2) and 1.7MB of CSS. Tree-shaking ensures only the ~100 actually-used icons are bundled as tiny SVG path strings.

**Migration strategy:** Can be done file-by-file. Each file is independently testable after conversion.

### 5.2 Plotly Bundle Reduction
**Files:** `src/renderer/src/components/association/ManhattanPlot.vue`, `VolcanoPlot.vue`, `package.json`

**Change:**
1. Check which Plotly trace types are used (likely: `scatter`, `scattergl`)
2. If only basic traces: replace `plotly.js-dist-min` with `plotly.js-basic-dist-min` (~1MB vs 7.1MB)
3. If custom traces needed: build a custom Plotly bundle with only required trace types

**Why:** 7.1MB chunk (already lazy-loaded) reduced to ~1MB. Only affects cohort/association views.

### Verification
- `make ci` passes
- `ls -lhS out/renderer/assets/` — expect ~4MB reduction from icons, ~6MB from plotly
- Manual test: all icons render correctly across all views
- Manual test: Manhattan and Volcano plots render correctly

---

## What NOT to Do

Per the existing PERFORMANCE_REPORT.md analysis:

| Anti-pattern | Why |
|:---|:---|
| Virtual scrolling (`v-data-table-virtual`) | Vuetify's implementation has known issues with wide tables (43+ columns = 12-20s render, 2GB+ RAM). Server-side pagination with ~25 rows is the correct approach. |
| SharedArrayBuffer for IPC | Requires COOP/COEP headers, adds complexity. Structured clone is fast enough for paginated results. |
| Migrating all remaining small IPC handlers to pool | Small datasets (tags, presets, gene-lists). Pool overhead may exceed query time. |
| Replace Vuetify with shadcn-vue/Tailwind | 80+ component files, 4-6 week rewrite for problems solvable with tree-shaking fix. |

---

## Success Metrics

| Metric | Before | Target |
|:---|:---|:---|
| Renderer JS bundle | ~3.0MB | < 1.5MB |
| Renderer CSS bundle | ~1.3MB | < 600KB |
| Icon font assets | ~3.5MB | 0 (SVG paths in JS) |
| Plotly chunk | 7.1MB | ~1MB |
| Total renderer assets | ~15MB | < 5MB |
| Tooltip instances per table page | ~225 | ~76 (1 singleton + ~75 AnnotationsCell) |
| Time to first paint after window show | Measured baseline | < 500ms |
| Case/Cohort tab switch | Destroy + rebuild | Instant (KeepAlive) |
| Page forward in variant table | Wait for query | Instant (pre-fetched) |
