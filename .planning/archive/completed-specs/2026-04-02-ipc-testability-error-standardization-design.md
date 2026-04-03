# IPC Handler Testability & Error Standardization — Design Spec

**Date:** 2026-04-02 (revised)
**Version:** 0.52.0
**Branch:** `refactor/ipc-testability` (off `main`)
**Goal:** Extract testable logic from orchestration-heavy IPC handlers, centralize `safeEmit`, standardize renderer error handling with the real `isIpcError()` guard, and fix an active bug in GeneBurdenView — raising handler coverage from ~5.7% to >30%.

---

## Problem Statement

The IPC handler layer (`src/main/ipc/handlers/`, 30 files, 29 handler modules) contains the highest coordination complexity in VarLens but has only 5.7% test coverage. Business logic is interleaved with Electron IPC plumbing, making it untestable without mocking `ipcMain`.

Three additional problems compound this:

1. **`safeEmit` is duplicated** in 4 handler files (`cases.ts`, `cohort.ts`, `import.ts`, `batch-import.ts`) plus a direct `webContents.send` in `export.ts`.
2. **Renderer error checking is inconsistent.** The canonical `isIpcError()` guard exists in `src/shared/types/errors.ts` but is never imported or used in renderer code. Instead, callers use 4+ ad-hoc patterns: `'error' in result`, `'code' in result`, `'userMessage' in result`, and `.error` property access.
3. **Two error contracts coexist.** `wrapHandler` wraps thrown errors as `SerializableError` (`{ code, message, userMessage }`), but many handlers also return domain result objects like `{ success: boolean, error?: string }` as normal return values. These are intentional domain unions, not bugs — but the renderer must handle both correctly.

---

## Immediate Bug Fix (independent of refactor)

**`src/renderer/src/components/association/GeneBurdenView.vue:197`** checks `'error' in result` to detect IPC failures. But `cohort:geneBurdenCompare` is wrapped by `wrapHandler`, so failures arrive as `SerializableError` with properties `code`, `message`, `userMessage` — not `error`. This means errors are silently miscast as success data.

**Fix:** Replace the ad-hoc check with `isIpcError(result)`. This fix ships as the first commit, independent of the larger refactor.

---

## Approach

### A. Two Error Contract Tracks

The codebase has two legitimate error patterns:

**Track 1: `wrapHandler`-backed channels (SerializableError contract)**
When a handler throws, `wrapHandler` catches it and returns `SerializableError`. The correct renderer guard is `isIpcError(result)`.

Affected renderer patterns: `'error' in result`, `'code' in result`, `'userMessage' in result` — all should become `isIpcError(result)`.

**Track 2: Domain result channels ({ success, error? } contract)**
Some handlers intentionally return `{ success: boolean, error?: string }` as part of their normal API (export, shell, database, gene-ref, etc.). These are not bugs — they represent domain-level outcomes, not IPC transport failures.

For Track 2 channels, renderer code checking `result.success` or `result.error` is correct behavior. The spec does NOT propose changing these to `SerializableError`.

`IpcResult<T>` already exists in `src/shared/types/errors.ts:20` and is re-exported via `src/shared/types/index.ts`. The work here is to **apply it consistently through `src/shared/types/api.ts`** — updating return types of `wrapHandler`-backed API methods from bare `T` to `IpcResult<T>` so the renderer type system forces callers to handle the error branch.

```typescript
// Already defined in src/shared/types/errors.ts:
export type IpcResult<T> = T | SerializableError
```

This makes the contract explicit: renderer callers of `wrapHandler`-backed channels always see `IpcResult<T>` and must use `isIpcError()` to discriminate.

### B. Pure Function Extraction (orchestration-heavy handlers only)

Not every handler warrants a companion `-logic.ts` file. The extraction targets handlers with significant business logic worth testing independently.

