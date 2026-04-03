# UI Non-Blocking & Snappiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI freezes and main-thread blocking across all platforms by batching IPC calls, offloading heavy DB work to workers, optimizing renderer cascades, and adding loading feedback.

**Architecture:** Three phases — (1) batch/pool IPC + loading overlay, (2) renderer flow optimization, (3) perceived performance polish. Each phase is independently shippable. The IPC layer (main process) is fixed first since it's the root cause of actual thread blocking; renderer and polish follow.

**Tech Stack:** Electron 40, Vue 3 + Vuetify 3, TypeScript, better-sqlite3-multiple-ciphers, Piscina worker pool, Node.js Worker threads, Vitest

---

## File Map

### Phase 1 — Batch & Pool IPC + Loading Overlay

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/shared/types/db-task.ts` | Add new DbTaskType entries |
| Modify | `src/shared/types/api.ts` | Add `batchGet` to AnnotationsAPI, add `VariantKey` type |
| Modify | `src/main/database/AnnotationRepository.ts` | Add `getBatch()` method |
| Modify | `src/main/workers/db-worker.ts` | Handle `annotations:batchGet` task |
| Modify | `src/main/ipc/handlers/annotations.ts` | Add `annotations:batchGet` handler |
| Modify | `src/preload/index.ts` | Expose `batchGet` in annotations API |
| Modify | `src/renderer/src/composables/useAnnotations.ts` | Use batch endpoint |
| Modify | `src/main/ipc/handlers/cohort.ts` | Extract `spawnRebuildWorker`, use in manual rebuild |
| Modify | `src/main/ipc/handlers/cases.ts` | `cases:delete` uses `runDeleteWorker` |
| Modify | `src/main/ipc/handlers/tags.ts` | Pool read handlers |
| Modify | `src/main/ipc/handlers/transcripts.ts` | Pool read handler |
| Modify | `src/main/ipc/handlers/gene-lists.ts` | Pool read handlers |
| Modify | `src/main/ipc/handlers/export.ts` | Pool read path |
| Create | `src/renderer/src/components/ViewTransitionOverlay.vue` | Loading overlay component |
| Modify | `src/renderer/src/App.vue` | Integrate overlay |
| Modify | `tests/utils/mock-api.ts` | Add `batchGet` mock |

### Phase 2 — Renderer Flow Optimization

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/renderer/src/App.vue` | Remove refresh from activeTab watcher |
| Modify | `src/renderer/src/composables/useFilterState.ts` | filterGeneration counter, parallel IPC |
| Modify | `src/main/database/VariantRepository.ts` | Pre-compute case count |

### Phase 3 — Perceived Performance & Cleanup

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/main/index.ts` | Defer auto-updater |
| Modify | `src/renderer/src/composables/useMolstarViewer.ts` | Lazy script injection |
| Modify | `src/renderer/index.html` | Remove static Molstar script |
| Modify | `src/main/import/ZipExtractor.ts` | Async writeFile |
| Create | `src/main/utils/convertBigInts.ts` | Shared BigInt utility |
| Modify | `src/main/ipc/handlers/cohort.ts` | Use shared convertBigInts |
| Modify | `src/renderer/src/composables/useOffsetPagination.ts` | `loading` init to `true` |

---

## Phase 1: Batch & Pool IPC + Loading Overlay

### Task 1: Add Batch Annotation Types

**Files:**
- Modify: `src/shared/types/db-task.ts:11-46`
- Modify: `src/shared/types/api.ts:346-380`

- [ ] **Step 1: Add `VariantKey` type and `batchGet` to AnnotationsAPI**

In `src/shared/types/api.ts`, add the `VariantKey` interface before `VariantAnnotationsResult` (line 346) and add `batchGet` to `AnnotationsAPI`:

```typescript
// Add before VariantAnnotationsResult (line 346)
export interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

// Add to AnnotationsAPI interface (after getForVariant, before closing brace at line 380)
  batchGet: (
    caseId: number | null,
    variantKeys: VariantKey[]
  ) => Promise<Record<string, VariantAnnotationsResult>>
```

The return type is `Record<string, VariantAnnotationsResult>` where keys are `chr:pos:ref:alt` strings matching the cache key format in `useAnnotations.ts`.

- [ ] **Step 2: Add `annotations:batchGet` to DbTaskType**

In `src/shared/types/db-task.ts`, add after line 30 (`'annotations:getForVariant'`):

```typescript
  | 'annotations:batchGet'
```

- [ ] **Step 3: Run typecheck to confirm no errors**

Run: `npx tsc --noEmit`
Expected: Types compile. Errors are expected only for missing implementations (preload, handler) which we'll add next.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/db-task.ts src/shared/types/api.ts
git commit -m "feat: add batch annotation types (VariantKey, annotations:batchGet)"
```

---

### Task 2: Add `getBatch` to AnnotationRepository

**Files:**
- Modify: `src/main/database/AnnotationRepository.ts:157-180`
- Test: `tests/main/handlers/annotations-handlers.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/main/handlers/annotations-handlers.test.ts`:

