# Plan 16-01 Summary: BatchImportOrchestrator

## Status: Complete

## What Was Built

Batch import infrastructure enabling users to import multiple JSON.gz case files in a single operation with error isolation, duplicate handling, and progress tracking.

### Deliverables

1. **BatchImportService** (`src/main/import/BatchImportService.ts`)
   - Sequential file processing with per-file error isolation
   - `checkDuplicates()` — upfront scan of all files against database before import starts
   - `processBatch()` — processes files with pre-determined duplicate strategy (skip/overwrite)
   - In-batch duplicate detection via Set to prevent race conditions
   - Case name extraction from filenames (strips .json.gz/.gz/.json extensions)

2. **IPC Handlers** (`src/main/ipc/handlers/batch-import.ts`)
   - `batch-import:selectFiles` — multi-file picker dialog with JSON/gz/ZIP filters
   - `batch-import:selectFolder` — folder picker, discovers JSON.gz files within
   - `batch-import:checkDuplicates` — upfront duplicate scan returning per-file status
   - `batch-import:start` — batch import with duplicate strategy, throttled progress events
   - `batch-import:cancel` — AbortController-based cancellation

3. **BatchImportDialog** (`src/renderer/src/components/BatchImportDialog.vue`)
   - Four phases: idle → duplicate-review → importing → summary
   - Duplicate review: radio group (Skip/Overwrite) with file list showing new vs existing
   - Import progress: file N of M with percentage bar and variant count
   - Summary: succeeded/failed/skipped chips with expandable per-file details
   - Cancel support preserving already-imported files

4. **AppSidebar Dropdown** (`src/renderer/src/components/AppSidebar.vue`)
   - "+" button now shows dropdown menu: Import File, Import Multiple Files, Import Folder

5. **Shared Types** (`src/shared/types/api.ts`)
   - BatchImportAPI, BatchResult, BatchFileDetail, BatchProgress, DuplicateCheckResult, DuplicateCheckItem

6. **Preload Bridge** (`src/preload/index.ts`)
   - batchImport API with selectFiles, selectFolder, checkDuplicates, start, cancel, onProgress

## Commits

| Hash | Description |
|------|-------------|
| 824fe63 | feat(16-01): add BatchImportService backend + IPC handlers + shared types |
| 8149cd3 | feat(16-01): add BatchImportDialog UI with progress, duplicate handling, and summary |
| a706d6c | fix(16-01): redesign duplicate handling with upfront check and radio group |

## Deviations

1. **Duplicate handling redesigned**: Original plan used mid-import IPC prompts. Redesigned to upfront `checkDuplicates()` scan with radio group review before import starts. More intuitive UX — user makes one decision upfront instead of being interrupted during import.

2. **Vue reactive Proxy fix**: `selectedFilePaths.value` (a Vue reactive Proxy) cannot be structured-cloned by Electron IPC. Fixed by spreading to plain array `[...selectedFilePaths.value]` before sending over IPC.

3. **Removed wrapHandler from batch IPC**: Direct try-catch with JSON round-trip (`JSON.parse(JSON.stringify(result))`) guarantees IPC serializability. Returns explicit error BatchResult on failure instead of SerializableError.

## Requirements Covered

- BTCH-01: Multi-file picker via batch-import:selectFiles
- BTCH-02: Folder selection via batch-import:selectFolder
- BTCH-03: Sequential processing with per-file error isolation
- BTCH-04: Aggregate progress (file N of M, overall percentage)
- BTCH-05: Summary report with succeeded/failed/skipped counts
- BTCH-06: Duplicate handling with Skip/Overwrite choice
