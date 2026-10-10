# Performance Instrumentation & Budgets Implementation Plan

> **Status: COMPLETED** — All 7 tasks implemented in PR #139. PerfOverlay removed in favor of existing logService.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VarLens perceived responsiveness measurable by adding lightweight performance instrumentation, defining interaction budgets, and surfacing timing data in dev mode — raising the Performance score from 7.0 to 8.0+.

**Architecture:** A `PerfTrace` service in the renderer records user-flow timings (case switch, filter apply, page navigate) using `performance.now()`. Traces are measured at the **user-visible completion** level — not just IPC/fetch latency, but including annotation hydration and render. The main process measures startup through to renderer-reported "interactive" via an IPC handshake. All instrumentation is dev-gated: renderer uses `import.meta.env.DEV`, main process uses `is.dev` from `@electron-toolkit/utils`. `useApiService` is NOT modified — IPC tracing is opt-in at call sites via `traceAsync`, preserving the existing API identity contract.

**Tech Stack:** Vue 3 Composition API, `performance.now()`, existing LogService/MainLogger, Vitest

---

## Current State

VarLens already has strong performance primitives:
- Worker thread pool (Piscina) for heavy DB reads
- `shallowRef` + `markRaw` for large datasets (annotations, variants)
- LRU caching with microtask batching for annotations
- Debounced filters (300ms), serialized filter keys (no deep watches)
- Route code splitting with idle-time prefetch
- Async components for non-critical UI
- Row view model caching for stable table props

**What's missing:** Zero instrumentation. No `performance.now()`, no timing, no budgets.

## Design Decisions (addressing review feedback)

1. **Startup = renderer-reported interactive, not `did-finish-load`**: The main process records milestones up to window creation. The renderer reports "app-interactive" back to main via IPC after `App.vue` `onMounted` completes and the first data fetch fires. This captures mock API injection, app bootstrap, and initial store hydration.

2. **Traces at user-flow level, not paginator internals**: `useOffsetPagination.loadPage()` is shared across page nav, filter apply, sort, case switch, and retry. Instrumenting it would generate misleading per-budget data. Instead, traces are placed at the **interaction entry points**: the case-switch watcher in `useVariantData.ts`, the filter-key watcher, and explicit page/sort change handlers. Each flow traces from trigger through annotation hydration to completion.

3. **useApiService is NOT proxied**: The existing test (`useApiService.test.ts:46`) asserts identity (`result.api === mockApi`). Additionally, some code bypasses `useApiService` entirely (`databaseStore.ts`, `LogService.ts`). Instead, IPC timing is opt-in via `traceAsync()` at specific high-value call sites — not a transparent proxy.

4. **Main-process dev gating uses `is.dev`**: The main process uses `is.dev` from `@electron-toolkit/utils` (per `src/main/index.ts:193`), not `import.meta.env.DEV`. `MainPerfTrace` gates all logging behind `is.dev`.

5. **No phantom files or unrelated tasks**: Removed `usePerfTrace.ts` (no task creates it). Removed coverage threshold auto-update task (handled by `autoUpdate: true` already).

## File Structure

### New Files

| File | Purpose |
|------|---------|
| `src/shared/config/perf-budgets.ts` | Interaction budget definitions |
| `src/renderer/src/services/PerfTrace.ts` | Renderer-side performance tracing service |
| `src/main/services/MainPerfTrace.ts` | Main-process startup timing (dev-gated via `is.dev`) |
| `src/renderer/src/components/dev/PerfOverlay.vue` | Dev-only overlay showing recent traces |
| `tests/shared/config/perf-budgets.test.ts` | Tests for budget definitions |
| `tests/renderer/services/PerfTrace.test.ts` | Tests for PerfTrace |

### Modified Files