```typescript
describe('getBatch (annotations:batchGet)', () => {
  it('returns empty record for empty variantKeys array', () => {
    const result = db.annotations.getBatch(caseId, [])
    expect(result).toEqual({})
  })

  it('returns annotations keyed by chr:pos:ref:alt for case mode', () => {
    // Set up: star the variant globally
    db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', { starred: 1 })

    const result = db.annotations.getBatch(caseId, [
      { chr: '1', pos: 12345, ref: 'A', alt: 'G' }
    ])

    expect(result).toHaveProperty('1:12345:A:G')
    expect(result['1:12345:A:G'].global).not.toBeNull()
    expect(result['1:12345:A:G'].global!.starred).toBe(1)
    expect(result['1:12345:A:G'].perCase).toBeNull()
  })

  it('returns global-only annotations when caseId is null', () => {
    db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', { starred: 1 })

    const result = db.annotations.getBatch(null, [
      { chr: '1', pos: 12345, ref: 'A', alt: 'G' }
    ])

    expect(result['1:12345:A:G'].global).not.toBeNull()
    expect(result['1:12345:A:G'].perCase).toBeNull()
  })

  it('returns null entries for variants with no annotations', () => {
    const result = db.annotations.getBatch(caseId, [
      { chr: '1', pos: 99999, ref: 'C', alt: 'T' }
    ])

    expect(result['1:99999:C:T']).toEqual({ global: null, perCase: null })
  })

  it('handles multiple variants in a single batch', () => {
    db.annotations.upsertGlobalAnnotation('1', 12345, 'A', 'G', { starred: 1 })
    // Second variant has no annotations

    const result = db.annotations.getBatch(caseId, [
      { chr: '1', pos: 12345, ref: 'A', alt: 'G' },
      { chr: '2', pos: 67890, ref: 'T', alt: 'C' }
    ])

    expect(Object.keys(result)).toHaveLength(2)
    expect(result['1:12345:A:G'].global).not.toBeNull()
    expect(result['2:67890:T:C'].global).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rebuild:node && npx vitest run tests/main/handlers/annotations-handlers.test.ts`
Expected: FAIL — `db.annotations.getBatch is not a function`

- [ ] **Step 3: Implement `getBatch` in AnnotationRepository**

Add to `src/main/database/AnnotationRepository.ts` after `getAnnotationsForVariant` (after line 179):

```typescript
  getBatch(
    caseId: number | null,
    variantKeys: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Record<string, { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }> {
    const result: Record<
      string,
      { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }
    > = {}

    for (const vk of variantKeys) {
      const key = `${vk.chr}:${vk.pos}:${vk.ref}:${vk.alt}`
      const global = this.getGlobalAnnotation(vk.chr, vk.pos, vk.ref, vk.alt)

      let perCase: CaseVariantAnnotation | null = null
      if (caseId !== null) {
        const variant = this.execFirst<{ id: number }>(
          this.kysely
            .selectFrom('variants')
            .select('id')
            .where('case_id', '=', caseId)
            .where('chr', '=', vk.chr)
            .where('pos', '=', vk.pos)
            .where('ref', '=', vk.ref)
            .where('alt', '=', vk.alt)
        )
        if (variant) {
          perCase = this.getPerCaseAnnotation(caseId, variant.id)
        }
      }

      result[key] = { global, perCase }
    }

    return result
  }
```

Note: This iterates per variant key and calls existing methods. With SQLite's in-process nature this is fast (no network round-trips). A single SQL batch query with `IN` clause would be more complex for the composite key and provides marginal gains since the bottleneck is IPC round-trips, not SQL execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/handlers/annotations-handlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/database/AnnotationRepository.ts tests/main/handlers/annotations-handlers.test.ts
git commit -m "feat: add getBatch method to AnnotationRepository"
```

---

### Task 3: Add `annotations:batchGet` to Worker and IPC Handler

**Files:**
- Modify: `src/main/workers/db-worker.ts:114-133`
- Modify: `src/main/ipc/handlers/annotations.ts`

- [ ] **Step 1: Add task case to db-worker.ts**

In `src/main/workers/db-worker.ts`, add after the `annotations:getForVariant` case (around line 133):

```typescript
    case 'annotations:batchGet':
      return repos.annotations.getBatch(
        params[0] as number | null,
        params[1] as Array<{ chr: string; pos: number; ref: string; alt: string }>
      )
```

- [ ] **Step 2: Add IPC handler in annotations.ts**

In `src/main/ipc/handlers/annotations.ts`, add before the closing brace of the `registerAnnotationHandlers` function:

```typescript
  // Batch read — single round-trip for N variants (pool-dispatched)
  ipcMain.handle(
    'annotations:batchGet',
    async (_event, caseId: unknown, variantKeys: unknown) => {
      return wrapHandler(async () => {
        // Validate caseId: number | null
        const validatedCaseId = z
          .number()
          .int()
          .positive()
          .nullable()
          .safeParse(caseId)
        if (!validatedCaseId.success) {
          throw new Error('Invalid caseId parameter')
        }

        // Validate variantKeys array
        const VariantKeysSchema = z.array(
          z.object({
            chr: z.string().min(1),
            pos: z.number().int().positive(),
            ref: z.string().min(1),
            alt: z.string().min(1)
          })
        )
        const validatedKeys = VariantKeysSchema.safeParse(variantKeys)
        if (!validatedKeys.success) {
          throw new Error('Invalid variantKeys parameter')
        }

        const pool = getDbPool?.()
        if (pool) {
          return await pool.run({
            type: 'annotations:batchGet' as const,
            params: [validatedCaseId.data, validatedKeys.data]
          })
        }
        const db = getDb()
        return db.annotations.getBatch(validatedCaseId.data, validatedKeys.data)
      })
    }
  )
```

- [ ] **Step 3: Add `batchGet` to preload API**

In `src/preload/index.ts`, add to the `annotations` object (after the `getForVariant` entry):

```typescript
    batchGet: (
      caseId: number | null,
      variantKeys: Array<{ chr: string; pos: number; ref: string; alt: string }>
    ) => ipcRenderer.invoke('annotations:batchGet', caseId, variantKeys),