**Tier 1 — Extract now** (complex orchestration, high value):
| Handler | Why |
|---------|-----|
| `cases.ts` | CRUD + search + pagination + progress events |
| `variants.ts` | Query building, filter application, gene symbols |
| `cohort.ts` | Summary computation, variant aggregation, gene burden |
| `import.ts` | Import orchestration with progress callbacks |
| `batch-import.ts` | Multi-file import with progress |
| `export.ts` | Excel/CSV generation with progress |
| `annotations.ts` | CRUD + ACMG + starring + scope logic |
| `case-metadata.ts` | Complex metadata CRUD |
| `panels.ts` | Panel interval computation + offloading |
| `database.ts` | Open/create/rekey/migration logic |
| `auth.ts` | User management, password hashing, admin checks |
| `tags.ts` | Tag CRUD + variant-tag associations |

**Tier 2 — Leave as-is** (lower extraction value relative to churn):
| Handler | Why Tier 2 |
|---------|------------|
| `shell.ts` | 3 handlers with URL validation/policy, but logic is thin and well-contained |
| `system.ts` | Config reads, no orchestration |
| `updater.ts` | Electron autoUpdater delegation |
| `hpo.ts` | External API proxy |
| `vep.ts` | External API proxy with Zod validation |
| `myvariant.ts` | External API proxy with result mapping |
| `spliceai.ts` | External API proxy |
| `gnomad.ts` | External API proxy |
| `protein.ts` | External API proxy with PDB/UniProt mapping (non-trivial but self-contained) |
| `gene-ref.ts` | DB lookups with result mapping |
| `transcripts.ts` | DB lookups |
| `case-comments.ts` | CRUD with category handling |
| `case-metrics.ts` | CRUD |
| `filter-presets.ts` | CRUD |
| `gene-lists.ts` | Mixes gene list CRUD, region file management, pool branching, and BED import — more complex than typical CRUD but currently well-contained in one module |
| `analysis-groups.ts` | CRUD |
| `audit-log.ts` | Read-only queries |

**Pattern:**
```typescript
// cases.ts (thin wrapper)
import * as casesLogic from './cases-logic'

ipcMain.handle('cases:list', (_e, params) =>
  wrapHandler(() => casesLogic.listCases(getDb(), params))
)
```

```typescript
// cases-logic.ts (pure, testable)
export function listCases(db: Database, params: CaseSearchParams): PaginatedResult<Case> {
  // all business logic here
}
```

**Key rules:**
- Logic functions take explicit dependencies (db, logger) as parameters — no globals
- Logic functions return plain values, never touch IPC/Electron APIs
- Handler files only do: arg parsing (Zod), call logic, wrap in `wrapHandler`

### C. Centralized `safeEmit`

One shared utility replaces 4 local definitions + 1 direct `webContents.send`:

**File:** `src/main/ipc/utils/safeEmit.ts`
```typescript
import { BrowserWindow } from 'electron'

export function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}
```

**Sources to replace:**
- `cases.ts:18` — local `safeEmit`
- `cohort.ts:18` — local `safeEmit`
- `import.ts:12` — local `safeEmit`
- `batch-import.ts:21` — local `safeEmit`
- `export.ts:77` — direct `webContents.send`

Logic modules never call `safeEmit`. Progress-emitting handlers pass an `onProgress` callback:

```typescript
// handler (thin)
ipcMain.handle('import:start', (_e, args) =>
  wrapHandler(() => importLogic.runImport(getDb(), args, {
    onProgress: (p) => safeEmit('import:progress', p)
  }))
)

// logic (pure, testable)
export async function runImport(
  db: Database,
  args: ImportArgs,
  callbacks: { onProgress: (p: ProgressUpdate) => void }
): Promise<ImportResult> {
  // calls callbacks.onProgress(...) — vi.fn() in tests
}
```

### D. Renderer Error Standardization

**Actual `isIpcError()` guard** (already in `src/shared/types/errors.ts:23`):
```typescript
export function isIpcError(result: unknown): result is SerializableError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'code' in result &&
    'message' in result &&
    'userMessage' in result
  )
}
```

**Actual `SerializableError` shape** (`src/shared/types/errors.ts:12`):
```typescript
export interface SerializableError {
  code: ErrorCode
  message: string
  userMessage: string
  details?: Record<string, unknown>
}
```

**Ad-hoc patterns to replace with `isIpcError()`:**