| File | Change |
|------|--------|
| `src/main/index.ts` | Add startup milestones + renderer "interactive" IPC listener |
| `src/renderer/src/App.vue` | Report "app-interactive" to main after onMounted; mount PerfOverlay |
| `src/renderer/src/components/variant-table/useVariantData.ts` | Trace case-switch and filter-apply flows through annotation hydration |
| `src/renderer/src/components/CohortTable.vue` | Trace cohort page/filter flows through annotation hydration |
| `src/preload/index.ts` | Add `perf:interactive` IPC channel |

---

## Task 1: Define performance budgets

**Files:**
- Create: `src/shared/config/perf-budgets.ts`
- Create: `tests/shared/config/perf-budgets.test.ts`

- [ ] **Step 1: Create budget definitions**

```typescript
// src/shared/config/perf-budgets.ts

/**
 * Performance budgets for key VarLens interactions.
 *
 * Warning thresholds, not hard limits. When an interaction exceeds
 * its budget, the perf trace logs a warning in dev mode.
 * All values in milliseconds.
 */
export const PERF_BUDGETS = {
  /** Cold start: app launch to renderer reports interactive */
  STARTUP_TO_INTERACTIVE: 3000,

  /** Case switch: selecting a different case to rows + annotations visible */
  CASE_SWITCH: 1000,

  /** Filter apply: changing a filter to updated rows + annotations visible */
  FILTER_APPLY: 500,

  /** Page navigation: clicking next/prev to rows + annotations visible */
  PAGE_NAVIGATE: 300,

  /** Sort change: clicking a column header to sorted rows visible */
  SORT_CHANGE: 500,

  /** Annotation hydration: loading annotations for a page of variants */
  ANNOTATION_HYDRATE: 200,

  /** Export initiation: from click to save dialog or progress start */
  EXPORT_START: 500
} as const

export type PerfBudgetKey = keyof typeof PERF_BUDGETS
```

- [ ] **Step 2: Write tests**

```typescript
// tests/shared/config/perf-budgets.test.ts
import { describe, it, expect } from 'vitest'
import { PERF_BUDGETS } from '../../../src/shared/config/perf-budgets'

describe('PERF_BUDGETS', () => {
  it('defines all expected budget keys', () => {
    expect(PERF_BUDGETS.STARTUP_TO_INTERACTIVE).toBeGreaterThan(0)
    expect(PERF_BUDGETS.CASE_SWITCH).toBeGreaterThan(0)
    expect(PERF_BUDGETS.FILTER_APPLY).toBeGreaterThan(0)
    expect(PERF_BUDGETS.PAGE_NAVIGATE).toBeGreaterThan(0)
    expect(PERF_BUDGETS.ANNOTATION_HYDRATE).toBeGreaterThan(0)
  })

  it('has reasonable ordering (page < filter < case < startup)', () => {
    expect(PERF_BUDGETS.PAGE_NAVIGATE).toBeLessThanOrEqual(PERF_BUDGETS.FILTER_APPLY)
    expect(PERF_BUDGETS.FILTER_APPLY).toBeLessThanOrEqual(PERF_BUDGETS.CASE_SWITCH)
    expect(PERF_BUDGETS.CASE_SWITCH).toBeLessThanOrEqual(PERF_BUDGETS.STARTUP_TO_INTERACTIVE)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/shared/config/perf-budgets.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: define performance budgets for key interactions
```

---

## Task 2: Create renderer PerfTrace service

**Files:**
- Create: `src/renderer/src/services/PerfTrace.ts`
- Create: `tests/renderer/services/PerfTrace.test.ts`

A lightweight tracing service that records user-flow timings. Dev-only logging — gated behind `import.meta.env.DEV`.

- [ ] **Step 1: Create the PerfTrace service**