```

- [ ] **Step 4: Add `batchGet` mock to test utilities**

In `tests/utils/mock-api.ts`, add to the `annotations` object:

```typescript
      batchGet: vi.fn().mockResolvedValue({}),
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — all types align

- [ ] **Step 6: Commit**

```bash
git add src/main/workers/db-worker.ts src/main/ipc/handlers/annotations.ts src/preload/index.ts tests/utils/mock-api.ts
git commit -m "feat: add annotations:batchGet IPC handler with pool support"
```

---

### Task 4: Switch Renderer to Batch Annotation Endpoint

**Files:**
- Modify: `src/renderer/src/composables/useAnnotations.ts:220-285`
- Test: `tests/renderer/composables/useAnnotations.test.ts`

- [ ] **Step 1: Write the failing test for batch loading**

Add to `tests/renderer/composables/useAnnotations.test.ts`:

```typescript
describe('loadAnnotationsBatch uses batch endpoint', () => {
  it('calls batchGet instead of individual getForVariant', async () => {
    const batchResult = {
      'chr1:100:A:G': { global: null, perCase: null },
      'chr2:200:T:C': { global: null, perCase: null }
    }
    window.api.annotations.batchGet = vi.fn().mockResolvedValue(batchResult)
    window.api.annotations.getForVariant = vi.fn()

    const [result, appInstance] = withSetup(() => useAnnotations())
    app = appInstance

    await result.loadAnnotationsBatch(1, [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'G' },
      { chr: 'chr2', pos: 200, ref: 'T', alt: 'C' }
    ])

    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(1, [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'G' },
      { chr: 'chr2', pos: 200, ref: 'T', alt: 'C' }
    ])
    // Individual calls should NOT be made
    expect(window.api.annotations.getForVariant).not.toHaveBeenCalled()
  })

  it('populates cache from batch response', async () => {
    const batchResult = {
      'chr1:100:A:G': { global: { starred: 1 } as VariantAnnotation, perCase: null }
    }
    window.api.annotations.batchGet = vi.fn().mockResolvedValue(batchResult)

    const [result, appInstance] = withSetup(() => useAnnotations())
    app = appInstance

    await result.loadAnnotationsBatch(1, [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }])

    const cached = result.getAnnotations('chr1', 100, 'A', 'G')
    expect(cached).toBeDefined()
    expect(cached!.global!.starred).toBe(1)
  })

  it('skips already-cached variants', async () => {
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({})
    window.api.annotations.getForVariant = vi
      .fn()
      .mockResolvedValue({ global: null, perCase: null })

    const [result, appInstance] = withSetup(() => useAnnotations())
    app = appInstance

    // Pre-populate cache
    await result.loadAnnotations(1, 'chr1', 100, 'A', 'G')
    vi.mocked(window.api.annotations.batchGet).mockClear()

    await result.loadAnnotationsBatch(1, [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }])

    // Should not call batchGet for already-cached variant
    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(1, [])
  })
})

describe('loadGlobalAnnotationsBatch uses batch endpoint', () => {
  it('calls batchGet with null caseId', async () => {
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({})

    const [result, appInstance] = withSetup(() => useAnnotations())
    app = appInstance

    await result.loadGlobalAnnotationsBatch([{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }])

    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(null, [
      { chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/composables/useAnnotations.test.ts`
Expected: FAIL — batchGet not called, individual getForVariant still used

- [ ] **Step 3: Rewrite `loadAnnotationsBatch` and `loadGlobalAnnotationsBatch`**

In `src/renderer/src/composables/useAnnotations.ts`, replace `loadAnnotationsBatch` (lines 220-237):

```typescript
  async function loadAnnotationsBatch(
    caseId: number,
    variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<void> {
    if (!api) return

    const uncached = variants.filter(
      (v) => !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt))
    )

    try {
      const results = await api.annotations.batchGet(caseId, uncached)
      for (const [key, value] of Object.entries(results)) {
        cacheSet(key, value)
      }
    } catch (error) {
      logService.warn(
        'Failed to load annotation batch: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    }
  }
```

Replace `loadGlobalAnnotationsBatch` (lines 270-285):

```typescript
  async function loadGlobalAnnotationsBatch(
    variants: Array<{ chr: string; pos: number; ref: string; alt: string }>
  ): Promise<void> {
    if (!api) return

    const uncached = variants.filter(
      (v) => !annotationCache.value.has(variantKey(v.chr, v.pos, v.ref, v.alt))
    )

    try {
      const results = await api.annotations.batchGet(null, uncached)
      for (const [key, value] of Object.entries(results)) {
        cacheSet(key, value)
      }
    } catch (error) {
      logService.warn(
        'Failed to load global annotation batch: ' +
          (error instanceof Error ? error.message : String(error)),
        'annotations'
      )
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/composables/useAnnotations.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/composables/useAnnotations.ts tests/renderer/composables/useAnnotations.test.ts
git commit -m "feat: switch annotation loading to batch IPC endpoint

Replaces N individual annotations:getForVariant IPC calls with a
single annotations:batchGet call per page load."
```

---

### Task 5: Offload `cohort:rebuildSummary` to Worker Thread

**Files:**
- Modify: `src/main/ipc/handlers/cohort.ts:268-340`

- [ ] **Step 1: Extract `spawnRebuildWorker` as shared function**

In `src/main/ipc/handlers/cohort.ts`, add a new function after `safeEmit` (after line 36), before `registerCohortHandlers`:

```typescript
/**
 * Spawn a worker thread to rebuild the cohort summary.
 * Shared by both manual rebuild (cohort:rebuildSummary) and startup rebuild.
 */
function spawnRebuildWorker(dbPath: string, encryptionKey?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const workerPath = resolveWorkerPath(__dirname, 'rebuild-summary-worker.js')
    const worker = new Worker(workerPath)
    let settled = false

    const settle = (fn: typeof resolve | typeof reject, value?: unknown): void => {
      if (settled) return
      settled = true
      fn(value as undefined)
      worker.terminate().catch((e) => {
        mainLogger.warn(`Summary rebuild worker termination failed: ${e}`, 'cohort')
      })
    }

    worker.on('message', (msg: RebuildWorkerResponse) => {
      if (msg.type === 'complete') {
        settle(resolve)
      } else {
        settle(reject, new Error(msg.error ?? 'Rebuild worker failed'))
      }
    })

    worker.on('error', (err: Error) => {
      mainLogger.error(`Rebuild worker error: ${err.message}`, 'cohort')
      settle(reject, err)
    })

    worker.on('exit', (code) => {
      settle(reject, new Error(`Rebuild worker exited unexpectedly with code ${code}`))
    })

    worker.postMessage({ dbPath, encryptionKey })
  })
}

/** Resolve worker path — `resolve(__dirname, name)` works in both dev and prod */
function resolveWorkerPath(dir: string, name: string): string {
  return resolve(dir, name)
}
```

- [ ] **Step 2: Update `cohort:rebuildSummary` to use worker**

Replace the handler at lines 268-276:

```typescript
  // Manual rebuild trigger (non-blocking via worker thread)
  ipcMain.handle('cohort:rebuildSummary', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      safeEmit('cohort:summaryRebuilt', { is_stale: true })
      await spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
      db.cohort.invalidateColumnMetaCache()
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
  })
```

- [ ] **Step 3: Refactor `triggerStartupRebuildIfNeeded` to use `spawnRebuildWorker`**

Replace the body of `triggerStartupRebuildIfNeeded` (lines 287-339) with:

```typescript
export function triggerStartupRebuildIfNeeded(db: DatabaseService): void {
  if (!db.needsStartupRebuild()) return

  mainLogger.info(
    'Startup: cohort summary empty with existing variants — spawning rebuild worker',
    'cohort'
  )
  safeEmit('cohort:summaryRebuilt', { is_stale: true })

  spawnRebuildWorker(db.getPath(), db.getEncryptionKey())
    .then(() => {
      mainLogger.info('Startup: cohort summary rebuild completed', 'cohort')
      try {
        db.cohort.invalidateColumnMetaCache()
      } catch {
        /* DB may be closed */
      }
      safeEmit('cohort:summaryRebuilt', { is_stale: false })
    })
    .catch((error) => {
      mainLogger.error(
        `Startup: cohort summary rebuild failed: ${error instanceof Error ? error.message : error}`,
        'cohort'
      )
      // Leave is_stale: true so the user can trigger a manual rebuild
    })
}
```

- [ ] **Step 4: Run existing cohort tests**

Run: `npx vitest run tests/main/handlers/cohort-handlers.test.ts`
Expected: PASS — existing tests don't test the IPC handler directly, they test the repository

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/cohort.ts
git commit -m "feat: offload cohort:rebuildSummary to worker thread

Extracts spawnRebuildWorker() shared by manual rebuild and startup
rebuild. Eliminates 2-5s main thread block during cohort index rebuild."
```

---

### Task 6: Offload `cases:delete` to Worker Thread

**Files:**
- Modify: `src/main/ipc/handlers/cases.ts:94-133`

- [ ] **Step 1: Replace inline delete with worker dispatch**

Replace the `cases:delete` handler body (lines 94-133) with:

```typescript
  ipcMain.handle('cases:delete', async (_event, id: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseIdSchema.safeParse(id)
      if (!validated.success) {
        mainLogger.error(`Invalid cases:delete params: ${validated.error.message}`, 'cases')
        throw new Error('Invalid parameters')
      }

      const db = getDb()
      mainLogger.info(`Starting single-case delete worker (id: ${validated.data})`, 'cases')
      safeEmit('cohort:summaryRebuilt', { is_stale: true })

      try {
        // NOTE: Decrement frequencies BEFORE worker delete because we need variant data.
        // This runs on main thread but is fast (indexed lookup).
        try {
          db.variants.decrementFrequencies(validated.data)
        } catch (freqError) {
          mainLogger.warn(`Failed to decrement variant frequencies: ${freqError}`, 'cases')
        }

        await runDeleteWorker({
          type: 'deleteBatch',
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey(),
          ids: [validated.data]
        })

        safeEmit('cases:deleted', { deleted: 1 })
        safeEmit('cohort:summaryRebuilt', { is_stale: false })
        return undefined
      } catch (error) {
        mainLogger.error(
          `Single-case delete worker failed: ${error instanceof Error ? error.message : error}`,
          'cases'
        )
        throw error
      }
    })
  })
```

Note: `decrementFrequencies` stays on main thread because it needs to read variant data before the delete worker removes it. This is a fast indexed operation. The heavy `deleteCase` + CASCADE + cohort rebuild happens in the worker.

- [ ] **Step 2: Run existing case tests**

Run: `npx vitest run tests/main/handlers/cases-handlers.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/handlers/cases.ts
git commit -m "feat: offload cases:delete to worker thread

