# PR 306 Renderer Race-Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent false cancellation success, stale child-dialog case writes, out-of-order metadata rollback, and cross-database cache contamination.

**Architecture:** Keep existing IPC contracts and add renderer-side authority boundaries. Cancellation commits only after a successful unwrapped IPC result and targets the active format executor, dialog events carry case/load authority, and case metadata mutations share a per-case serial queue scoped to a database generation.

**Tech Stack:** Vue 3, Pinia 3, TypeScript 6, Vitest, Vue Test Utils, Vuetify 4

---

### Task 1: Import cancellation remains active after backend rejection

**Files:**
- Modify: `tests/renderer/components/ImportWizard.test.ts`
- Modify: `src/renderer/src/components/import/ImportWizard.vue`

- [ ] **Step 1: Write the failing component regression**

Mount `ImportWizard` with Pinia and Vuetify, capture the `batchImport.onComplete` callback, start the store, set the exposed step to 3, and make `batchImport.cancel()` return a `SerializableError`. Assert that awaiting `cancelImport()` keeps step 3 and the active store phase, exposes the cancellation message, and that invoking the real completion callback then reaches step 4 with the real result. Add a success assertion that cancelled state is committed only after the cancel promise resolves.

- [ ] **Step 2: Verify the regression fails**

Run `npx vitest run tests/renderer/components/ImportWizard.test.ts`.

Expected: the new tests fail because `cancelImport()` commits cancellation synchronously and is not exposed to the test.

- [ ] **Step 3: Implement acknowledged cancellation**

Add local state and make cancellation await the selected API:

```ts
const cancelError = ref('')

async function cancelImport(): Promise<void> {
  cancelError.value = ''
  try {
    const result = isVcfImport.value
      ? await api!.import.cancel()
      : await api!.batchImport.cancel()
    unwrapIpcResult(result)
  } catch (error) {
    cancelError.value = formatIpcError(error, 'Cancellation failed')
    logService.warn(`Import cancel failed: ${cancelError.value}`, 'ImportWizard')
    return
  }
  completeAsCancelled()
}
```

Render `cancelError` through the existing alert, clear it in reset and real-completion paths, and expose the minimal state/functions required by the component regression. Keep `ImportWizard.vue` at or below its 876-line agent-health baseline.

- [ ] **Step 4: Verify the focused test passes**

Run the same Vitest command and expect all tests in the file to pass.

### Task 2: Reject child-dialog events from a stale case load

**Files:**
- Modify: `tests/renderer/components/case-data-info-tab.test.ts`
- Modify: `src/renderer/src/components/CaseDataInfoTab.vue`

- [ ] **Step 1: Write failing stale-event regressions**

For gene-list save, gene-list delete, and region-file import: load case 1, open the relevant child dialog, load case 2, emit/call the old dialog handler, and assert `caseMetadata.upsertDataInfo` is not called for case 2. Expose only the open and event handlers needed to drive this boundary.

- [ ] **Step 2: Verify the regressions fail**

Run `npx vitest run tests/renderer/components/case-data-info-tab.test.ts`.

Expected: stale handlers mutate the current selection and save case 2.

- [ ] **Step 3: Add dialog-origin authority checks**

Capture and validate a request origin:

```ts
interface CaseRequest {
  caseId: number
  generation: number
}

const geneListDialogRequest = ref<CaseRequest | null>(null)
const regionFileDialogRequest = ref<CaseRequest | null>(null)
```

Set the origin only while the current case is loaded, clear both origins in `resetLoadedState()`, and return from save/delete/import handlers before any mutation when `isCurrentCaseRequest()` rejects the captured origin.

- [ ] **Step 4: Verify the focused test passes**

Run the same Vitest command and expect all tests in the file to pass.

### Task 3: Serialize metadata mutations per case

**Files:**
- Modify: `tests/renderer/composables/use-case-metadata.test.ts`
- Modify: `src/renderer/src/composables/useCaseMetadata.ts`

- [ ] **Step 1: Write failing ordering regressions**

Use deferred IPC results to start overlapping operations for one case. Cover age where an earlier success precedes a newer failure, cohort replacement where the second optimistic update waits for the first, and HPO assignment where a first rejection does not prevent the queued second success. Assert call order and final cache contents.

- [ ] **Step 2: Verify the regressions fail**

Run `npx vitest run tests/renderer/composables/use-case-metadata.test.ts`.

Expected: overlapping calls reach IPC immediately and older success/rollback changes the cache out of order.

- [ ] **Step 3: Add the per-case serializer**

Add one module-level queue and wrap the complete body of every case-scoped write:

```ts
const mutationQueues = new Map<number, Promise<unknown>>()

async function serializeCaseMutation<T>(caseId: number, mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(caseId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(mutation)
  mutationQueues.set(caseId, result)
  try {
    return await result
  } finally {
    if (mutationQueues.get(caseId) === result) mutationQueues.delete(caseId)
  }
}
```

Apply it to scalar updates, cohort assign/replace, and HPO assign/remove so the snapshot and optimistic mutation happen inside the queued callback.

- [ ] **Step 4: Verify the focused test passes**

Run the same Vitest command and expect all tests in the file to pass.

### Task 3b: Isolate metadata activity across database switches

**Files:**
- Modify: `tests/renderer/composables/use-case-metadata.test.ts`
- Modify: `src/renderer/src/composables/useCaseMetadata.ts`

- [ ] **Step 1: Write failing database-generation regressions**

Start deferred metadata and cohort reads, clear the cache, and populate a colliding case/cohort from the new database before resolving the old reads. Queue two same-case mutations before clearing the cache and verify the queued operation never reaches IPC after the switch. Start cohort creation, switch databases after creation begins, and verify assignment is not attempted through the new session.

- [ ] **Step 2: Add a database-generation authority boundary**

Increment a module-level generation in `clearCache()`. Capture it for every read and mutation, check it before cache writes and rollbacks, and check it before a queued mutation invokes IPC. Clear the queue map during the switch so new-database writes do not wait for old work. Multi-step operations must check the generation between IPC calls.

- [ ] **Step 3: Verify the focused tests pass**

Run `npx vitest run tests/renderer/composables/use-case-metadata.test.ts` and expect all tests in the file to pass.

### Task 4: Repository verification and commit

**Files:**
- Verify all modified source, tests, and planning documents.

- [ ] **Step 1: Run focused tests together**

Run `npx vitest run tests/renderer/components/ImportWizard.test.ts tests/renderer/components/case-data-info-tab.test.ts tests/renderer/composables/use-case-metadata.test.ts`.

- [ ] **Step 2: Run static and sustainability gates**

Run `make typecheck`, `make lint-check`, `make format-check`, and `make agent-check`.

- [ ] **Step 3: Run the required full local gate**

Run `make ci` and require success.

- [ ] **Step 4: Inspect and commit**

Confirm the diff is scoped and no source-size baseline grew. Stage the two planning documents and the six source/test files, then commit with `fix(renderer): guard asynchronous metadata state`. Do not push.