| File | Line | Current pattern | Fix |
|------|------|----------------|-----|
| `GeneBurdenView.vue` | 197 | `'error' in result` | `isIpcError(result)` |
| `CohortFilterBar.vue` | 277, 420 | `'code' in result` | `isIpcError(result)` |
| `useFilterExport.ts` | 33 | `'code' in result` | `isIpcError(result)` |
| `CohortTable.vue` | 300 | `'code' in result` | `isIpcError(result)` |
| `FilterToolbar.vue` | 382 | `'code' in result` | `isIpcError(result)` |
| `ImportWizard.vue` | 478, 565 | `'userMessage' in result` | `isIpcError(result)` |

**Patterns to leave alone** (Track 2 domain results):
- `result.success`, `result.error` in export/shell/database callers — these check domain union results, not `SerializableError`

### E. Renderer-Side `unwrapIpcResult<T>()` Helper

Instead of a brittle ESLint AST selector, introduce a typed helper that makes the correct pattern easy and the wrong pattern unnecessary:

```typescript
// src/renderer/src/utils/ipc-result.ts
import { isIpcError, type SerializableError } from '../../../shared/types/errors'
import { logService } from '../services/LogService'

/**
 * Unwrap an IPC result, logging and returning null on error.
 * Use for wrapHandler-backed channels only.
 */
export function unwrapIpcResult<T>(
  result: T | SerializableError,
  context: string
): T | null {
  if (isIpcError(result)) {
    logService.error(`${context}: ${result.userMessage}`, context)
    return null
  }
  return result
}
```

This replaces ad-hoc checks at call sites and makes misuse harder. ESLint enforcement is a secondary safety net, not the primary control.

---

## Complete Handler Surface (29 modules)

| # | Handler file | Tier | safeEmit? | Extract? |
|---|-------------|------|-----------|----------|
| 1 | `analysis-groups.ts` | 2 | No | No |
| 2 | `annotations.ts` | 1 | No | Yes |
| 3 | `audit-log.ts` | 2 | No | No |
| 4 | `auth.ts` | 1 | No | Yes |
| 5 | `batch-import.ts` | 1 | Yes | Yes |
| 6 | `case-comments.ts` | 2 | No | No |
| 7 | `case-metadata.ts` | 1 | No | Yes |
| 8 | `case-metrics.ts` | 2 | No | No |
| 9 | `cases.ts` | 1 | Yes | Yes |
| 10 | `cohort.ts` | 1 | Yes | Yes |
| 11 | `database.ts` | 1 | No | Yes |
| 12 | `export.ts` | 1 | Yes (direct) | Yes |
| 13 | `filter-presets.ts` | 2 | No | No |
| 14 | `gene-lists.ts` | 2 | No | No |
| 15 | `gene-ref.ts` | 2 | No | No |
| 16 | `gnomad.ts` | 2 | No | No |
| 17 | `hpo.ts` | 2 | No | No |
| 18 | `import.ts` | 1 | Yes | Yes |
| 19 | `myvariant.ts` | 2 | No | No |
| 20 | `panels.ts` | 1 | No | Yes |
| 21 | `protein.ts` | 2 | No | No |
| 22 | `shell.ts` | 2 | No | No |
| 23 | `spliceai.ts` | 2 | No | No |
| 24 | `system.ts` | 2 | No | No |
| 25 | `tags.ts` | 1 | No | Yes |
| 26 | `transcripts.ts` | 2 | No | No |
| 27 | `updater.ts` | 2 | No | No |
| 28 | `variants.ts` | 1 | No | Yes |
| 29 | `vep.ts` | 2 | No | No |
| — | `panelIntervalHelper.ts` | — | No | N/A (helper) |

**Tier 1 (extract): 12 handlers**
**Tier 2 (leave as-is): 17 handlers**

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `src/main/ipc/utils/safeEmit.ts` | Shared safe window emit utility |
| `src/main/ipc/handlers/*-logic.ts` (12 files) | Pure logic for Tier 1 handlers |
| `src/renderer/src/utils/ipc-result.ts` | `unwrapIpcResult<T>()` helper |
| `tests/main/handlers/*-logic.test.ts` (12 files) | Tests for extracted logic |