```typescript
// src/renderer/src/services/PerfTrace.ts
import { PERF_BUDGETS, type PerfBudgetKey } from '../../../shared/config/perf-budgets'
import { logService } from './LogService'

export interface PerfEntry {
  /** Flow name (e.g., 'case-switch', 'filter-apply') */
  name: string
  /** Duration in milliseconds */
  duration: number
  /** Budget key if applicable */
  budget?: PerfBudgetKey
  /** Whether duration exceeded the budget */
  overBudget: boolean
  /** ISO timestamp */
  timestamp: string
}

const MAX_ENTRIES = 100
const entries: PerfEntry[] = []
const activeTraces = new Map<string, number>()

/** Start a named trace. Returns the trace ID for passing to traceEnd. */
export function traceStart(name: string): string {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  activeTraces.set(id, performance.now())
  return id
}

/** End a trace and record the entry. Returns the entry or null if ID unknown. */
export function traceEnd(id: string, budget?: PerfBudgetKey): PerfEntry | null {
  const start = activeTraces.get(id)
  if (start === undefined) return null
  activeTraces.delete(id)

  const duration = performance.now() - start
  const budgetMs = budget !== undefined ? PERF_BUDGETS[budget] : undefined
  const overBudget = budgetMs !== undefined && duration > budgetMs

  const entry: PerfEntry = {
    name: id.replace(/-\d+-[a-z0-9]+$/, ''),
    duration: Math.round(duration * 100) / 100,
    budget,
    overBudget,
    timestamp: new Date().toISOString()
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  if (import.meta.env.DEV) {
    if (overBudget) {
      logService.warn(
        `[perf] ${entry.name} took ${entry.duration}ms (budget: ${budgetMs}ms)`,
        'perf'
      )
    } else if (duration > 50) {
      logService.debug(`[perf] ${entry.name}: ${entry.duration}ms`, 'perf')
    }
  }

  return entry
}

/**
 * Trace an async function from start to completion.
 * Use for self-contained operations. For multi-step user flows
 * (where annotation hydration follows data fetch), use
 * traceStart/traceEnd manually to span the full flow.
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  budget?: PerfBudgetKey
): Promise<T> {
  const id = traceStart(name)
  try {
    return await fn()
  } finally {
    traceEnd(id, budget)
  }
}

/** Get recent entries (most recent first). */
export function getRecentTraces(limit = 20): readonly PerfEntry[] {
  return entries.slice(-limit).reverse()
}

/** Clear all traces (for testing). */
export function clearTraces(): void {
  entries.length = 0
  activeTraces.clear()
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/renderer/services/PerfTrace.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  traceStart,
  traceEnd,
  traceAsync,
  getRecentTraces,
  clearTraces
} from '../../../src/renderer/src/services/PerfTrace'

describe('PerfTrace', () => {
  beforeEach(() => {
    clearTraces()
  })

  it('records a trace with start/end', () => {
    const id = traceStart('test-op')
    const entry = traceEnd(id)
    expect(entry).not.toBeNull()
    expect(entry!.name).toBe('test-op')
    expect(entry!.duration).toBeGreaterThanOrEqual(0)
    expect(entry!.overBudget).toBe(false)
  })

  it('checks budget when provided', () => {
    const id = traceStart('fast-op')
    // Near-zero duration should be under any budget
    const entry = traceEnd(id, 'ANNOTATION_HYDRATE')
    expect(entry).not.toBeNull()
    expect(entry!.budget).toBe('ANNOTATION_HYDRATE')
    expect(entry!.overBudget).toBe(false)
  })

  it('returns null for unknown trace ID', () => {
    const entry = traceEnd('nonexistent-123-abcd')
    expect(entry).toBeNull()
  })

  it('traceAsync wraps an async function', async () => {
    const result = await traceAsync('async-op', async () => 42)
    expect(result).toBe(42)
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('async-op')
  })

  it('traceAsync records even if function throws', async () => {
    await expect(
      traceAsync('failing-op', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('failing-op')
  })

  it('getRecentTraces returns most recent first', () => {
    const id1 = traceStart('first')
    traceEnd(id1)
    const id2 = traceStart('second')
    traceEnd(id2)

    const traces = getRecentTraces()
    expect(traces[0].name).toBe('second')
    expect(traces[1].name).toBe('first')
  })

  it('clearTraces empties the buffer', () => {
    const id = traceStart('to-clear')
    traceEnd(id)
    expect(getRecentTraces().length).toBe(1)
    clearTraces()
    expect(getRecentTraces().length).toBe(0)
  })

  it('caps entries at MAX_ENTRIES (100)', () => {
    for (let i = 0; i < 120; i++) {
      const id = traceStart(`op-${i}`)
      traceEnd(id)
    }
    expect(getRecentTraces(200).length).toBe(100)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/renderer/services/PerfTrace.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: add PerfTrace service for renderer interaction timing
```

