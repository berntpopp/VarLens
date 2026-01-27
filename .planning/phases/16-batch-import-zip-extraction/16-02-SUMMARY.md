# Plan 16-02 Summary: ZipExtractor + TempDirectoryManager + ZIP Flow UI

## Status: Complete

**One-liner:** ZIP extraction with adm-zip, Zip Slip prevention, password support, temp dir lifecycle, and full dialog UI flow

## What Was Built

ZIP archive import capability for the batch import system, allowing users to select a ZIP file containing JSON.gz variant files, optionally enter a password for encrypted archives, preview extracted files, and import them.

### Deliverables

1. **TempDirectoryManager** (`src/main/import/TempDirectoryManager.ts`)
   - Creates unique temp directories via `mkdtempSync` with `varlens-zip-` prefix
   - Recursive cleanup with `rmSync` on completion or error
   - Null-safe lifecycle (create -> getPath -> cleanup)

2. **ZipExtractor** (`src/main/import/ZipExtractor.ts`)
   - `isEncrypted()` — checks ZIP entries for encrypted flag
   - `extract()` — extracts JSON/gz/json.gz files with Zip Slip path traversal prevention
   - `testPassword()` — validates password by attempting to read first file entry
   - `validatePath()` — rejects `..`, absolute paths, Windows drive letters, and resolved paths outside target directory

3. **ZIP IPC Handlers** (appended to `src/main/ipc/handlers/batch-import.ts`)
   - `batch-import:selectZip` — file dialog for ZIP selection, returns encryption status
   - `batch-import:testZipPassword` — validates password against archive
   - `batch-import:extractZip` — extracts to temp dir, returns file list and errors
   - `batch-import:cleanupZipTemp` — cleans up temp directory (idempotent)

4. **BatchImportDialog ZIP Flow** (`src/renderer/src/components/BatchImportDialog.vue`)
   - Two new phases: `zip-password` and `zip-preview`
   - Password entry with visibility toggle, Enter-to-submit, and error messages
   - File preview list showing extracted filenames before import
   - Extraction warnings displayed in alert component
   - Temp directory cleanup on cancel, completion, and dialog close
   - Passes `'skip'` as duplicate strategy for freshly extracted files

5. **AppSidebar ZIP Menu Item** (`src/renderer/src/components/AppSidebar.vue`)
   - "Import ZIP Archive" with `mdi-zip-box` icon added to import dropdown

6. **Shared Types** (`src/shared/types/api.ts`)
   - Extended BatchImportAPI with selectZip, testZipPassword, extractZip, cleanupZipTemp

7. **Preload Bridge** (`src/preload/index.ts`)
   - Extended batchImport API with ZIP-related IPC channels

## Commits

| Hash | Description |
|------|-------------|
| 0b34359 | feat(16-02): add ZipExtractor, TempDirectoryManager, and ZIP IPC handlers |
| c3c4e70 | feat(16-02): add ZIP import flow UI with password, preview, and cleanup |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] adm-zip type definition typo for `encrypted` property**
- **Found during:** Task 1 typecheck
- **Issue:** `@types/adm-zip` declares the property as `encripted` (typo in upstream library), not `encrypted`
- **Fix:** Used `entry.header.encripted` to match the actual type definition
- **Files modified:** `src/main/import/ZipExtractor.ts`

**2. [Rule 1 - Bug] adm-zip `getData()` type definition missing password parameter**
- **Found during:** Task 1 typecheck
- **Issue:** Runtime adm-zip `getData()` accepts a password argument but `@types/adm-zip` declares it as zero-argument
- **Fix:** Used typed cast `(firstFile as unknown as { getData: (pass: string) => Buffer })` to pass password
- **Files modified:** `src/main/import/ZipExtractor.ts`

**3. [Rule 3 - Blocking] Prettier formatting fixes**
- **Found during:** Task 1 and Task 2 lint
- **Issue:** Multi-line template expressions and handler signatures formatted differently than Prettier expects
- **Fix:** Ran `eslint --fix` to auto-format
- **Files modified:** `src/main/ipc/handlers/batch-import.ts`, `src/renderer/src/components/BatchImportDialog.vue`

## Key Files

### Created
- `src/main/import/TempDirectoryManager.ts`
- `src/main/import/ZipExtractor.ts`

### Modified
- `src/main/import/index.ts` — barrel exports for new modules
- `src/main/ipc/handlers/batch-import.ts` — ZIP IPC handlers
- `src/preload/index.ts` — ZIP preload bridge
- `src/shared/types/api.ts` — BatchImportAPI extended
- `src/renderer/src/components/BatchImportDialog.vue` — ZIP flow UI
- `src/renderer/src/components/AppSidebar.vue` — ZIP menu item
- `src/renderer/src/App.vue` — ZIP event wiring
- `package.json` / `package-lock.json` — adm-zip + @types/adm-zip

## Decisions Made

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Use adm-zip (pure JS) for ZIP extraction | No native rebuild needed, works across platforms, sufficient for variant file archives |
| 2 | Default duplicate strategy `'skip'` for ZIP imports | Freshly extracted temp files won't have name collisions; skip is safest default |
| 3 | Type cast for adm-zip password API | @types/adm-zip lags behind runtime API; cast is safe and well-documented |
| 4 | Idempotent cleanupZipTemp on all exit paths | Ensures no orphaned temp directories even on error or unexpected dialog close |

## Verification

- `npm run lint` -- passes
- `npm run typecheck` -- passes (both renderer and node configs)

## Duration

~5.5 minutes