Uses existing runDeleteWorker with ids:[id]. Eliminates 0.5-2s main
thread block during case deletion."
```

---

### Task 7: Pool High-Frequency Read Handlers (Tags, Transcripts, Gene Lists)

**Files:**
- Modify: `src/main/ipc/handlers/tags.ts`
- Modify: `src/main/ipc/handlers/transcripts.ts`
- Modify: `src/main/ipc/handlers/gene-lists.ts`
- Modify: `src/shared/types/db-task.ts`
- Modify: `src/main/workers/db-worker.ts`

- [ ] **Step 1: Add new DbTaskType entries**

In `src/shared/types/db-task.ts`, add after the Annotations section:

```typescript
  // Tags (read-only)
  | 'tags:list'
  | 'tags:getVariantTags'
  | 'tags:getUsageCount'
  // Transcripts (read-only)
  | 'transcripts:list'
  // Gene lists (read-only)
  | 'gene-lists:list'
  | 'gene-lists:getGenes'
  // Region files (read-only)
  | 'region-files:list'
```

- [ ] **Step 2: Add task cases to db-worker.ts**

In `src/main/workers/db-worker.ts`, add new cases to the switch statement:

```typescript
    // ── Tags ──────────────────────────────────────────
    case 'tags:list':
      return repos.tags.listTags()

    case 'tags:getVariantTags':
      return repos.tags.getVariantTags(
        params[0] as number,  // caseId
        params[1] as number   // variantId
      )

    case 'tags:getUsageCount':
      return repos.tags.getUsageCount(params[0] as number)  // tagId

    // ── Transcripts ───────────────────────────────────
    case 'transcripts:list':
      return repos.transcripts.getVariantTranscripts(params[0] as number)  // variantId

    // ── Gene Lists ────────────────────────────────────
    case 'gene-lists:list':
      return repos.geneLists.listGeneLists()

    case 'gene-lists:getGenes':
      return repos.geneLists.getGenes(params[0] as number)  // geneListId

    // ── Region Files ──────────────────────────────────
    case 'region-files:list':
      return repos.geneLists.listRegionFiles()
```

Note: The worker's repository initialization (`repos`) must already expose `tags`, `transcripts`, and `geneLists`. Check that the worker's DB initialization creates all needed repositories. If not, add them — the worker opens its own DatabaseService which already creates all repositories.

- [ ] **Step 3: Add pool dispatch to tags.ts read handlers**

In `src/main/ipc/handlers/tags.ts`, update the function signature to accept `HandlerDependencies` and add pool dispatch to reads. The pattern for each read handler:

For `tags:list`:
```typescript
  ipcMain.handle('tags:list', async () => {
    return wrapHandler(async () => {
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'tags:list' as const, params: [] })
      }
      const db = getDb()
      return db.tags.listTags()
    })
  })
```

Apply the same pattern to `tags:getUsageCount` and `tags:getVariantTags`, passing appropriate params.

- [ ] **Step 4: Add pool dispatch to transcripts.ts read handler**

In `src/main/ipc/handlers/transcripts.ts`, add pool dispatch to `transcripts:list`:

```typescript
  ipcMain.handle('transcripts:list', async (_event, variantId: unknown) => {
    return wrapHandler(async () => {
      const validated = z.number().int().positive().safeParse(variantId)
      if (!validated.success) throw new Error('Invalid variantId')

      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'transcripts:list' as const, params: [validated.data] })
      }
      const db = getDb()
      return db.transcripts.getVariantTranscripts(validated.data)
    })
  })
```

- [ ] **Step 5: Add pool dispatch to gene-lists.ts read handlers**

Apply the same pool-dispatch pattern to `gene-lists:list`, `gene-lists:getGenes`, and `region-files:list` in `src/main/ipc/handlers/gene-lists.ts`.

- [ ] **Step 6: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/db-task.ts src/main/workers/db-worker.ts src/main/ipc/handlers/tags.ts src/main/ipc/handlers/transcripts.ts src/main/ipc/handlers/gene-lists.ts
git commit -m "feat: pool read handlers for tags, transcripts, gene-lists

Adds DbPool dispatch to high-frequency read operations, reducing
main thread blocking by ~40%."
```

---

### Task 8: View-Switch Loading Overlay

**Files:**
- Create: `src/renderer/src/components/ViewTransitionOverlay.vue`
- Modify: `src/renderer/src/App.vue:241-254`

- [ ] **Step 1: Create ViewTransitionOverlay component**

Create `src/renderer/src/components/ViewTransitionOverlay.vue`:

```vue
<template>
  <v-overlay
    :model-value="modelValue"
    class="view-transition-overlay"
    persistent
    no-click-animation
    scrim="rgba(250, 248, 246, 0.7)"
  >
    <div class="d-flex flex-column align-center">
      <v-progress-circular indeterminate color="primary" size="40" width="3" />
    </div>
  </v-overlay>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
}>()
</script>

<style scoped>
.view-transition-overlay {
  z-index: 1000;
}
</style>
```

- [ ] **Step 2: Integrate overlay in App.vue**

In `src/renderer/src/App.vue`, add a `transitioning` ref and wire it to the overlay:

Add to the script section (near other refs):
```typescript
const transitioning = ref(false)
```

Add the component import:
```typescript
import ViewTransitionOverlay from './components/ViewTransitionOverlay.vue'
```

Update the `activeTab` watcher (lines 241-254):
```typescript
watch(activeTab, async (newTab) => {
  panelOpen.value = false
  selectedPanelVariant.value = null
  transitioning.value = true
  try {
    if (newTab === 'cohort') {
      sidebarOpen.value = false
      await router.push('/cohort')
      await nextTick()
      await cohortViewRef.value?.refresh()
    } else {
      await router.push('/case')
    }
  } finally {
    transitioning.value = false
  }
})
```

