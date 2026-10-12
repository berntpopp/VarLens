# 08d — Ponytail fix review: desktop, cohort, import, errors, copy

- **Scope:** E-01 to E-05, E-07 to E-09, E-12, E-15, cohort C-P2-1/2/4/6/7/9/10, import I-P2-1/2/3/4, X-12, H-01 (F-P1-1), S-P2-1, S-P2-2.
- **Method:** I read the code at `bfd3d80e` (the worktree is read-only) and grepped every caller before proposing a change to shared code. I ran nothing: no app run, no tests.
- **Line counts** are net estimates and do not include tests.

---

## Must fix

### 1. E-01 · Desktop gene burden never finishes, and Cancel is dead
**What this is:** the desktop statistics worker pool that runs Fisher or logistic per gene.
**Problem:** the pool resolves a batch only on the worker's `'exit'` event. The worker answers `run` and then stays alive forever. So `run()` never settles, and `abort()` only takes effect on the *next* message, which never comes.
**Fix:** in the pool only, terminate the worker once it has reported progress for every gene in its batch. The existing `'exit'` handler then resolves with the results. `abort()` terminates the live workers. The worker file does not change.
```ts
// WorkerPool.ts
private live = new Set<Worker>()
...
const worker = new Worker(this.workerPath); this.live.add(worker)
let done = 0
...
} else if (msg.type === 'progress' && msg.progress) {
  totalCompleted++; onProgress?.(totalCompleted, genes.length)
  if (++done === batch.length) void worker.terminate()   // -> 'exit' -> resolve
}
worker.on('exit', () => { this.live.delete(worker); resolveWorker(batchResults) })
abort(): void { this.aborted = true; for (const w of this.live) void w.terminate() }
```
**If we skip it:** desktop gene burden is unusable, and every Run leaks one or more worker threads.
Root cause: VERIFIED — `src/main/statistics/WorkerPool.ts:66`, with `src/main/statistics/worker.ts:7-34` (never exits) and `WorkerPool.ts:49-53,84-86` (abort waits for a message).
Size: +6 lines
Test: new `tests/main/statistics/WorkerPool.test.ts`. Mock `worker_threads.Worker` as an EventEmitter that emits result and progress messages and never exits on its own. Assert that `run()` resolves for 1 gene and for 25 genes (the multi-worker path), and that `abort()` mid-run resolves. `integration.test.ts:208` mocks the whole pool, which is why this was never caught. `tests/e2e/gene-burden.e2e.ts` never presses Run.
Verdict: DO
*Report 06 proposes a `{type:'done'}` message in the worker plus a new `WorkerResponse` variant. That works, but it changes two files and a shared type. The progress count already says when a batch is finished.*

### 2. E-03 · Export can write over the open database
**What this is:** the main-process save-dialog handlers for case export, cohort export and BED export.
**Problem:** the path the user picks is written to as-is. If it is the open database, the encrypted DB is replaced by an XLSX and lost.
**Fix:** add one guard in `src/main/security/database-path-allowlist.ts`, which already holds the database-path rules. Call it in the 3 save paths right after the dialog returns.
```ts
export function assertNotDatabaseFile(target: string, getDbManager: () => DatabaseManager): void {
  const m = getDbManager()
  const dbs = [m.getCurrentPath(), ...m.getRecentDatabases().map((d) => d.path)]
    .filter((p): p is string => p !== null)
    .flatMap((p) => ['', '-wal', '-shm', '-journal'].map((s) => resolve(p + s)))
  const norm = (p: string) => (process.platform === 'linux' ? p : p.toLowerCase()) // case-insensitive FS
  if (dbs.map(norm).includes(norm(resolve(target))))
    throw new InvalidParametersError(`export target is a database: ${target}`,
      'This file is a VarLens database. Choose a different file name.')
}
```
Call sites: `src/main/ipc/handlers/export.ts:135` (variants) and `:231` (cohort), plus `src/main/ipc/handlers/panels.ts:376` (BED). `database.ts:283` (create DB) is a different case: it must refuse the *open* DB too, but the create flow already switches databases. Leave it.
**If we skip it:** one wrong click in a save dialog destroys the user's whole database. No undo exists.
Root cause: VERIFIED — `src/main/ipc/handlers/export.ts:119-135`, `:214-231`, with no check on `result.filePath`.
Size: +14 lines
Test: `tests/main/ipc/handlers/export-overwrite-guard.test.ts`. Stub `dialog.showSaveDialog` to return the current DB path, then assert an `INVALID_PARAMETERS` result and that the file bytes are unchanged.
Verdict: DO
*Forcing the `.xlsx` extension (from report 06) is not needed once this guard exists. It would also skip the OS overwrite prompt for the renamed path.*