---

## Task 3: Add main-process startup timing with renderer handshake

**Files:**
- Create: `src/main/services/MainPerfTrace.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.vue`

The startup measurement needs to span from process start to renderer-reported "interactive". The main process records milestones; the renderer sends an IPC message after `App.vue` `onMounted` completes and the first fire-and-forget data fetch fires. The main process receives this and logs the total.

- [ ] **Step 1: Create MainPerfTrace (dev-gated with `is.dev`)**

```typescript
// src/main/services/MainPerfTrace.ts
import { is } from '@electron-toolkit/utils'
import { mainLogger } from './MainLogger'

const marks = new Map<string, number>()
const appStartTime = performance.now()

/** Record a named milestone relative to process start. Dev-only. */
export function markMilestone(name: string): void {
  if (!is.dev) return
  const elapsed = Math.round((performance.now() - appStartTime) * 100) / 100
  marks.set(name, elapsed)
  mainLogger.info(`[perf] ${name}: ${elapsed}ms from start`, 'perf')
}

/** Get time elapsed since process start. Dev-only. */
export function getElapsedMs(): number {
  return Math.round((performance.now() - appStartTime) * 100) / 100
}

/** Get all recorded milestones. */
export function getMilestones(): ReadonlyMap<string, number> {
  return marks
}
```

- [ ] **Step 2: Add milestones in `src/main/index.ts`**

Read the file fully first. Add marks at these points:

After `app.whenReady()` resolves (inside the callback):
```typescript
import { markMilestone, getElapsedMs } from './services/MainPerfTrace'

// After app.whenReady():
markMilestone('app-ready')
```

After `createWindow()` call:
```typescript
markMilestone('window-created')
```

Add IPC listener for renderer "interactive" report (inside the `app.whenReady` callback, after IPC handlers are registered):
```typescript
ipcMain.once('perf:interactive', () => {
  markMilestone('renderer-interactive')
})
```

- [ ] **Step 3: Add `perf:interactive` to preload**

In `src/preload/index.ts`, add to the `api` object (in a `perf` section or inline):

```typescript
perf: {
  reportInteractive: () => ipcRenderer.send('perf:interactive')
}
```

Also update `src/shared/types/api.ts` to add the `perf` property to `WindowAPI`:

```typescript
export interface PerfAPI {
  reportInteractive: () => void
}
```

And add `perf: PerfAPI` to `WindowAPI`.

Update the mock API and the preload contract test expectations accordingly.

- [ ] **Step 4: Report interactive from App.vue**

In `src/renderer/src/App.vue`, at the end of `onMounted` (after the fire-and-forget `databaseStore.fetchInfo()`):

```typescript
// Report to main process that renderer is interactive
api?.perf.reportInteractive()
```

This fires after: mock API injection (main.ts), Vue app creation, App component mount, log listener setup, and initial data fetch trigger. It captures real "first interactive" — not just `did-finish-load`.

