# 13 — Ponytail review: PR 5 `fix/desktop-audit` (9 commits, +783/−85, `git diff origin/main...HEAD`)

**What this change does:** Fixes the desktop items from 08d 1–7 and 19 and issue #545. Burden workers now handle one batch each and exit, a crash rejects, and Cancel terminates them. Save dialogs refuse the open or a recent database file and its sidecar files. A plaintext SQLite or ZIP header is reported as "damaged", not "encrypted". A SQLite duplicate-name skip becomes `UniqueConstraintError` (CONFLICT), the same as Postgres. Imports are blocked with no DB open, Open… reuses the Recent handler, and exports keep AF/CADD as numbers.

## Must fix
1. **The case-name clash hint never fires in the app** (`src/renderer/src/components/import/VcfPreviewStep.vue:217-223`)
   - **What this is:** The VCF preview loads the existing case names so it can flag "already exists" before import (I-P2-4).
   - **Problem:** `api.cases.list()` returns `IpcResult<Case[]>` (`src/shared/ipc/domains/cases.ts:6`), not an array. So `Array.isArray(cases)` is always false and the set stays empty. The test passes only because it mocks a raw array (`tests/renderer/components/import/VcfPreviewStep.test.ts:23`).
   - **Fix:** `api!.cases.list().then(unwrapIpcResult).catch(() => null)`, and make the mock return `{ success: true, data: [...] }`. 2 lines.
   - **If we skip it:** The server still refuses a duplicate (E-08 works), but the early inline error, half of I-P2-4, is dead code.

## Extra checks (all pass)
- **Config-driven:** sidecar suffixes, file signatures, messages → `database.config.ts`. Export rounding → `export.config.ts`. Case-name copy → `importConfig.ts`. Nothing new is hardcoded.
- **E-01:** `parentPort.once` means one batch per worker. Node drains posted messages before `'exit'`, so no result is lost. Non-zero exit without abort rejects; `abort()` terminates every live worker and the run settles with partial results, which the engine reports as "Analysis cancelled". The pool is new for each run (`AssociationEngine.ts:63`), so `live` and `aborted` cannot leak into a second run. The job's `finally` runs, so DB switching is unblocked. The fixture covers 1 gene, 25 genes, a crash and abort-during-hang. The real worker's natural exit is checked only by reading the code.
- **E-03:** every `showSaveDialog` and export write in `src/main` is covered: variants and cohort (`export.ts`), BED (`panels.ts`). `database.ts:283` (create DB) and `automatedExportPath` (E2E only) are rightly out of scope. `realpathSync.native` follows symlinks for files on disk (symlink test included). Paths are lower-cased off Linux. `resolve()` handles relative paths and trailing separators. The list is the current DB plus `getRecentDatabases()`. Limits, too rare to fix: a hard link, and the WAL file of a symlinked DB.
- **E-09:** the probe runs only after "not a database". Plain SQLite opens before that, and SQLite3MC encrypts page 1 including the header (no `plaintext_header` pragma anywhere), so a valid encrypted DB cannot start with `SQLite format 3\0`. The real-encrypted-DB test still gives `needsPassword: true`. A false "damaged" is ruled out.
- **E-08:** the `skipped` reject is reached only for a duplicate; a cancel mid-file sets `results.cancelled` and returns earlier. Maps to CONFLICT via `serializable-error.ts:59`; test included.
- **E-05:** toolbar, sidebar, shortcut (`setImportHandler`) and empty-state import are all gated. `noDatabaseOpen` needs `canUse('localDatabaseFiles')`, so web is unaffected. Postgres on desktop has a non-null path, so no false block.
- **Security:** no changes in `src/preload` or `src/shared/ipc`, so no new IPC surface. The renderer only drops `selectAndOpenFile` (no callers left).

Verdict: fix 1 first.
Not checked: tests and `make preflight-full` were not run (read-only review). `handleMetadataChanged` still has its desktop guard (08d item 3 note). The module-level `activeEngine` in `cohort-logic.ts` gets overwritten if two burden runs overlap; this predates the PR, and I did not check whether jobRunner serialises runs.


## Parent verification (2026-10-12)
Must-fix 1 is **not a bug**: `IpcResult<T> = T | SerializableError` (`src/shared/types/errors.ts:43`), so `cases.list()` resolves to a bare array and `Array.isArray(cases)` is the right check. A wrapped `{ success, data }` mock made the test fail against the fixed code. Change reverted; PR 5 ships as is.