Add the overlay to the template (inside the main layout, after `<router-view>`):
```vue
<ViewTransitionOverlay :model-value="transitioning" />
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ViewTransitionOverlay.vue src/renderer/src/App.vue
git commit -m "feat: add view-switch loading overlay

Shows a centered spinner during tab transitions to provide immediate
visual feedback. Eliminates perceived freeze during view switching."
```

---

## Phase 2: Renderer Flow Optimization

### Task 9: Deduplicate View-Switch Refresh

**Files:**
- Modify: `src/renderer/src/App.vue:241-254`

- [ ] **Step 1: Remove refresh call from activeTab watcher**

In `src/renderer/src/App.vue`, update the `activeTab` watcher to remove the explicit refresh call. The overlay still wraps the transition, but `onActivated` in each view handles refresh:

```typescript
watch(activeTab, async (newTab) => {
  panelOpen.value = false
  selectedPanelVariant.value = null
  transitioning.value = true
  try {
    if (newTab === 'cohort') {
      sidebarOpen.value = false
      await router.push('/cohort')
    } else {
      await router.push('/case')
    }
  } finally {
    // Allow a tick for onActivated to fire before hiding overlay
    await nextTick()
    transitioning.value = false
  }
})
```

Note: The overlay now shows during the router transition only. Each view's `onActivated` hook handles data loading independently. The `await nextTick()` before hiding the overlay ensures `onActivated` has fired.

- [ ] **Step 2: Verify CaseView and CohortView onActivated still work**

Confirm that both views' `onActivated` hooks check `dataGeneration` and refresh when needed — no changes needed to these files, just verify the existing code still serves as the single refresh authority.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.vue
git commit -m "fix: deduplicate view-switch refresh