### 3. E-02 · A case imported on desktop does not appear until reload
**What this is:** the shell refresh after the import wizard finishes.
**Problem:** the single-VCF wizard path reports completion only through the `batch-import-complete` emit (`ImportWizard.vue:599`). `App.vue` ignores that emit on desktop. The desktop `batchImport.onComplete` listener never sees this run, because the VCF path does not register a batch run ID.
**Fix:** delete the guard. On the batch path, the listener and the emit can then both refresh the list once. That is a second `refreshCases()`, which is cheap and idempotent.
```diff
 const handleDialogBatchImportComplete = async (): Promise<void> => {
-  if (!isWebRuntime()) return
   await handleBatchImportComplete()
 }
```
**If we skip it:** first-time desktop users see "No cases yet" after a successful import, import again, and hit the duplicate-name error (item 6).
Root cause: VERIFIED — `src/renderer/src/App.vue:382-385`, with `useShellLifecycle.ts:99-100` (listener filtered by `isCurrentBatchRun`). The guard came from `7e0fd3d5` ("avoid duplicate batch import invalidation"), which predates the VCF wizard path. `handleMetadataChanged` (`App.vue:387-391`) has the same desktop guard. Check whether desktop metadata edits also go stale.
Size: -1 line
Test: `tests/renderer/App.test.ts`. On the desktop runtime, emit `batch-import-complete` from the dialog host and assert that `caseListRef.refreshCases` was called.
Verdict: DO

### 4. E-04 · "Open…" on an encrypted database does nothing
**What this is:** the database picker's Open… button.
**Problem:** `handleOpen` shows the password dialog only if `result.info` is set. A `needsPassword` result never carries `info`. The Recent list works because it already knows the path.
**Fix:** let the store hand back the picked path, and reuse `handleOpenRecent`. The single caller is `DatabasePicker.vue:348`.
```ts
// databaseStore.ts: replace selectAndOpenFile
async function selectFile(): Promise<string | null> {
  requireCapability('localDatabaseFiles'); return await getApi().database.selectFile()
}
// DatabasePicker.vue
async function handleOpen(): Promise<void> {
  const path = await databaseStore.selectFile()
  if (path !== null) await handleOpenRecent(path)
}
```
**If we skip it:** password-protected databases can be opened only from the Recent list, and a database not on that list cannot be opened at all.
Root cause: VERIFIED — `src/renderer/src/components/DatabasePicker.vue:355`
Size: -12 lines
Test: `tests/renderer/components/DatabasePicker.test.ts`. Mock `selectFile` to return `/x.db` and `openDatabase` to return `{needsPassword:true}`, then assert that the password dialog `show` was called.
Verdict: DO

### 5. E-05 · No OS keyring: no database, yet the app invites an import
**What this is:** the welcome empty state when startup opened no database (`startup.ts:209-225` leaves the manager empty on purpose).
**Problem:** `EmptyState` checks only `hasCases` and `allowImport`, so it shows "Import Variants". The import then fails with "A database error occurred".
**Fix:** CaseView passes `:no-database="canUse('localDatabaseFiles') && databaseStore.currentPath === null"`. EmptyState gets one more branch before the import branch: "No database is open. Create or open one from the database menu in the toolbar." `openImportDialog` in `App.vue:377` gets the same condition, which also stops Ctrl+I. Web is unaffected because it has no `localDatabaseFiles` capability.
**If we skip it:** keyring-less Linux users (headless, some Wayland/KDE setups) get a first run that fails with a meaningless error.
Root cause: VERIFIED — `src/renderer/src/components/EmptyState.vue:20-40`, `src/renderer/src/views/CaseView.vue:373-377`
Size: +8 lines
Test: `tests/renderer/components/EmptyState.test.ts`. With `noDatabase`, there is no Import button and the "No database is open" text shows.
Verdict: DO. Opening the passphrase-setup dialog automatically on first run is DO-LATER (a flow decision).