- [ ] **Step 5: Run typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat: add main-process startup timing with renderer interactive handshake
```

---

## Task 4: Instrument user flows in variant table

**Files:**
- Modify: `src/renderer/src/components/variant-table/useVariantData.ts`

This is the critical instrumentation task. Instead of tracing inside `useOffsetPagination` (which conflates all callers), trace at the user-flow entry points in `useVariantData.ts` where:
- Case switch triggers reset + load + annotation hydration (watcher at line ~126)
- Filter change triggers reload + annotation hydration (watcher at line ~142)
- Annotation hydration itself completes (watcher at line ~151)

The trace must span from trigger to **annotation hydration complete** — not just the data fetch.

- [ ] **Step 1: Read `useVariantData.ts` fully**

Understand the three watchers and how data flows: caseId change → resetState → loadPage → variants change → loadAnnotationsBatch.

- [ ] **Step 2: Add flow-level tracing**

Import PerfTrace:
```typescript
import { traceStart, traceEnd } from '../../services/PerfTrace'
```

Add a module-scoped variable to track the active flow trace:
```typescript
let activeFlowTraceId: string | null = null
let activeFlowBudget: PerfBudgetKey | undefined = undefined
```

In the **caseId watcher** (the case-switch flow):
```typescript
watch(
  caseId,
  (newCaseId) => {
    // End any previous flow trace
    if (activeFlowTraceId !== null) {
      traceEnd(activeFlowTraceId, activeFlowBudget)
      activeFlowTraceId = null
    }

    selectedVariantId.value = null
    clearAllColumnFilters()

    if (newCaseId !== undefined && newCaseId !== 0) {
      if (import.meta.env.DEV) {
        activeFlowTraceId = traceStart('case-switch')
        activeFlowBudget = 'CASE_SWITCH'
      }
      resetState()
      clearAnnotationCache()
      needsUnfilteredCount = true
    }
  },
  { immediate: true }
)
```

In the **filterKey watcher** (the filter-apply flow):
```typescript
watch(filterKey, () => {
  if (import.meta.env.DEV) {
    if (activeFlowTraceId !== null) {
      traceEnd(activeFlowTraceId, activeFlowBudget)
    }
    activeFlowTraceId = traceStart('filter-apply')
    activeFlowBudget = 'FILTER_APPLY'
  }
  invalidateAndReload()
})
```

In the **variants watcher** (annotation hydration — the flow endpoint):
```typescript
watch(
  variants,
  async (newVariants) => {
    invalidateAnnotationGeneration()
    if (newVariants.length > 0 && caseId.value !== undefined && caseId.value !== 0) {
      await loadAnnotationsBatch(caseId.value, newVariants)
    }
    // Flow complete: data fetched + annotations hydrated
    if (import.meta.env.DEV && activeFlowTraceId !== null) {
      traceEnd(activeFlowTraceId, activeFlowBudget)
      activeFlowTraceId = null
    }
  },
  { immediate: true }
)
```

This traces the full user-visible flow: trigger → data fetch → annotation hydration.

- [ ] **Step 3: Run typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: instrument case-switch and filter-apply flows with end-to-end tracing
```

---

## Task 5: Instrument user flows in cohort table

**Files:**
- Modify: `src/renderer/src/components/CohortTable.vue`

Apply the same pattern as Task 4 but for the cohort view. The cohort table has analogous flows: filter change → page reload → annotation hydration.

- [ ] **Step 1: Read CohortTable.vue's relevant watchers**

Find the filter change handler, the variants watcher (for annotation loading), and the summaryStale watcher.

- [ ] **Step 2: Add flow-level tracing**

Import PerfTrace:
```typescript
import { traceStart, traceEnd } from '../services/PerfTrace'
import type { PerfBudgetKey } from '../../../shared/config/perf-budgets'
```

Add flow tracking:
```typescript
let activeFlowTraceId: string | null = null
let activeFlowBudget: PerfBudgetKey | undefined = undefined
```

In `handleFilterChange`:
```typescript
const handleFilterChange = () => {
  if (import.meta.env.DEV) {
    if (activeFlowTraceId !== null) traceEnd(activeFlowTraceId, activeFlowBudget)
    activeFlowTraceId = traceStart('cohort-filter-apply')
    activeFlowBudget = 'FILTER_APPLY'
  }
  invalidateAndReload()
}
```

In the `variants` watcher (after annotation hydration):
```typescript
watch(variants, (newVariants) => {
  debouncedLoadAnnotations(newVariants)
  // Note: flow trace ends in the debounced annotation loader's completion
})
```