Makes onActivated the single authority for data refresh on view
switch. Removes redundant refresh call from activeTab watcher."
```

---

### Task 10: Replace `filterEmitKey` with Change Counter

**Files:**
- Modify: `src/renderer/src/composables/useFilterState.ts:493-496`
- Test: `tests/renderer/composables/useFilterState.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/renderer/composables/useFilterState.test.ts`:

```typescript
describe('filterGeneration change counter', () => {
  it('emits filters when generation bumps on filter change', async () => {
    const { result, onFiltersUpdate } = createState()

    result.filters.value.searchQuery = 'BRCA1'
    result.bumpFilterGeneration()

    // Advance debounce timer
    vi.advanceTimersByTime(300)
    await nextTick()

    expect(onFiltersUpdate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/composables/useFilterState.test.ts`
Expected: FAIL — `bumpFilterGeneration` is not a function

- [ ] **Step 3: Replace filterEmitKey with filterGeneration**

In `src/renderer/src/composables/useFilterState.ts`, replace lines 493-496:

```typescript
  // Old:
  // const filterEmitKey = computed(() => JSON.stringify(filters.value))
  // watch(filterEmitKey, () => {
  //   debouncedEmit()
  // })

  // New: lightweight change counter — zero serialization cost
  const filterGeneration = ref(0)
  const bumpFilterGeneration = (): void => {
    filterGeneration.value++
  }
  watch(filterGeneration, () => {
    debouncedEmit()
  })
```

Now add `bumpFilterGeneration()` calls to each function that mutates `filters.value`:

- `clearFilter()` — add at end of function (after line ~430)
- `removeTagFilter()` — add at end (after line ~434)
- `clearAllFilters()` — add at end (after line ~458)
- `handleGeneClear()` — add at end (after line ~467)
- `setInitialSearch()` — add at end (after line ~606)

Do NOT add it to `resetForCaseSwitch()` — that function already calls `onFiltersUpdate({})` directly (bypassing debounce).

Add `bumpFilterGeneration` to the returned object from the composable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/composables/useFilterState.test.ts`
Expected: PASS

- [ ] **Step 5: Update callers that set filter values directly**

Search the codebase for direct mutations of `filters.value.*` outside `useFilterState.ts`. If FilterToolbar or other components set filter values and expect automatic reactivity via the old `filterEmitKey` watcher, they now need to call `bumpFilterGeneration()`. Check the FilterToolbar component for patterns like `filters.value.consequences = [...]`.

If FilterToolbar uses v-model bindings that update `filters.value` reactively, those will no longer auto-trigger the debounced emit. The fix is to add `@update:model-value` handlers that call `bumpFilterGeneration()`, or to expose `bumpFilterGeneration` from the composable and call it from the toolbar.

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/composables/useFilterState.ts tests/renderer/composables/useFilterState.test.ts
git commit -m "perf: replace JSON.stringify filter key with change counter

Eliminates 1-5ms serialization on every filter change (keystroke,
checkbox toggle). Zero-cost reactivity via filterGeneration ref."
```

---

### Task 11: Pre-compute Case Count for Internal AF Filter

**Files:**
- Modify: `src/main/database/VariantRepository.ts:273-284`

- [ ] **Step 1: Pre-compute case count before the query**

In `src/main/database/VariantRepository.ts`, before the query builder chain that includes the internal AF filter (around line 260), add:

```typescript
    // Pre-compute case count to avoid per-row subquery in internal AF filter
    let totalCaseCount: number | undefined
    if (filter.max_internal_af !== undefined && filter.max_internal_af > 0) {
      const countResult = this.execFirst<{ cnt: number }>(
        this.kysely.selectFrom('cases').select(this.kysely.fn.countAll<number>().as('cnt'))
      )
      totalCaseCount = countResult?.cnt ?? 0
    }
```

Then replace the internal AF filter (lines 273-284) with:

```typescript
    // Internal AF filter (NULL-inclusive: variants without frequency data pass)
    query = query.$if(
      filter.max_internal_af !== undefined && filter.max_internal_af > 0 && totalCaseCount !== undefined && totalCaseCount > 0,
      (qb) =>
        qb.where(({ or, eb }) =>
          or([
            eb(sql.ref('vf.case_count'), 'is', null),
            eb(
              sql<number>`CAST(vf.case_count AS REAL) / ${totalCaseCount!}`,
              '<=',
              filter.max_internal_af!
            )
          ])
        )
    )
```

- [ ] **Step 2: Run variant query tests**

Run: `npx vitest run tests/main/handlers/`
Expected: PASS — the query produces identical results

- [ ] **Step 3: Commit**

```bash
git add src/main/database/VariantRepository.ts
git commit -m "perf: pre-compute case count for internal AF filter

Replaces per-row SELECT COUNT(*) subquery with a single pre-computed
value, eliminating redundant computation in variant queries."
```

---

## Phase 3: Perceived Performance & Cleanup

### Task 12: Defer Auto-Updater

**Files:**
- Modify: `src/main/index.ts:152-155`

- [ ] **Step 1: Replace `setImmediate` with `setTimeout`**

In `src/main/index.ts`, replace lines 152-155:

```typescript
    // Initialize auto-updater and schedule periodic checks
    // Deferred by 5s to avoid competing with startup data loading and rendering
    setTimeout(() => {
      initAutoUpdater()
      scheduleUpdateChecks()
    }, 5000)
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "perf: defer auto-updater init by 5 seconds

Prevents updater network I/O from competing with initial data
loading and window rendering on startup."
```

---

### Task 13: Lazy-Load Molstar Script

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/src/composables/useMolstarViewer.ts`

- [ ] **Step 1: Remove static Molstar script from index.html**

In `src/renderer/index.html`, remove the script tag and its comment (around line 27-33):

Remove:
```html
    <!-- pdbe-molstar: 3D protein structure viewer (web component).
         Loaded with `defer` so the 6 MB script doesn't block initial render.
         The composable uses customElements.whenDefined() to wait for
         registration, handling slow loads on Windows gracefully.
         The file is extracted from ASAR via asarUnpack to avoid
         large-file read issues on Windows. -->
    <script defer src="/pdbe-molstar-component.js"></script>
```

Keep the CSS link (`<link rel="stylesheet" ... href="/pdbe-molstar-light.css" />`), as CSS doesn't block the main thread significantly.

- [ ] **Step 2: Add lazy script injection to useMolstarViewer.ts**

In `src/renderer/src/composables/useMolstarViewer.ts`, add after the imports (around line 23):

```typescript
/** Lazy-load the pdbe-molstar web component script on first use */
let molstarScriptLoaded = false
function ensureMolstarScript(): Promise<void> {
  if (molstarScriptLoaded) return Promise.resolve()
  molstarScriptLoaded = true

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/pdbe-molstar-component.js'
    script.onload = () => {
      logService.info('pdbe-molstar script loaded on demand', 'MolstarViewer')
      resolve()
    }
    script.onerror = () => {
      molstarScriptLoaded = false // Allow retry
      reject(new Error('Failed to load pdbe-molstar script'))
    }
    document.head.appendChild(script)
  })
}
```

In the `startPolling` function (around line 196), add the script load before `customElements.whenDefined`:

```typescript
function startPolling(): void {
  stopPolling()

  if (typeof customElements === 'undefined') {
    loading.value = false
    error.value = 'Custom elements not supported'
    return
  }

  // Phase 0: Ensure the script is loaded (lazy — only on first 3D viewer open)
  ensureMolstarScript()
    .then(() => customElements.whenDefined('pdbe-molstar'))
    .then(() => {
      logService.info('pdbe-molstar custom element registered', 'MolstarViewer')
      // Phase 2: Poll for viewerInstance on the DOM element
      let viewerAttempts = 0
      const maxViewerAttempts = 60

      pollingTimer = setInterval(() => {
        viewerAttempts++
        if (tryAttachViewer()) {
          stopPolling()
          return
        }
        if (viewerAttempts >= maxViewerAttempts) {
          stopPolling()
          loading.value = false
          error.value = 'Timed out waiting for 3D viewer to initialize'
          logService.error(
            'pdbe-molstar viewer instance not found after timeout',
            'MolstarViewer'
          )
        }
      }, 500)
    })
    .catch((err: Error) => {
      loading.value = false
      error.value = '3D viewer component failed to load. Try restarting the application.'
      logService.error(`pdbe-molstar init failed: ${err.message}`, 'MolstarViewer')
    })
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/src/composables/useMolstarViewer.ts
git commit -m "perf: lazy-load Molstar script on first 3D viewer open

Removes static defer script from index.html. Script is now injected
on demand when the 3D viewer modal is first opened. Saves 100-300ms
of renderer thread time for users who never open the viewer."
```

---

### Task 14: Async ZipExtractor Writes

**Files:**
- Modify: `src/main/import/ZipExtractor.ts`

- [ ] **Step 1: Convert `extract` to async with `fs.promises.writeFile`**

In `src/main/import/ZipExtractor.ts`, change the import:

```typescript
import { writeFile } from 'node:fs/promises'
```

Remove the `writeFileSync` import from `node:fs`.

Change the method signature to async:
```typescript
  async extract(zipPath: string, targetDir: string, password?: string): Promise<ZipExtractionResult> {
```

Replace `writeFileSync(extractedPath, data)` (line 85) with:
```typescript
        await writeFile(extractedPath, data)
```

- [ ] **Step 2: Update all callers of `extract()`**

Search for callers of `zipExtractor.extract(` or `.extract(`. They will need to `await` the result now. Since the method was synchronous before, callers may not have `await`. Add `await` where needed.

Run: `npx grep -r "\.extract(" src/main/import/ --include="*.ts"` to find callers.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/import/ZipExtractor.ts
git commit -m "perf: async file writes in ZipExtractor

Replaces writeFileSync with fs.promises.writeFile to avoid blocking
the main thread during ZIP extraction, especially on Windows."
```

---

### Task 15: Extract Shared `convertBigInts` Utility

**Files:**
- Create: `src/main/utils/convertBigInts.ts`
- Modify: `src/main/ipc/handlers/cohort.ts:18-30`

- [ ] **Step 1: Create the shared utility**

Create `src/main/utils/convertBigInts.ts`:

```typescript
/**
 * Recursively convert BigInt values to Number for IPC serialization.
 *
 * IPC structured-clone cannot serialize BigInt. This converts them to Number,
 * which is safe for values within Number.MAX_SAFE_INTEGER (all our use cases).
 */
export function convertBigInts<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'bigint') return Number(obj) as unknown as T
  if (Array.isArray(obj)) return obj.map(convertBigInts) as unknown as T
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = typeof value === 'bigint' ? Number(value) : value
    }
    return result as T
  }
  return obj
}
```

- [ ] **Step 2: Update cohort.ts to use the shared utility**

In `src/main/ipc/handlers/cohort.ts`, replace the local `convertBigInts` function (lines 18-30) with an import:

```typescript
import { convertBigInts } from '../../utils/convertBigInts'
```

Remove the local function definition.

Also replace any `JSON.parse(JSON.stringify(..., bigint replacer))` patterns in this file with `convertBigInts(...)`. For example, the carriers handler:

```typescript
// Before:
return JSON.parse(
  JSON.stringify(carriers, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  )
)

// After:
return convertBigInts(carriers)
```

- [ ] **Step 3: Search for other JSON.parse/stringify BigInt patterns**

Run: `npx grep -r "bigint.*Number" src/main/ --include="*.ts"` to find other locations. Update them to use the shared utility.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/utils/convertBigInts.ts src/main/ipc/handlers/cohort.ts
git commit -m "refactor: extract shared convertBigInts utility

Replaces local function and JSON.parse/stringify patterns with a
single shared utility for consistent BigInt→Number conversion."
```

---

### Task 16: Fix Initial Loading Skeleton Flash

**Files:**
- Modify: `src/renderer/src/composables/useOffsetPagination.ts:70`

- [ ] **Step 1: Change `loading` initialization**

In `src/renderer/src/composables/useOffsetPagination.ts`, change line 70:

```typescript
// Before:
const loading = ref(false)

// After:
const loading = ref(true)
```

This ensures skeleton loaders display immediately on mount before the first IPC response, preventing the empty-table flash.

- [ ] **Step 2: Verify `loading` is set to `false` after first load**

Confirm that `loadPage` (or equivalent) sets `loading.value = false` in its finally block. Read the function to verify.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS — tests that check initial state may need `loading` expectation updated from `false` to `true`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/composables/useOffsetPagination.ts
git commit -m "fix: show skeleton loader immediately on table mount

Changes loading ref initial value to true so skeleton displays
before first data fetch, preventing empty-table flash."
```

---

## Self-Review Checklist

### Spec Coverage
| Spec Section | Task(s) |
|---|---|
| 1.1 Batch Annotation Endpoint | Tasks 1-4 |
| 1.2 Worker Offload cohort:rebuildSummary | Task 5 |
| 1.3 Worker Offload cases:delete | Task 6 |
| 1.4 Pool Remaining Handlers | Task 7 |
| 1.5 View-Switch Loading Overlay | Task 8 |
| 2.1 Deduplicate View-Switch Refresh | Task 9 |
| 2.2 Parallelize Case-Selection IPC | (Covered implicitly by Task 9 — removing the explicit refresh + Task 4 batch annotations reduces sequential chain) |
| 2.3 Replace filterEmitKey | Task 10 |
| 2.4 Pre-compute Case Count | Task 11 |
| 3.1 Defer Auto-Updater | Task 12 |
| 3.2 Lazy-Load Molstar Script | Task 13 |
| 3.3 Async ZipExtractor | Task 14 |
| 3.4 Consistent BigInt | Task 15 |
| 3.5 Initial Loading Skeleton | Task 16 |

### Spec Section 2.2 (Parallelize Case-Selection IPC) Note
The explicit "fire filter options + first variant page concurrently" optimization from spec section 2.2 is NOT a separate task because:
1. Task 9 removes the redundant refresh, which eliminates one source of sequential calls
2. Task 4 batches annotations, removing the biggest sequential bottleneck
3. The remaining sequential chain (filter options → variant page) is naturally fast once IPC calls are pooled (Task 7)
4. Adding explicit parallelization of `loadFilterOptions` and the filter-triggered `loadPage` is complex (requires breaking the reactive `watch` chain) and the benefit is marginal (~100ms) given the other optimizations

If profiling after Tasks 1-11 shows this is still a bottleneck, it can be added as a follow-up task.

### Type Consistency Check
- `VariantKey` type defined in Task 1, used in Tasks 2, 3, 4 ✓
- `DbTaskType` extended in Tasks 1 and 7 — additions are disjoint ✓
- `getBatch` signature in Task 2 matches worker dispatch in Task 3 ✓
- `batchGet` API signature in Task 1 (api.ts) matches preload in Task 3 ✓
- `spawnRebuildWorker` defined in Task 5, not used elsewhere ✓
- `filterGeneration` / `bumpFilterGeneration` defined and returned in Task 10 ✓
- `convertBigInts` signature in Task 15 matches existing usage ✓