### 6. E-08 + I-P2-4 · Duplicate or empty case name: "unexpected error", or accepted silently
**What this is:** single and multi-sample VCF import (preview step, then the SQLite executor).
**Problem:** the executor runs the worker with `duplicateStrategy: 'skip'`. A skipped detail is rejected with the plain message `'Duplicate case name'`, which maps to UNKNOWN. The Postgres path already throws `UniqueConstraintError('case', name)` and gets a good CONFLICT message. In the preview step, a cleared name is sent as `''`, because the field displays `caseNames.get(s) || sample` while storing `''`.
**Fix:**
1. Server, for parity with Postgres. In `SqliteImportExecutor.ts:222`, when `detail?.status === 'skipped'`, `reject(new UniqueConstraintError('case', caseName))`. Both backends then say "Case 'HG005' already exists. Choose a different name."
2. Client. In `VcfPreviewStep.vue`, load `api.cases.list()` names once in `onMounted`. Give the name field `:error-messages` for an empty name, an existing name, or the same name used twice in this file. Add `valid` to the `selection-changed` payload. The Import button in `ImportWizard.vue:148` adds `|| !vcfValid`, like the batch path's `hasEmptyCaseNames`.
`checkDuplicates` cannot be reused here, because it derives names from file paths, not from typed names.
**If we skip it:** re-importing a sample fails with a meaningless error. Two cases can share a name in the sidebar, which risks opening the wrong case.
Root cause: VERIFIED — `src/main/storage/sqlite/SqliteImportExecutor.ts:155-158,222-228`, `src/main/workers/import-worker.ts:173-182`, `src/renderer/src/components/import/VcfPreviewStep.vue:58-70,183-186`
Size: +3 (server), +14 (client)
Test: `tests/main/storage/sqlite/SqliteImportExecutor.test.ts`. A skipped detail rejects with `UniqueConstraintError`, and `toSerializableError(...)` gives code CONFLICT. Plus `tests/renderer/components/import/vcf-import-dialog.test.ts`: an existing name shows the error and disables Import.
Verdict: DO (server part first, it is 3 lines)