Since cohort uses `debouncedLoadAnnotations`, the trace should end after that completes. This may need the debounced function to call traceEnd, or the trace can end when variants arrive (before annotation hydration) and a separate `ANNOTATION_HYDRATE` trace covers the hydration step. Choose the approach that's simplest to implement correctly — read the actual code flow to decide.

- [ ] **Step 3: Run typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: instrument cohort filter and page flows with tracing
```

---

## Task 6: Create dev-only performance overlay

**Files:**
- Create: `src/renderer/src/components/dev/PerfOverlay.vue`
- Modify: `src/renderer/src/App.vue`

A small floating panel (dev mode only) showing recent performance traces with budget violations highlighted.

- [ ] **Step 1: Create PerfOverlay component**

```vue
<!-- src/renderer/src/components/dev/PerfOverlay.vue -->
<template>
  <div v-if="visible" class="perf-overlay">
    <div class="perf-header">
      <span class="text-caption font-weight-bold">Perf Traces</span>
      <v-btn icon size="x-small" variant="text" @click="visible = false">
        <v-icon size="14">{{ mdiClose }}</v-icon>
      </v-btn>
    </div>
    <div class="perf-entries">
      <div
        v-for="(entry, i) in traces"
        :key="i"
        class="perf-entry"
        :class="{ 'over-budget': entry.overBudget }"
      >
        <span class="perf-name text-caption">{{ entry.name }}</span>
        <span class="perf-duration text-caption font-weight-medium">
          {{ entry.duration.toFixed(1) }}ms
        </span>
      </div>
      <div v-if="traces.length === 0" class="text-caption text-medium-emphasis pa-1">
        No traces yet
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getRecentTraces, type PerfEntry } from '../../services/PerfTrace'
import { mdiClose } from '@mdi/js'

const visible = ref(true)
const traces = ref<readonly PerfEntry[]>([])

let interval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  interval = setInterval(() => {
    traces.value = getRecentTraces(15)
  }, 1000)
})

onUnmounted(() => {
  if (interval !== null) clearInterval(interval)
})
</script>

<style scoped>
.perf-overlay {
  position: fixed;
  bottom: 8px;
  right: 8px;
  width: 280px;
  max-height: 300px;
  background: rgba(0, 0, 0, 0.85);
  color: #eee;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  z-index: 9999;
  overflow: hidden;
}
.perf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.perf-entries {
  max-height: 260px;
  overflow-y: auto;
}
.perf-entry {
  display: flex;
  justify-content: space-between;
  padding: 2px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.perf-entry.over-budget {
  background: rgba(255, 80, 80, 0.2);
  color: #ff8888;
}
.perf-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.perf-duration {
  flex-shrink: 0;
}
</style>
```

- [ ] **Step 2: Mount in App.vue (dev mode only)**

In `src/renderer/src/App.vue`, add alongside the other async components:

```typescript
const PerfOverlay = import.meta.env.DEV
  ? defineAsyncComponent(() => import('./components/dev/PerfOverlay.vue'))
  : null
```

In the template, add at the bottom:

```html
<component :is="PerfOverlay" v-if="PerfOverlay !== null" />
```

- [ ] **Step 3: Run typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: add dev-only performance overlay showing recent traces
```

---

## Task 7: Final verification

- [ ] **Step 1: Run lint**

Run: `npm run lint:check`
Expected: Clean

- [ ] **Step 2: Run typecheck**

Run: `make typecheck`
Expected: Clean

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 4: Run coverage**

Run: `npx vitest run --coverage`
Expected: Thresholds pass

- [ ] **Step 5: Manual dev-mode verification**

Start the app in dev mode and verify:
- Main-process logs show `[perf] app-ready`, `[perf] window-created`, `[perf] renderer-interactive` milestones
- Switching cases produces `[perf] case-switch: Xms` log entries
- Changing filters produces `[perf] filter-apply: Xms` entries
- Perf overlay appears in bottom-right with trace entries
- Budget violations (if any) show in red in overlay and as warnings in log