### Modified Files

| File | Change |
|------|--------|
| 12 Tier 1 handler files | Thin wrapper: delegate to `-logic.ts` |
| 5 handler files with safeEmit | Replace local definition/direct send with shared import |
| `src/shared/types/api.ts` | Apply `IpcResult<T>` (from errors.ts) to wrapHandler-backed return types |
| `eslint.config.js` | Add `no-restricted-syntax` for ad-hoc error checks (secondary control) |
| `vitest.config.ts` | Add per-glob threshold for handler logic |
| ~8 renderer files | Replace ad-hoc error checks with `isIpcError()` or `unwrapIpcResult()` |

---

## Execution Waves

### Wave 0 — Immediate Bug Fix
- Fix `GeneBurdenView.vue:197` — replace `'error' in result` with `isIpcError(result)`
- Commit independently, can ship before the rest

### Wave 1 — Infrastructure
- Create `src/main/ipc/utils/safeEmit.ts`
- Apply existing `IpcResult<T>` through `src/shared/types/api.ts` return types for wrapHandler-backed channels
- Create `src/renderer/src/utils/ipc-result.ts` with `unwrapIpcResult()`
- Add ESLint rule as secondary control

### Wave 2 — Handler Extraction (Tier 1 only)
- Extract logic from 12 orchestration-heavy handlers into `-logic.ts` modules
- Replace 4 local `safeEmit` + 1 direct `webContents.send` with shared import
- Progress-emitting handlers get callback pattern

### Wave 3 — Renderer Standardization
- Replace ~8 ad-hoc error check sites with `isIpcError()` or `unwrapIpcResult()`
- Leave Track 2 domain result checks (`result.success`) untouched
- Verify ESLint rule catches violations

### Wave 4 — Tests & Coverage
- Write tests for 12 Tier 1 logic modules
- Keep existing handler tests (wrapper + logic) — do not migrate to logic-only
- Add per-glob coverage thresholds for `*-logic.ts` files
- Run full verification

---

## Test Strategy

**New logic tests:** Each test creates a real in-memory SQLite database (existing project pattern), calls the pure logic function, asserts results. No mocking of `ipcMain`, `BrowserWindow`, or Electron APIs.

**Progress-emitting logic:** Pass `vi.fn()` as `onProgress` callback, assert call count and arguments.

**Existing handler tests:** Keep as-is. They cover wrapper-specific behavior (Zod validation, `wrapHandler` error wrapping, IPC registration) that pure logic tests would not. The two test layers are complementary.

**Coverage targets:**
- New `*-logic.ts` files: 70% lines, 60% branches (per-glob threshold)
- Aggregate handler directory: target >30% (up from 5.7%)
- Global thresholds stay with `autoUpdate` ratcheting
- No `perFile` enforcement initially — too aggressive

---

## Success Criteria

- GeneBurdenView bug fixed immediately
- Handler layer coverage rises from ~5.7% to >30%
- Zero ad-hoc `SerializableError` checks in renderer (all use `isIpcError()`)
- Track 2 domain result checks left intentionally untouched
- Zero duplicate `safeEmit` definitions
- Tier 1 handler files become thin wrappers
- Existing handler tests preserved and passing
- `unwrapIpcResult()` available as the recommended renderer pattern
- `npm run lint:check && npm run typecheck && npm run test` clean

---

## Research References

- Electron IPC has no built-in way to query registered handlers ([electron#38560](https://github.com/electron/electron/issues/38560)) — pure function extraction is the recommended test pattern
- Electron documents that `ipcMain.handle` error serialization is lossy ([Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)) — supports explicit `SerializableError` contract
- Vitest supports per-glob coverage thresholds with `autoUpdate` ratcheting ([vitest PR #4442](https://github.com/vitest-dev/vitest/pull/4442))
- ESLint `no-restricted-syntax` can enforce AST patterns but should be a secondary control, not primary ([ESLint blog](https://eslint.org/blog/2017/03/eslint-v3.18.0-released/))