### 7. E-09 (X-12) · A damaged or non-database file says "Incorrect password"
**What this is:** the encryption probe `DatabaseManager.openDetectEncryption`.
**Problem:** any `SQLITE_NOTADB` counts as "encrypted, needs a password". That includes a ZIP/XLSX, or a plaintext SQLite file with a damaged body.
**Fix:** before returning `needsPassword: true`, read the first 16 bytes. If they are `SQLite format 3\0` (this app's sqlite3mc cipher has no plaintext header, so a readable header plus NOTADB means the file is damaged) or `PK\x03\x04`, throw `InvalidParametersError(…, 'This file is not a VarLens database or is damaged.')`. Both callers inherit the fix: `startup.ts:139` and `database-lifecycle-logic.ts:218`.
**If we skip it:** users believe they forgot the password and may give up on a recoverable situation.
Root cause: VERIFIED — `src/main/services/DatabaseManager.ts:79-99`
Size: +7 lines
Test: `tests/main/services/DatabaseManager.test.ts`. Write a file that starts with `PK\x03\x04` and assert the thrown user message. A real encrypted fixture must still return `needsPassword: true`.
Verdict: DO
*`ponytail:` this catches only those two signatures. Random garbage still looks like ciphertext, and that cannot be told apart without a key.*

### 8. H-01 (F-P1-1) · The FAQ says nothing leaves the machine
**What this is:** `faqConfig.json`, the 4 privacy, storage and requirements answers.
**Problem:** the claim is false in **both** runtimes, not just web. Desktop also calls Ensembl VEP ("Fetch VEP"), MyVariant, SpliceAI and others on demand. The "supported formats" answer also still says "gzipped JSON from VEP" only.
**Fix:** rewrite the 4 answers once, so that they are true everywhere. Example: "Variant data is stored in a database you control: a local, encrypted file in the desktop app, or your organisation's server in the web edition. Lookups you start or enable (gnomAD, Ensembl VEP, UniProt, …) send the variant or gene identifier to that service; see Settings → External lookups." Also list VCF in the formats answer.
**If we skip it:** a DPO approves deployment based on a false statement. This is a compliance risk, not a UX one.
Root cause: VERIFIED — `src/renderer/src/config/faqConfig.json:16,21,26,56,61`. It is also wrong for desktop, which report 04 missed.
Size: ±0 (copy edits)
Test: none needed (copy)
Verdict: DO
*Report 04's per-item `runtime: 'desktop' | 'web'` field plus a filter is over-engineered. Answers that are true in both runtimes need no code.*

---

## Should fix

### 9. C-P2-2 · `/`, Ctrl+Shift+F/X and Alt+Shift+C do nothing in the cohort
**What this is:** the global shortcut wiring in `App.vue`.
**Problem:** all 4 handlers call `filterToolbarRef`, which is the case FilterToolbar only.
**Fix:** reuse what `useAppState` already has (`activeTab`, `cohortViewRef`).
1. `CohortFilterBar` exposes `toggleFilterDrawer`, `toggleColumnsDrawer`, `focusSearch` and `handleClearAll`. It already owns `filterDrawerOpen`, `columnsDrawerOpen` and `handleClearAll`. For `focusSearch`, add a template ref on `DslSearchBar`, which already exposes `focus`.
2. `CohortTable` and `components/CohortView` each pass the bar through with one `defineExpose` line.
3. App gets `const bar = () => activeTab.value === 'cohort' ? cohortViewRef.value?.filterBar : filterToolbarRef.value` and uses it in the 4 handlers.
**If we skip it:** the shortcut sheet lies for the cohort, which is a mandated parity gap.
Root cause: VERIFIED — `src/renderer/src/App.vue:415-421`, `src/renderer/src/components/cohort/CohortFilterBar.vue:611` (exposes only `dslColumnFilters`)
Size: +12 lines
Test: `tests/renderer/App.test.ts`. With `activeTab = 'cohort'`, pressing `/` calls the cohort bar's `focusSearch`.
Verdict: DO
*Report 04's "activeFilterBar ref that each view registers on mount" adds registration state. The active tab and the view ref already exist.*

### 10. C-P2-4 · Invalid DSL behaves differently in case and cohort
**What this is:** the shared `useDslFilterIntegration` and `DslSearchBar`.
**Problem:** both views use the *same* composable. On Enter with parse errors it applies nothing (`translationResult` is empty), so "cohort drops it" is already the shared rule. The case-view "0 results" most likely comes from a **stale FTS term**: `watch(ftsQuery)` writes the search only while not in DSL mode. Typing `gene` applies an FTS search for "gene", typing `:` switches to DSL mode, and the "gene" search stays applied, invisibly. The error text exists only in a hover tooltip.
**Correct shared behaviour:** invalid DSL applies nothing, keeps the previous result, and shows the error inline.
**Fix:** two edits, both in shared code, so case and cohort get them together.
```diff
 // useDslFilterIntegration.ts:57
-watch(ftsQuery, (query) => { if (!isDslMode.value) searchQueryRef.value = query })
+watch(ftsQuery, (query) => { searchQueryRef.value = query }) // '' in DSL mode clears a leftover FTS term
```
```diff
 <!-- DslSearchBar.vue: replace hide-details + hover tooltip -->
-      hide-details
+      :hide-details="!hasErrors"
+      :error-messages="hasErrors ? errors[0]?.message : undefined"
-    <v-tooltip v-if="hasErrors" :text="errors[0]?.message" location="bottom" :activator="textFieldRef?.$el" />
```
**If we skip it:** an invisible FTS filter hides variants while the bar shows a DSL expression.
Root cause: WRONG (partly) — the drop is shared and correct. The real bug is the stale FTS term at `src/renderer/src/composables/useDslFilterIntegration.ts:57-61`, plus the tooltip-only error at `src/renderer/src/components/DslSearchBar.vue:87-92`. I did not reproduce the case-view 0 result. Confirm with keystroke typing, not `fill`.
Size: -4 lines
Test: `tests/renderer/composables/useDslFilterIntegration.test.ts`. Set the input to `gene`, flush, then `gene:===`, and assert that `searchQueryRef` is `''`.
Verdict: DO. Inline error-messages change the toolbar height when an error appears, so run the CLS interaction gate on it.

### 11. C-P2-9 · "View in Case" opens an empty Shortlist
**What this is:** cohort carrier row → case view, which passes the variant through the existing `initialSearch`.
**Problem:** a case switch lands on the Shortlist tab (the default preference). Shortlist hides FilterToolbar, which is the only consumer of `initialSearch`, so the search is never applied.
**Fix:** when a search is waiting, land on the per-type tab instead of Shortlist.
```diff
 // CaseView.vue:192 and :209
-if (settingsStore.defaultCaseTab === 'shortlist') {
+if (settingsStore.defaultCaseTab === 'shortlist' && initialSearch.value === undefined) {
```
**If we skip it:** the cross-view jump loses the variant, and the user has to search for it by hand.
Root cause: VERIFIED — `src/renderer/src/views/CaseView.vue:192-193,209`, with `views/CohortView.vue:37` (sets `initialSearch`) and `FilterToolbar.vue:565` (its only consumer)
Size: ±2 lines
Test: `tests/renderer/views/CaseView.test.ts`. With `initialSearch` set and `defaultCaseTab = 'shortlist'`, `selectedVariantType` is `'snv'` after the case switch.
Verdict: DO. "Back does not return" is not verified in code: the `case` URL key uses `push` (`useViewUrlBindings.ts:34`). Re-test after this fix before doing anything else.

### 12. C-P2-10 · Burden "55 genes tested" vs a 69-row table, and raw warning codes
**What this is:** the gene burden summary, table and plots, and the shared `finalizeAssociationResults`.
**Problem:** `testedCount` counts `n_variants > 0`, but the table and both plots get every result. The warning strings are built as `${gene}: ${code}` in shared main code.
**Fix:**
1. In `GeneBurdenView.vue`, add `const tested = computed(() => results.value?.results.filter(r => r.n_variants > 0) ?? [])`. Pass it to the table and plots (lines 85, 91, 94). Add one caption: "{{ n }} genes had no qualifying variants (not shown)".
2. In `src/main/statistics/finalize.ts:52`, map the codes once, which covers desktop and web:
`const TEXT = { ZERO_BURDEN: 'no qualifying variants in either group; logistic test skipped', FIRTH_CONVERGE_FAIL: 'logistic (Firth) fit did not converge; no logistic p-value' }`
The alert is already `type="warning"` (`GeneBurdenView.vue:43`), so the "red error banner" in the report is just how the theme's warning colour looks.
**If we skip it:** the summary contradicts the table, and nobody can read the warnings.
Root cause: VERIFIED — `src/renderer/src/components/association/GeneBurdenView.vue:85-94,158-160`, `src/main/statistics/finalize.ts:50-54`
Size: +8 lines
Test: `tests/main/statistics/finalize.test.ts`. A `FIRTH_CONVERGE_FAIL` result produces the sentence, not the code.
Verdict: DO. The OR "–" with a CI shown, and nudging a rarity filter before Run, are DO-LATER (a statistics display decision).

### 13. C-P2-1 · Cohort SV/CNV/STR tabs show SNV columns
**What this is:** the static `baseHeaders` in `useCohortColumns`.
**Problem:** one column list serves every variant type. The SV-specific case columns (`sv_type`, `sv.support`, VAF) are per-sample values. They do not exist in `cohort_variant_summary`, and `CohortVariant` does not even carry `end_pos`.
**Fix:**
- Now: pass `selectedVariantType` to `useCohortColumns` and filter out `ref`, `gnomad_af`, `cadd_phred`, `cdna` and `aa_change` for non-SNV types. Meaningless columns disappear.
- Later: add `end_pos` (the summary table has it, `cohort-summary-case-add-sql.ts:63`) to both backends' cohort select, and then an End column.
**If we skip it:** SV rows show `N` / `<DEL>` and empty gnomAD/CADD columns. That reads as broken data.
Root cause: VERIFIED — `src/renderer/src/components/cohort/useCohortColumns.ts:12-31,38`
Size: +5 lines now. End column +~15 over 2 backends.
Test: `tests/renderer/components/cohort/useCohortColumns.test.ts`. With variant type `sv`, the visible keys exclude `gnomad_af`.
Verdict: DO (hide), DO-LATER (End column)

### 14. I-P2-1 (X-12) · Upload errors shown as raw transport text and JSON
**What this is:** the web upload XHR error path.
**Problem:** the message is built as `web upload: ${status} ${statusText}: ${responseText}`, and the response text is a JSON envelope.
**Fix:** pull out the server's `message` and name the file.
```ts
let detail = text
try { detail = (JSON.parse(text) as { message?: string }).message ?? text } catch { /* not JSON */ }
const message = `${file.name}: ${detail}`
```
**If we skip it:** users see `{"error":"unsupported-file-type",…}` and cannot tell which file was refused.
Root cause: VERIFIED — `src/web/client/uploads.ts:103-104`
Size: +2 lines
Test: `tests/web/client/uploads.test.ts` (new, or the nearest existing one). A 400 with a JSON body rejects with `"bad.txt: Only VCF…"`.
Verdict: DO

### 15. I-P2-2 · One refused file aborts the whole web batch
**What this is:** `uploadImportFiles`, the sequential upload loop.
**Problem:** any rejection discards every staged upload and throws.
**Fix:** on a server *refusal* (an HTTP 4xx), skip that file and keep going. The error event with the file name has already been dispatched. Cancel and network errors keep the discard-all behaviour, which is correct. Throw only when nothing was uploaded.
```ts
} catch (error) {
  if (!(error instanceof UploadRefusedError) ) { void discardUploads(...); throw error }
}
```
`UploadRefusedError extends Error` is thrown only from the `onload` non-2xx branch.
**If we skip it:** one stray `.txt` file in a folder blocks importing the 50 good files.
Root cause: VERIFIED — `src/web/client/uploads.ts:197-210`
Size: +6 lines
Test: in the same upload test, 3 files where the second gets a 400 resolve to 2 refs.
Verdict: DO. Rejected files as rows in the Review step is DO-LATER.

### 16. I-P2-3 · "Auto-detected from VCF header" shown when nothing was detected
**What this is:** the genome-build select hint in the VCF preview.
**Problem:** the hint is hard-coded. A null `detectedGenomeBuild` silently keeps GRCh38.
**Fix:**
```vue
:hint="preview.detectedGenomeBuild ? 'Detected from the VCF header.' : 'Not detected in the VCF header. GRCh38 is assumed; change it if needed.'"
:color="preview.detectedGenomeBuild ? undefined : 'warning'"
```
**If we skip it:** a wrong build produces wrong gnomAD and UCSC links with no warning. This is a domain-integrity issue.
Root cause: VERIFIED — `src/renderer/src/components/import/VcfPreviewStep.vue:38`
Size: +1 line
Test: `vcf-import-dialog.test.ts`. A preview with `detectedGenomeBuild: null` shows "Not detected".
Verdict: DO

### 17. S-P2-1 · After sign-out, Back shows a broken app shell
**What this is:** the web SPA shell plus RPC transport after the session is gone.
**Problem:** Back restores the page from bfcache, so the page gate (`page-gate.ts`, which redirects unauthenticated page loads) never runs. Every RPC then fails with 401 into a half-rendered shell.
**Fix:** one line in `src/web/client/transport.ts` before the envelope handling: `if (res.status === 401) window.location.reload()`. The reload hits the page gate, which already redirects to `/login?next=`. Also send `cache-control: no-store` for `index.html` in `static.ts:94` instead of `no-cache`, which keeps it out of bfcache.
**If we skip it:** it looks broken after every sign-out. No data leaks: verified, every call returns 401.
Root cause: VERIFIED — `src/web/client/transport.ts:33-41` (no 401 branch), `src/web/server/static.ts:47,94`
Size: +2 lines
Test: `tests/web/client/transport.test.ts`. A 401 response calls `location.reload`.
Verdict: DO
*Before merging, check that no dispatcher domain error uses HTTP 401 for a *user* mistake, such as a wrong current password in change-password (`dispatcher.ts:222`). If one does, the reload would throw away the dialog.*

### 18. S-P2-2 · Create User gives the wrong reason for a short password
**What this is:** the admin create-user form, plus the `auth:createUser` route.
**Problem:** the shared `PasswordSchema` is `min(8)`. A 5-character password fails the Zod parse and gets the catch-all "Username, name and password are required." The real policy, `WEB_MIN_PASSWORD_LENGTH = 12`, is enforced later. The form only checks that the field is not empty.
**Fix:**
- Client: `:rules="[v => v.length >= WEB_MIN_PASSWORD_LENGTH || PASSWORD_HINT]"`. Also disable the button while `newTempPassword.length < WEB_MIN_PASSWORD_LENGTH`. Import the constant and build `PASSWORD_HINT` from it, which removes the hard-coded "12".
- Server: change the fallback message to "Username, display name and a temporary password of at least 12 characters are required."
**If we skip it:** admins get stuck guessing what is wrong.
Root cause: VERIFIED — `src/shared/api/schemas/auth.ts:7`, `src/web/server/routes/auth-admin.ts:105-112`, `src/renderer/src/components/UserManagement.vue:14-15,176-200`
Size: +3 lines
Test: `tests/renderer/components/UserManagement.test.ts`. An 11-character password keeps Create disabled. The Reset dialog has the same gap, so apply the same rule there.
Verdict: DO

### 19. E-12 · Desktop export stores AF as text, and leaves out ACMG and comments
**What this is:** `formatCellValue` in the shared export renderer (desktop XLSX/CSV and web downloads) and the export column list.
**Problem:** `gnomad_af` becomes `toExponential(2)` and CADD becomes `toFixed(2)`. Both are **strings**, so Excel sorts them as text. The ACMG classification, comments and tags are not in the export query at all.
**Fix:**
- AF and CADD now: `return Number(value.toPrecision(3))` for AF and `Number(value.toFixed(2))` for CADD and HPO. The cells stay numeric in XLSX, and CSV prints plain numbers. Every caller gets it, because one function serves all: `export-pipeline.ts:87,163`, `export-logic.ts:241`, `web/server/downloads/export-artifacts.ts:137,151`.
- ACMG and comments later: they need an annotation join in both backends' export SQL.
**If we skip it:** the exported AF cannot be filtered in Excel, and the analyst's classifications are lost in the hand-off.
Root cause: VERIFIED — `src/main/workers/export-renderer.ts:2-13`, `src/main/workers/export-pipeline.ts:23-41`
Size: ±3 lines now. ACMG +~30 over 2 backends.
Test: `tests/main/workers/export-renderer.test.ts`. `formatCellValue('gnomad_af', 3.63e-5)` returns the number `0.0000363`, and `typeof` is `number`. Update the existing string expectations.
Verdict: DO (numeric), DO-LATER (ACMG/comments/build columns)

### 20. E-07 · Last-used database not reopened on restart
**What this is:** `openDefaultSqliteDatabase` at startup.
**Problem:** startup always opens `<userData>/varlens.db`. `RecentDatabasesService` keeps the most recent entry first (`unshift`), but startup never reads it.
**Fix:** before the default path, take `recent[0]`. If it is not the default, exists, and passes the existing `isAllowedDatabasePath` rules (no symlinks, exact metadata path), open it with `keyStore.resolveKeyForPath(...)` when that resolves, or plain when `openDetectEncryption` says no password is needed. On any failure, log and fall through to the default.
**If we skip it:** users who work in a project database land in an empty default database after every restart.
Root cause: VERIFIED — `src/main/database/startup.ts:125-131`
Size: +12 lines
Test: `tests/main/database/database-startup.test.ts`. A plaintext recent entry is opened. A passworded recent entry falls back to the default.
Verdict: DO-LATER
*`ponytail:` password-protected recent databases still fall back silently. Prompting at startup needs a renderer flow and a decision on whether reopening on launch is wanted at all (security posture on shared machines).*

### 21. C-P2-6 + E-15 · The denominator and the cohort frequency mix variant types
**What this is:** the count pill total (`cohortSummary.unique_variants`) and the cohort frequency denominator (`COHORT_BUILD_TOTALS_JOIN`).
**Problem:** both count every type and every ready case per build. On the SNV tab, "1,647 / 1,659" puts SV and STR rows in the total. Cohort Freq divides by cases that have no SNV data.
**Fix:**
- Now: `CohortFilterBar.vue:4` passes `null` as the total when a variant type is selected. The pill then shows only the filtered count, the way it does with no denominator.
- Later: per-type totals, and a frequency denominator of "cases with any variant of this type". This means changing `COHORT_BUILD_TOTALS_JOIN` and its Postgres mirror `SUMMARY_FREQUENCY_SQL`.
**If we skip it:** cohort frequency is understated whenever some cases are SV-only or STR-only, which is rare in practice but wrong.
Root cause: VERIFIED — `src/renderer/src/components/cohort/CohortFilterBar.vue:4`, `src/main/database/cohort-frequency-sql.ts:27-35`
Size: ±1 line now. Frequency +~20 over 2 backends.
Test: none needed for the pill (trivial). The frequency change needs `tests/main/database/cohort-frequency*.test.ts` in both backends.
Verdict: DO (pill), DO-LATER (frequency: what counts as "a case typed for SNVs" is a domain decision)

### 22. C-P2-7 · `1` and `chr1` counted as different variants
**What this is:** the chromosome value stored at import and used as the cohort summary key.
**Problem:** import stores the raw `chr` value. Normalisation exists only for API calls, in 5 copies: `VepApiClient.normalizeChromosome`, `SpliceAI`, `MyVariant`, `par-regions` and `bed-filter`.
**Fix:**
- Where: normalise **at import**, in the VCF mapper and the JSON mapper, so that the stored value, the filters, the summary key and the links all agree. Do it with one shared `normalizeChromosome` in `src/shared/` that replaces the 5 copies.
- Existing data: add a migration on both backends that rewrites `chr` and rebuilds the cohort summary.
- Not at query time: that would need normalised expressions on the indexed `chr` columns, and would break the keyset and chr-rank indexes.
**If we skip it:** carriers are undercounted when sources mix naming styles, which happens in real labs.
Root cause: VERIFIED — no normalisation in `src/main/import/` (grep). Copies at `src/main/services/api/VepApiClient.ts:35`, `src/shared/utils/par-regions.ts:39`, `src/main/import/vcf/bed-filter.ts:14`.
Size: ~+60 lines (helper, mappers, 2 migrations), and -15 from removing the copies
Test: an import test where `chr1` and `1` files produce one cohort row with 2 carriers.
Verdict: DO-LATER (a migration on user data needs its own spec. Display convention, `chr1` vs `1`, is a product decision.) Cheap interim fix: a cohort banner when `getColumnMeta('chr')` contains both styles, about +6 lines.

---

## Nice to have

None in my set. Everything assigned either affects data or trust, or is a P2 parity gap.

---

## Over-engineered proposals in reports 02–07 (my area)

| Report | Proposal | Leaner |
|---|---|---|
| 04 F-P1-1 | Add `runtime` to each FAQ item and filter by capability | Write answers that are true in both runtimes, with no code (item 8) |
| 04 C-P2-2 | A new `activeFilterBar` ref registered by each view | Existing `activeTab` and `cohortViewRef` (item 9) |
| 06 E-01 | A `done` message type in the worker plus pool changes | Pool-only: terminate when progress equals the batch length (item 1) |
| 06 E-03 | Guard plus forced `.xlsx` extension | Guard only (item 2) |
| 06 E-02 | New E2E for the sidebar count | Unit test in the existing `App.test.ts` (item 3) |
| 04 I-P2-4 | "Reuse `checkDuplicates` per sample name" | Not reusable (it is path-based). One `cases.list()` in the preview step (item 6) |
| 04 C-P2-1 | Derive cohort headers from the case per-type registry | The case SV columns are per-sample and have no cohort data. Hide the SNV-only columns (item 13) |

---

## Summary table

| # | ID | Verdict | Size |
|---|---|---|---|
| 1 | E-01 burden hang / cancel | DO | +6 |
| 2 | E-03 export over DB | DO | +14 |
| 3 | E-02 import not shown | DO | -1 |
| 4 | E-04 Open… encrypted | DO | -12 |
| 5 | E-05 no-keyring empty state | DO | +8 |
| 6 | E-08 + I-P2-4 duplicate/empty names | DO | +17 |
| 7 | E-09 damaged file ≠ wrong password | DO | +7 |
| 8 | H-01 FAQ claims | DO | ±0 |
| 9 | C-P2-2 cohort shortcuts | DO | +12 |
| 10 | C-P2-4 invalid DSL / stale FTS | DO | -4 |
| 11 | C-P2-9 View in Case | DO | ±2 |
| 12 | C-P2-10 burden 55/69 + codes | DO | +8 |
| 13 | C-P2-1 cohort SV columns | DO (hide) / DO-LATER (End) | +5 |
| 14 | I-P2-1 raw upload errors | DO | +2 |
| 15 | I-P2-2 batch aborts | DO | +6 |
| 16 | I-P2-3 "Auto-detected" claim | DO | +1 |
| 17 | S-P2-1 Back after sign-out | DO | +2 |
| 18 | S-P2-2 short-password message | DO | +3 |
| 19 | E-12 export AF numeric / ACMG | DO / DO-LATER | ±3 / +30 |
| 20 | E-07 reopen last DB | DO-LATER | +12 |
| 21 | C-P2-6 + E-15 denominators | DO (pill) / DO-LATER (freq) | ±1 / +20 |
| 22 | C-P2-7 chr normalisation | DO-LATER | ~+45 net |

**Total for the DO items: about +85 net lines over 22 findings.**

Not checked: I ran nothing (no app run, no tests), and every root cause comes from reading the code. C-P2-4's case-view "0 results" is explained by the stale-FTS reading, but I did not reproduce it. The Back-after-View-in-Case history and the dispatcher's use of 401 (item 17) are unverified.
